import { access, realpath } from 'node:fs/promises';
import { resolve, normalize, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const MAX_MESSAGE = 200;
const exec = promisify(execFile);

function projectPath(project) {
  const value = typeof project === 'string' ? project : project?.path;
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('Projeto sem caminho.');
  return resolve(value);
}

function samePath(left, right) {
  const a = normalize(left).replace(/[\\/]$/, '');
  const b = normalize(right).replace(/[\\/]$/, '');
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function git(cwd, args, message = 'Git não conseguiu validar ou preparar o commit.') {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  try {
    const { stdout } = await exec('git', ['-c', 'core.hooksPath=' + process.execPath, '-c', 'core.fsmonitor=false', ...args], {
      cwd, env, windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024,
    });
    return stdout.trimEnd();
  } catch {
    throw new Error(message);
  }
}

async function state(project) {
  const root = await git(project, ['rev-parse', '--show-toplevel']);
  // Resolve Windows short names/symlinks before the exact-root comparison.
  if (!samePath(await realpath(root), await realpath(project))) throw new Error('O projeto precisa ser exatamente a raiz Git.');
  const ref = await git(project, ['symbolic-ref', '--quiet', 'HEAD'], 'Commit requer uma branch ativa.');
  if (!ref.startsWith('refs/heads/')) throw new Error('Commit requer uma branch local ativa.');
  const gitDir = await git(project, ['rev-parse', '--absolute-git-dir']);
  const signing = await git(project, ['config', '--type=bool', '--default=false', '--get', 'commit.gpgSign']);
  if (signing === 'true') throw new Error('Este projeto exige assinatura. Crie o commit assinado pelo Git.');
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) {
    try {
      await access(join(gitDir, marker));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    throw new Error('Há uma operação Git pendente; finalize-a antes do commit.');
  }
  const head = await git(project, ['rev-parse', '--verify', ref], 'O projeto precisa ter um commit inicial.');
  const tree = await git(project, ['write-tree'], 'Não foi possível preparar o índice. Resolva conflitos antes de continuar.');
  const changed = await git(project, ['diff-tree', '--no-renames', '--name-only', '-z', '-r', head, tree]);
  const paths = changed.split('\0').filter(Boolean);
  if (!paths.length) throw new Error('Não há alterações preparadas para commit.');
  return { branch: ref.slice('refs/heads/'.length), head, tree, paths, gitDir: await realpath(gitDir) };
}

function validMessage(message) {
  if (typeof message !== 'string') throw new TypeError('Mensagem de commit inválida.');
  const value = message.trim();
  if (!value || value.length > MAX_MESSAGE || /[\x00-\x1f\x7f]/.test(value)) {
    throw new TypeError('Mensagem deve ser não vazia, de uma linha e limitada a 200 caracteres.');
  }
  return value;
}

export async function prepareCommit(project, message) {
  const cwd = await realpath(projectPath(project));
  const value = validMessage(message);
  const stateNow = await state(cwd);
  return { project: cwd, message: value, ...stateNow };
}

export async function executeCommit(project, prepared) {
  const cwd = await realpath(projectPath(project));
  if (!prepared || !samePath(prepared.project, cwd)) throw new Error('Preparação não corresponde ao projeto.');
  const approvedMessage = validMessage(prepared.message);
  const current = await state(cwd);
  if (current.branch !== prepared.branch || current.head !== prepared.head || current.tree !== prepared.tree
    || !samePath(current.gitDir, prepared.gitDir)) {
    throw new Error('O estado Git mudou desde a aprovação; prepare o commit novamente.');
  }
  const commit = await git(cwd, ['commit-tree', prepared.tree, '-p', prepared.head, '-m', approvedMessage],
    'Git não conseguiu criar o commit. Confira a identidade configurada no repositório.');
  // update-ref's old value is a compare-and-swap: a concurrent branch update fails.
  const ref = `refs/heads/${prepared.branch}`;
  await git(cwd, ['update-ref', '-m', 'projeto-all: commit aprovado', ref, commit, prepared.head],
    'A atualização da branch falhou. Confira o histórico Git e solicite nova aprovação.');
  return commit;
}
