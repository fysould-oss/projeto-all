import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_LIMIT = 256 * 1024;
const DEFAULT_TIMEOUT = 5 * 60 * 1000;
const NAMES = ['lint', 'test', 'build', 'typecheck'];
const MAX_ACTIVE = 2;
const MAX_HISTORY = 20;

function pathOf(project) {
  const value = typeof project === 'string' ? project : project?.path;
  if (typeof value !== 'string' || !value) throw new TypeError('Projeto sem caminho.');
  return resolve(value);
}

async function scriptsAt(cwd) {
  try {
    const packageJson = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
    const scripts = packageJson?.scripts;
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return [];
    return NAMES.filter(name => typeof scripts[name] === 'string' && scripts[name].trim());
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return [];
    throw error;
  }
}

function commandFor(name) {
  return process.platform === 'win32'
    ? { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'npm.cmd', 'run', name, '--'] }
    : { command: 'npm', args: ['run', name, '--'] };
}

function publicRun(run) {
  const { id, script, status, startedAt, output, exitCode, durationMs } = run;
  return { id, script, status, startedAt, output, exitCode, durationMs };
}

function stop(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true, stdio: 'ignore', shell: false,
    });
    killer.once('error', () => child.kill());
    killer.once('exit', code => { if (code !== 0) child.kill(); });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

export function createChecks(options = {}) {
  const maxOutputBytes = Number.isFinite(options.maxOutputBytes) ? Math.max(1024, options.maxOutputBytes) : DEFAULT_LIMIT;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, options.timeoutMs) : DEFAULT_TIMEOUT;
  const runs = new Map();
  let closed = false;

  async function available(project) { return scriptsAt(pathOf(project)); }
  const projectKey = project => project?.id || pathOf(project);
  function list(project) {
    return [...runs.values()].filter(run => run.project === projectKey(project)).reverse().map(publicRun);
  }
  function activeCount() {
    return [...runs.values()].filter(run => run.child).length;
  }
  function availableSlots() {
    return closed ? 0 : MAX_ACTIVE - activeCount();
  }

  async function start(project, script) {
    const cwd = pathOf(project);
    if (!NAMES.includes(script)) throw new TypeError('Script de verificação indisponível.');
    if (!(await available(cwd)).includes(script)) throw new Error(`Script não configurado: ${script}.`);
    if (closed) throw new Error('O serviço de execução está encerrando.');
    if (!availableSlots()) {
      const error = new Error('Há duas verificações em andamento. Aguarde ou interrompa uma delas.');
      error.code = 'CHECK_CAPACITY';
      throw error;
    }
    while (runs.size >= MAX_HISTORY) {
      const completed = [...runs.values()].find(run => !run.child);
      if (!completed) break;
      runs.delete(completed.id);
    }
    const id = randomUUID();
    const run = { id, project: projectKey(project), script, status: 'running', startedAt: new Date().toISOString(), output: '', exitCode: null, durationMs: null, child: null };
    const started = Date.now();
    const invocation = commandFor(script);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('PROJETO_ALL_')));
    const child = spawn(invocation.command, invocation.args, { cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    run.child = child;
    runs.set(id, run);
    let bytes = 0;
    let truncated = false;
    const append = chunk => {
      if (truncated) return;
      const text = chunk.toString('utf8');
      const remaining = maxOutputBytes - bytes;
      if (Buffer.byteLength(text) <= remaining) { run.output += text; bytes += Buffer.byteLength(text); }
      else { run.output += Buffer.from(text).subarray(0, Math.max(0, remaining)).toString('utf8'); run.output += '\n[output truncated]'; truncated = true; }
    };
    child.stdout.on('data', append); child.stderr.on('data', append);
    let timer = setTimeout(() => { if (run.status === 'running') { run.status = 'timed_out'; stop(child); } }, timeoutMs);
    timer.unref?.();
    const done = new Promise(resolveDone => {
      child.once('error', () => {
        if (run.status === 'running') {
          run.status = 'failed';
          run.output = 'Não foi possível iniciar o npm.';
        }
      });
      child.once('close', code => { clearTimeout(timer); run.exitCode = code; run.durationMs = Date.now() - started; if (run.status === 'running') run.status = code === 0 ? 'passed' : 'failed'; resolveDone(); });
    }).finally(() => { run.child = null; });
    run.done = done;
    return publicRun(run);
  }

  async function cancel(project, id) {
    const run = runs.get(id);
    if (!run || run.project !== projectKey(project)) return false;
    if (run.status === 'running') { run.status = 'cancelled'; stop(run.child); }
    await run.done;
    return publicRun(run);
  }

  async function wait(project, id) {
    const run = runs.get(id);
    if (!run || run.project !== projectKey(project)) return null;
    await run.done;
    return publicRun(run);
  }

  async function close() {
    closed = true;
    const active = [...runs.values()].filter(run => run.child);
    for (const run of active) {
      if (run.status === 'running') {
        run.status = 'cancelled';
        stop(run.child);
      }
    }
    await Promise.all(active.map(run => run.done));
  }
  return { available, activeCount, availableSlots, list, start, cancel, wait, close };
}
