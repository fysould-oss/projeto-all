import { lstat, realpath } from 'node:fs/promises';
import { normalize, resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

function repoPath(project) {
  const value = typeof project === 'string' ? project : project?.path;
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('Projeto sem caminho.');
  return resolve(value);
}

function samePath(a, b) {
  const left = normalize(a).replace(/[\\/]$/, '');
  const right = normalize(b).replace(/[\\/]$/, '');
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function git(cwd, args, message = 'Não foi possível consultar o estado Git.') {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  try {
    const { stdout } = await execute('git', [
      '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=' + process.execPath, ...args,
    ], { cwd, env, windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 });
    return stdout;
  } catch {
    throw new Error(message);
  }
}

async function ensureRoot(cwd) {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  if (!samePath(await realpath(root), await realpath(cwd))) throw new Error('O projeto precisa ser exatamente a raiz Git.');
}

function parseStatus(output) {
  const fields = output.split('\0').filter(Boolean);
  const files = [];
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index];
    if (record.length < 3) continue;
    const indexStatus = record[0];
    const worktreeStatus = record[1];
    const path = record.slice(3);
    const file = { path, index: indexStatus, worktree: worktreeStatus, status: indexStatus + worktreeStatus };
    if (indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C') {
      file.renameFrom = fields[++index] ?? '';
    }
    files.push(file);
  }
  return files;
}

export async function listFiles(project) {
  const cwd = repoPath(project);
  await ensureRoot(cwd);
  return parseStatus(await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--']));
}

export async function changeIndex(project, action, path) {
  const cwd = repoPath(project);
  if (!['git.stage', 'git.unstage'].includes(action)) throw new TypeError('Ação de índice inválida.');
  if (typeof path !== 'string' || !path || path.includes('\0')) {
    throw new TypeError('Caminho inválido.');
  }
  const files = await listFiles(cwd);
  const entry = files.find(file => file.path === path);
  if (!entry) throw new Error('Caminho não está listado no estado Git.');
  const stage = action === 'git.stage';
  if (stage ? entry.worktree === ' ' : [' ', '?'].includes(entry.index)) return files;
  const paths = (stage ? entry.worktree : entry.index) === 'R' && entry.renameFrom ? [entry.renameFrom, path] : [path];
  if (stage) for (const selected of paths) {
    try {
      if ((await lstat(join(cwd, selected))).isDirectory()) {
        throw new Error('Prepare os arquivos de submódulos diretamente pelo Git.');
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  await git(cwd, stage ? ['add', '--', ...paths] : ['reset', '-q', '--', ...paths],
    'Não foi possível atualizar o índice. Confira o estado do Git e tente novamente.');
  return listFiles(cwd);
}
