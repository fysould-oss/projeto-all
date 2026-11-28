import { lstat, readlink, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const MAX_OUTPUT = 256 * 1024;

function same(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function git(cwd, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  try {
    const { stdout } = await execute('git', [
      '--no-pager', '--no-optional-locks', '--no-replace-objects', '-c', 'core.fsmonitor=false', ...args,
    ], { cwd, env, windowsHide: true, timeout: 5000, maxBuffer: MAX_OUTPUT });
    return stdout;
  } catch {
    throw new Error('Não foi possível inspecionar o Git ou a saída excedeu o limite.');
  }
}

async function ensureRoot(cwd) {
  const root = await realpath((await git(cwd, ['rev-parse', '--show-toplevel'])).trim());
  if (!same(root, cwd)) throw new Error('A pasta precisa ser a raiz Git da worktree ou do projeto.');
}

async function readJob(directory, id) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(directory, 'jobs.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT status,repo,base,worktree FROM jobs WHERE id=?').get(id);
  } finally {
    db.close();
  }
}

function splitPaths(output) {
  const files = output.split('\0').filter(Boolean);
  if (files.length > 500 || files.some(path =>
    isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git'))) {
    throw new Error('A lista de arquivos excede o limite ou tem um caminho inválido.');
  }
  return files;
}

async function fingerprints(worktree, files) {
  let bytes = 0;
  const fingerprints = [];
  for (const file of files) {
    const path = join(worktree, file);
    if (!same(await realpath(dirname(path)), dirname(path))) throw new Error('Pasta de arquivo não canônica.');
    const entry = await lstat(path);
    bytes += entry.size;
    if (bytes > 32 * 1024 * 1024) throw new Error('Os arquivos não rastreados excedem o limite de revisão.');
    if (entry.isSymbolicLink()) {
      fingerprints.push(['link', await readlink(path)]);
    } else if (entry.isFile()) {
      const hash = await git(worktree, ['hash-object', '--no-filters', '--', file]);
      fingerprints.push([entry.mode & 0o111, hash.trim()]);
    } else {
      throw new Error('Tipo de arquivo não rastreado indisponível para revisão.');
    }
  }
  return fingerprints;
}

export async function readCoordinatorReview(directory, jobId, project) {
  if (typeof jobId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(jobId)) {
    throw new Error('Identificador de execução inválido.');
  }
  const folder = await realpath(directory);
  const job = await readJob(folder, jobId);
  if (job?.status !== 'done' || !job.repo || !job.worktree ||
    typeof job.base !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(job.base)) {
    throw new Error('A execução não tem um resultado Git concluído.');
  }
  const root = await realpath(project.path ?? project);
  const worktree = resolve(folder, 'worktrees', jobId);
  if (!same(await realpath(job.repo), root) || !same(await realpath(job.worktree), worktree)
    || !same(await realpath(worktree), worktree)) {
    throw new Error('A worktree não corresponde ao repositório e à execução registrados.');
  }
  await Promise.all([ensureRoot(root), ensureRoot(worktree)]);
  const common = async cwd => realpath(resolve(cwd, (await git(cwd, ['rev-parse', '--git-common-dir'])).trim()));
  const [projectCommon, worktreeCommon] = await Promise.all([common(root), common(worktree)]);
  if (!same(projectCommon, worktreeCommon)) throw new Error('A worktree não pertence ao repositório registrado.');
  await git(worktree, ['cat-file', '-e', job.base + '^{commit}']);
  const head = (await git(worktree, ['rev-parse', '--verify', 'HEAD'])).trim();
  const configKeys = (await git(worktree, ['config', '--name-only', '--null', '--list'])).split('\0').filter(Boolean);
  const disableFilters = [...new Set(configKeys)].flatMap(key => {
    if (/^filter\..*\.(clean|process)$/i.test(key)) return ['-c', key + '='];
    if (/^filter\..*\.required$/i.test(key)) return ['-c', key + '=false'];
    return [];
  });
  const diff = [...disableFilters, 'diff', '--full-index', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '--submodule=short'];
  const output = await git(worktree, [...diff, job.base, '--']);
  const tracked = splitPaths(await git(worktree, [...diff, '--name-only', '-z', job.base, '--']));
  const untracked = splitPaths(await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z', '--']));
  const untrackedRevisions = await fingerprints(worktree, untracked);
  if ((await git(worktree, ['rev-parse', '--verify', 'HEAD'])).trim() !== head) {
    throw new Error('A worktree mudou durante a leitura.');
  }
  const revision = createHash('sha256').update(JSON.stringify([job.base, head, output, tracked, untracked, untrackedRevisions])).digest('hex');
  return { output, files: [...new Set([...tracked, ...untracked])], untracked, revision, base: job.base, head };
}
