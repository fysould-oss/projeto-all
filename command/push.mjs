import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const refPrefix = 'refs/heads/';

async function git(cwd, args, message = 'Não foi possível consultar o estado Git.', timeout = 5000) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  Object.assign(env, {
    GIT_ALLOW_PROTOCOL: 'file:https:ssh',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_GRAFT_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null',
  });
  try {
    const { stdout } = await execute('git', [
      '-c', 'core.hooksPath=' + process.execPath, '-c', 'http.followRedirects=false', ...args,
    ], { cwd, env, windowsHide: true, timeout, maxBuffer: 256 * 1024 });
    return stdout;
  } catch (error) {
    if (args[0] === 'config' && args.includes('--get-regexp') && error.code === 1) return '';
    throw new Error(message);
  }
}

async function repository(project) {
  const path = typeof project === 'string' ? project : project?.path;
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Projeto sem caminho absoluto.');
  const cwd = await realpath(path);
  const root = await realpath((await git(cwd, ['rev-parse', '--show-toplevel'])).trim());
  const equal = process.platform === 'win32' ? cwd.toLowerCase() === root.toLowerCase() : cwd === root;
  if (!equal) throw new Error('O projeto precisa ser exatamente a raiz Git.');
  return cwd;
}

async function validateDestination(cwd, value) {
  if (!value || value.startsWith('-') || /[\x00-\x1f\x7f]/.test(value) || /^[\w+-]+::/.test(value)) {
    throw new Error('Destino de push inválido.');
  }
  if (/^file:\/\//i.test(value)) return realpath(fileURLToPath(value));
  if (/^(?:https|ssh):\/\//i.test(value)) {
    const { protocol, hostname, username, password, search, hash } = new URL(value);
    if (!hostname || password || search || hash || (protocol === 'https:' && username)) {
      throw new Error('Configure um destino sem credenciais ou parâmetros na URL.');
    }
    return value;
  }
  if (!isAbsolute(value) && /^(?:[\w.-]+@)?[\w.-]+:[^:]+$/.test(value)) return value;
  if (/^[\w+-]+:\/\//.test(value)) throw new Error('Use um remoto HTTPS, SSH ou local.');
  return realpath(resolve(cwd, value));
}

async function remotes(cwd) {
  return (await git(cwd, ['remote'])).split(/\r?\n/).filter(Boolean);
}

async function state(cwd, remote) {
  if (typeof remote !== 'string' || !remote || remote.startsWith('-') || !(await remotes(cwd)).includes(remote)) {
    throw new Error('Remoto não configurado.');
  }
  const ref = (await git(cwd, ['symbolic-ref', '--quiet', 'HEAD'], 'Push requer uma branch ativa.')).trim();
  if (!ref.startsWith(refPrefix)) throw new Error('Push requer uma branch local.');
  const head = (await git(cwd, ['rev-parse', '--verify', ref], 'Crie um commit local antes de solicitar o push.')).trim();
  const destinations = (await git(cwd, ['remote', 'get-url', '--push', '--all', remote])).split(/\r?\n/).filter(Boolean);
  if (destinations.length !== 1) throw new Error('Configure um único destino de push neste remoto.');
  const destination = await validateDestination(cwd, destinations[0]);
  const resolvedAgain = (await git(cwd, ['ls-remote', '--get-url', '--', destination])).trimEnd();
  const rewrites = await git(cwd, ['config', '--null', '--get-regexp', '^url[.].*[.]pushinsteadof$']);
  if (resolvedAgain !== destination || rewrites.split('\0').some(entry => {
    const prefix = entry.split('\n')[1];
    return prefix && destination.startsWith(prefix);
  })) throw new Error('A configuração Git reescreve o destino capturado.');
  const advertisement = await git(cwd, ['ls-remote', '--heads', '--', destination, ref],
    'Não foi possível consultar a branch no destino de push. Confira o acesso ao remoto.', 15000);
  const remoteHead = advertisement.split(/\r?\n/).map(line => line.split('\t'))
    .find(([, name]) => name === ref)?.[0] || '';
  if (remoteHead && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(remoteHead)) throw new Error('O remoto informou um commit inválido.');
  return { cwd, remote, branch: ref.slice(refPrefix.length), head, remoteHead, destination };
}

async function requireFastForward(current) {
  if (current.remoteHead) {
    await git(current.cwd, ['merge-base', '--is-ancestor', current.remoteHead, current.head],
      'O destino não pode avançar por fast-forward. Atualize o repositório local pelo Git e tente novamente.');
  }
}

export async function listRemotes(project) {
  return remotes(await repository(project));
}

export async function preparePush(project, remote) {
  const current = await state(await repository(project), remote);
  await requireFastForward(current);
  const args = current.remoteHead
    ? ['diff-tree', '--no-renames', '--name-only', '-z', '-r', current.remoteHead, current.head]
    : ['ls-tree', '-r', '--name-only', '-z', current.head];
  const paths = (await git(current.cwd, args)).split('\0').filter(Boolean);
  return { ...current, paths };
}

export async function executePush(project, prepared) {
  const current = await state(await repository(project), prepared?.remote);
  if (['cwd', 'branch', 'head', 'remoteHead', 'destination'].some(field => current[field] !== prepared[field])) {
    throw new Error('O estado Git ou o destino mudou desde a aprovação. Solicite nova revisão.');
  }
  await requireFastForward(current);
  const ref = refPrefix + current.branch;
  // The explicit lease is a compare-and-swap. The ancestry check above forbids rewrites.
  await git(current.cwd, ['push', '--no-verify', '--no-follow-tags', '--recurse-submodules=no',
    '--force-with-lease=' + ref + ':' + current.remoteHead, '--', current.destination, current.head + ':' + ref],
  'O push não foi confirmado. Confira o destino e o histórico remoto antes de repetir.', 30000);
  return current.head;
}
