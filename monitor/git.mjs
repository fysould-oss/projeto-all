import { execFile } from 'node:child_process';
import { constants, watch } from 'node:fs';
import { access, lstat, realpath, stat } from 'node:fs/promises';
import { basename, delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const gitOptions = [
  '--no-optional-locks',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.untrackedCache=false',
  '-c', 'submodule.recurse=false',
  '-c', 'status.submoduleSummary=false',
];
const branchHeader = '# branch.head ';
const pathPrefix = /^(?:1 (?:[^ ]+ ){7}|2 (?:[^ ]+ ){8}|u (?:[^ ]+ ){9}|\? )/;
const ignoredWatchDirectories = new Set([
  '.git', 'node_modules', 'vendor', '.cache', '.codex', '.idea', '.next', '.npm', '.nuxt',
  '.parcel-cache', '.pnpm-store', '.pytest_cache', '.ruff_cache', '.turbo', '.venv', '.vscode',
  '.yarn', '__pycache__', 'coverage',
]);
const maxGitProcesses = 4;

async function findGit() {
  const name = process.platform === 'win32' ? 'git.exe' : 'git';
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    const directory = entry.replace(/^"|"$/g, '');
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch { /* Git may be unavailable on this host. */ }
  }
  return null;
}

function gitEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '' };
}

function parseStatus(stdout) {
  const entries = stdout.split('\0');
  let branch = null;
  const paths = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.startsWith(branchHeader)) {
      const head = entry.slice(branchHeader.length);
      if (head && head !== '(detached)' && head !== '(unknown)') branch = head;
    }
    const prefix = entry.match(pathPrefix)?.[0];
    if (!prefix) continue;
    paths.push(entry.slice(prefix.length));
    if (entry.startsWith('2 ')) index++;
  }
  return { branch, paths };
}

async function metadataTime(root, path) {
  const file = resolve(root, path);
  const within = relative(root, file);
  if (!within || isAbsolute(within) || within === '..' || within.startsWith('..' + sep)) return 0;
  try {
    const { mtimeMs, ctimeMs } = await lstat(file);
    return Math.max(mtimeMs, ctimeMs);
  } catch {
    return 0;
  }
}

function watchDirectory(root, record) {
  const onChange = (_event, filename) => {
    if (filename?.split(/[\\/]/).some(part => ignoredWatchDirectories.has(part.toLowerCase()))) return;
    record.lastChange = Math.max(record.lastChange, Date.now());
  };
  for (const recursive of [true, false]) {
    try {
      const watcher = watch(root, { persistent: false, recursive }, onChange);
      watcher.on('error', () => {
        watcher.close();
        if (record.watcher === watcher) record.watcher = null;
      });
      return watcher;
    } catch { /* Older Node versions may only support a non-recursive watcher. */ }
  }
  return null;
}

export function createWorkspaceMonitor() {
  const executable = findGit();
  const env = gitEnvironment();
  const controller = new AbortController();
  const records = new Map();
  const waitingForGit = [];
  let runningGit = 0;
  let pending = Promise.resolve();

  async function run(cwd, args) {
    const file = await executable;
    if (!file) throw new Error('Git unavailable');
    if (runningGit === maxGitProcesses) {
      await new Promise(resolveSlot => waitingForGit.push(resolveSlot));
    } else {
      runningGit++;
    }
    try {
      controller.signal.throwIfAborted();
      const { stdout } = await execute(file, [...gitOptions, ...args], {
        cwd, env, signal: controller.signal, windowsHide: true, timeout: 2500, maxBuffer: 4 * 1024 * 1024,
      });
      return stdout;
    } finally {
      const next = waitingForGit.shift();
      if (next) next();
      else runningGit--;
    }
  }

  async function locate(cwd) {
    let directory = resolve(cwd);
    try { directory = await realpath(directory); } catch { /* The workspace may have been moved. */ }
    try {
      const output = await run(directory, ['rev-parse', '--path-format=absolute', '--show-toplevel']);
      const root = output.replace(/\r?\n$/, '');
      if (isAbsolute(root)) return { root: await realpath(root), isRepository: true };
    } catch { /* Git can reject workspaces it cannot access. */ }
    return { root: directory, isRepository: false };
  }

  async function scanRepository(root, record) {
    let stdout;
    try {
      let config = '';
      try {
        config = await run(root, ['config', '--includes', '--null', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|process|required)$']);
      } catch (error) {
        if (error.code !== 1 || error.stderr) throw error;
      }
      // A status refresh can run configured clean filters while comparing files.
      const filterKeys = [...new Set(config.split('\0').filter(Boolean))];
      if (filterKeys.some(key => key.includes('='))) return;
      const disabledFilters = filterKeys.flatMap(key => ['-c', `${key}=${key.endsWith('.required') ? 'false' : ''}`]);
      stdout = await run(root, [...disabledFilters, 'status', '--porcelain=v2', '-z', '--branch',
        '--untracked-files=all', '--ignore-submodules=all', '--no-ahead-behind', '--renames']);
    } catch {
      return;
    }

    const { branch, paths } = parseStatus(stdout);
    const times = await Promise.all(paths.map(path => metadataTime(root, path)));
    for (const time of times) record.lastChange = Math.max(record.lastChange, time);
    if (record.output !== null && record.output !== stdout) record.lastChange = Math.max(record.lastChange, Date.now());
    Object.assign(record, { branch, changes: paths.length, output: stdout });
  }

  async function scanWorkspaces(cwds) {
    if (controller.signal.aborted) return new Map();
    const located = await Promise.all(cwds.map(async cwd => [cwd, await locate(cwd)]));
    if (controller.signal.aborted) return new Map();
    const workspaces = new Map(located.map(([, workspace]) => [workspace.root, workspace]));
    for (const [root, record] of records) {
      if (workspaces.has(root)) continue;
      record.watcher?.close();
      records.delete(root);
    }

    await Promise.all([...workspaces.values()].map(async ({ root, isRepository }) => {
      const record = records.get(root) ?? { branch: null, changes: 0, lastChange: 0, output: null, watcher: null };
      records.set(root, record);
      record.watcher ??= watchDirectory(root, record);
      if (isRepository) {
        await scanRepository(root, record);
      } else {
        Object.assign(record, { branch: null, changes: 0, output: null });
      }
    }));
    if (controller.signal.aborted) return new Map();

    return new Map(located.map(([cwd, workspace]) => {
      const { root, isRepository } = workspace;
      const { branch, changes, lastChange } = records.get(root);
      return [cwd, { root, name: basename(root) || 'Projeto local', branch, changes, lastChangeAt: lastChange ? new Date(lastChange).toISOString() : null, isRepository }];
    }));
  }

  return {
    async scan(cwds) {
      if (!Array.isArray(cwds) || [...cwds].some(cwd => typeof cwd !== 'string' || !isAbsolute(cwd) || cwd.includes('\0'))) {
        throw new TypeError('Workspace paths must be absolute.');
      }
      const selected = [...new Set(cwds)];
      const operation = pending.then(() => scanWorkspaces(selected));
      pending = operation.catch(() => {});
      return operation;
    },
    close() {
      controller.abort();
      for (const { watcher } of records.values()) watcher?.close();
      records.clear();
    },
  };
}
