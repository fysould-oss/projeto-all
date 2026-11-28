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

export function githubRepository(remote) {
  const match = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([a-z\d-]+)\/([a-z\d_.-]+)\/?$/i.exec(remote);
  if (!match) return null;
  const [, owner, path] = match;
  const repo = path.replace(/\.git$/i, '');
  return repo && repo !== '.' && repo !== '..' ? { owner, repo } : null;
}

async function fetchGitHubJson(url) {
  const response = await fetch(url, {
    redirect: 'error', signal: AbortSignal.timeout(4000),
    headers: { Accept: 'application/vnd.github+json' },
  });
  return response.ok ? response.json() : null;
}

export function summarizeGitHubChecks(payload) {
  if (!Number.isSafeInteger(payload?.total_count) || payload.total_count < 0 || !Array.isArray(payload.check_runs)) return null;
  const checks = { total: payload.total_count, pending: 0, passed: 0, skipped: 0, failed: 0, other: 0 };
  for (const run of payload.check_runs) {
    if (run?.status !== 'completed') checks.pending += 1;
    else if (run.conclusion === 'success') checks.passed += 1;
    else if (['neutral', 'skipped'].includes(run.conclusion)) checks.skipped += 1;
    else if (['failure', 'timed_out', 'action_required', 'startup_failure', 'stale'].includes(run.conclusion)) checks.failed += 1;
    else checks.other += 1;
  }
  return { ...checks, partial: payload.check_runs.length !== checks.total };
}

export async function githubPullRequests(project) {
  const cwd = await repository(project);
  const branch = (await git(cwd, ['branch', '--show-current'])).trim();
  if (!branch) return { branch, repositories: [] };
  const tracking = (await git(cwd, ['for-each-ref', '--format=%(upstream:remotename)', '--', 'refs/heads/' + branch])).trim();
  const remotesFound = await remotes(cwd);
  const remote = remotesFound.find(value => value === tracking && !value.startsWith('-'))
    || remotesFound.find(value => value === 'origin')
    || (remotesFound.length === 1 && !remotesFound[0].startsWith('-') ? remotesFound[0] : '');
  const remoteUrl = remote && (await git(cwd, ['remote', 'get-url', remote])).trim();
  const target = githubRepository(remoteUrl);
  if (!target) return { branch, repositories: [] };
  const base = 'https://github.com/' + target.owner + '/' + target.repo;
  const search = new URLSearchParams({ q: 'is:pr is:open head:"' + branch + '"' });
  const api = new URL('/repos/' + target.owner + '/' + target.repo + '/pulls', 'https://api.github.com');
  api.search = new URLSearchParams({ state: 'open', head: target.owner + ':' + branch, per_page: '20' });
  const entry = { remote, name: target.owner + '/' + target.repo, url: base + '/pulls?' + search, pulls: [], available: false };
  try {
    const pulls = await fetchGitHubJson(api);
    if (Array.isArray(pulls)) {
      entry.available = true;
      const safePulls = pulls.slice(0, 20).filter(pull => Number.isSafeInteger(pull?.number) && pull.number > 0);
      const shaFor = pull => /^[a-f0-9]{40}$/.test(pull.head?.sha ?? '') ? pull.head.sha : '';
      const shas = [...new Set(safePulls.map(shaFor).filter(Boolean))].slice(0, 4);
      const results = await Promise.all(shas.map(async sha => {
        const url = new URL(api);
        url.pathname = url.pathname.replace(/\/pulls$/, '/commits/' + sha + '/check-runs');
        url.search = 'filter=latest&per_page=100';
        try { return [sha, summarizeGitHubChecks(await fetchGitHubJson(url))]; }
        catch { return [sha, null]; }
      }));
      const checks = new Map(results);
      entry.pulls = safePulls.map(pull => {
        const sha = shaFor(pull);
        return { number: pull.number, draft: pull.draft === true, url: base + '/pull/' + pull.number,
          sha, checks: checks.get(sha) ?? null };
      });
    }
  } catch {}
  return { branch, repositories: [entry] };
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
