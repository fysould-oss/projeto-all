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

async function git(cwd, args, message = 'Não foi possível consultar o estado Git.', maxBuffer = 256 * 1024, encoding = 'utf8') {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  try {
    const { stdout } = await execute('git', [
      '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=' + process.execPath, ...args,
    ], { cwd, env, windowsHide: true, timeout: 5000, maxBuffer, encoding });
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

async function committedTree(cwd, revision) {
  await ensureRoot(cwd);
  const tree = (await git(cwd, ['--no-replace-objects', 'rev-parse', '--verify', 'HEAD^{tree}'], 'Não foi possível localizar uma árvore no HEAD.')).trim();
  if (revision && revision !== tree) throw new Error('O HEAD mudou. Faça uma nova busca para atualizar a lista.');
  return tree;
}

export async function listCommittedPaths(project, { query = '', offset = 0, revision = '' } = {}) {
  if (typeof query !== 'string' || query.length > 120 || !Number.isSafeInteger(offset) || offset < 0 || offset > 200000) {
    throw new Error('Filtro ou página de arquivos inválida.');
  }
  const cwd = repoPath(project);
  const tree = await committedTree(cwd, revision);
  const raw = await git(cwd, ['--no-replace-objects', 'ls-tree', '-r', '--name-only', '-z', tree],
    'Não foi possível listar a árvore Git dentro do limite de leitura.', 2 * 1024 * 1024);
  const needle = query.trim().toLowerCase();
  const matches = raw.split('\0').filter(path => path && path.toLowerCase().includes(needle));
  const pageSize = 60;
  const paths = matches.slice(offset, offset + pageSize);
  return { revision: tree, paths, total: matches.length, next: offset + pageSize < matches.length ? offset + pageSize : null };
}

export async function readCommittedText(project, { path, revision } = {}) {
  if (typeof path !== 'string' || !path || path.length > 4096 || path.includes('\0')
    || path.split('/').some(part => !part || part === '.' || part === '..')
    || typeof revision !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision)) {
    throw new Error('Caminho ou revisão inválida.');
  }
  const cwd = repoPath(project);
  const tree = await committedTree(cwd, revision);
  const entry = await git(cwd, ['--no-replace-objects', 'ls-tree', '-z', tree, '--', path]);
  const match = /^100(?:644|755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t/.exec(entry);
  if (!match || entry.slice(match[0].length) !== path + '\0') {
    throw new Error('Selecione um arquivo regular desta revisão.');
  }
  const maxBytes = 64 * 1024;
  const object = match[1];
  const bytes = Number((await git(cwd, ['--no-replace-objects', 'cat-file', '-s', object])).trim());
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxBytes) {
    throw new Error('O arquivo excede o limite de 64 KiB da visualização.');
  }
  const content = await git(cwd, ['--no-replace-objects', 'cat-file', 'blob', object],
    'Não foi possível ler o arquivo do Git.', maxBytes, 'buffer');
  try {
    if (content.includes(0)) throw new Error();
    return { path, revision: tree, bytes, text: new TextDecoder('utf-8', { fatal: true }).decode(content) };
  } catch {
    throw new Error('A visualização aceita arquivos de texto UTF-8.');
  }
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
