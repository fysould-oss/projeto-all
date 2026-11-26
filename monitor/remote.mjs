import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { createCodexReader } from './codex.mjs';

const endpoint = 'https://projeto-all-condoconnect.sunnyode3.chatgpt.site/api/remote/';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const publicId = id => createHash('sha256').update(id).digest('hex').slice(0, 24);

export function remoteSettings(env = process.env) {
  const ids = (env.PROJETO_ALL_REMOTE_SESSIONS || '').split(',').map(id => id.trim()).filter(Boolean);
  const binary = env.PROJETO_ALL_CODEX_BIN;
  if (!ids.length || ids.length > 100 || !ids.every(id => uuid.test(id)) ||
      !binary || !path.isAbsolute(binary) || !/^codex(?:\.exe)?$/i.test(path.basename(binary)) ||
      !env.PROJETO_ALL_DEVICE_TOKEN) return null;
  const editable = new Set((env.PROJETO_ALL_REMOTE_WORKTREE_SESSIONS || '').split(',').map(id => id.trim()).filter(id => ids.includes(id)));
  return { ids: new Set(ids), editable, binary, deviceToken: env.PROJETO_ALL_DEVICE_TOKEN,
    home: env.PROJETO_ALL_CODEX_HOME || env.CODEX_HOME || path.join(homedir(), '.codex') };
}

export function isRemoteEligible(thread, settings) {
  return Boolean(settings?.ids.has(thread.id) && thread.turnCompleted && !thread.archived &&
    !thread.parentId && thread.status === 'concluido' && path.isAbsolute(thread.cwd));
}

export function observedTest(event) {
  if (event?.type !== 'item.completed' || event.item?.type !== 'command_execution' || !Number.isInteger(event.item.exit_code)) return null;
  const raw = String(event.item.command || '').trim();
  const wrapper = raw.match(/^((?:"?[A-Z]:\\[^"\r\n;&|]*\\)?(?:powershell|pwsh)(?:\.exe)?"?|(?:\/[\w/-]+\/)?(?:bash|sh))\s+(?:-Command|-c|-lc)\s+([\s\S]+)$/i);
  const command = (wrapper ? wrapper[2] : raw).trim().replace(/^["']|["']$/g,'');
  if (/[;&|`$<>\r\n]/.test(command) || !/^(?:node\s+--test|(?:npm|pnpm|yarn|cargo|go)\s+test|(?:python\s+-m\s+)?pytest|(?:\.\/)?(?:vendor\/bin\/)?phpunit|(?:\.\/|\.\\)?gradlew(?:\.bat)?\s+test)(?:\s|$)/i.test(command)) return null;
  return event.item.exit_code === 0 ? 'passed' : 'failed';
}

export function resumeRemoteTurn(settings, thread, instruction, signal, start = spawn, onEvent = () => {}, tree = null, onTest = () => {}) {
  // Only the local UUID and trusted local executable enter argv. Keep the
  // instruction on stdin and private relay credentials out of the child.
  const env = { ...process.env, CODEX_HOME: settings.home };
  for (const key of Object.keys(env)) {
    if (key.startsWith('PROJETO_ALL_') || key === 'OFFICE_OWNER_TOKEN' || key === 'OFFICE_DEVICE_TOKEN') delete env[key];
  }
  const args = tree ? ['exec','--sandbox','workspace-write','--cd',tree,'--json','fork',thread.id,'-']
    : ['exec', '--sandbox', 'read-only', '--json', 'resume', thread.id, '-'];
  return new Promise((resolve, reject) => {
    const child = start(settings.binary, args, { cwd: tree || thread.cwd, env, shell: false,
      windowsHide: true, signal, stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '';
    let matchingThread = false;
    let completed = false;
    const fail = () => { child.kill(); reject(new Error('Remote turn failed')); };
    child.on('error', reject);
    const report = (kind, pid) => {
      try { onEvent(kind, pid); } catch { fail(); }
    };
    report('running', child.pid);
    child.stdin.on('error', fail);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        const test = observedTest(event);
        if (test) onTest(test);
        if (['turn.started','item.started','item.completed','turn.completed'].includes(event?.type)) report(event.type);
        if (event?.type === 'thread.started') matchingThread = tree
          ? uuid.test(event.thread_id) && event.thread_id !== thread.id : event.thread_id === thread.id;
        if (event?.type === 'turn.completed' && matchingThread) completed = true;
        if (event?.type === 'turn.failed') return fail();
      }
      if (buffer.length > 4_000_000) fail();
    });
    child.once('close', code => {
      if (code === 0 && matchingThread && completed) resolve();
      else reject(new Error('Codex did not confirm the resumed turn'));
    });
    child.stdin.end(instruction);
  });
}

export function createRemoteConsumer({ settings, scan, post, resume, dispatch, outbox }) {
  let pendingResult;
  let busy = false;
  async function eligible() {
    const threads = (await scan()).filter(thread => isRemoteEligible(thread, settings));
    return new Map(threads.map(thread => [publicId(thread.id), thread]));
  }
  return async function poll(signal) {
    if (busy || signal.aborted) return;
    busy = true;
    try {
      pendingResult ??= outbox?.next();
      if (!pendingResult) {
        const targets = await eligible();
        if (!targets.size) return;
        const { job } = await post('claim', { sessionIds: [...targets.keys()] }, signal);
        if (!job) return;
        if (typeof job.id !== 'string' || typeof job.receipt !== 'string') throw new Error('Invalid receipt');
        const result = { id: job.id, receipt: job.receipt, status: 'failed' };
        try {
          const current = (await eligible()).get(job.sessionId);
          if (targets.has(job.sessionId) && current && typeof job.instruction === 'string' &&
              job.instruction.trim() && job.instruction.length <= 8000) {
            const timeout = AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)]);
            if (dispatch) {
              const evidence = await dispatch(settings, current, job.instruction, timeout, job);
              if (evidence?.check) result.check = evidence.check;
              if (evidence?.tests) result.tests = evidence.tests;
            }
            else await resume(settings, current, job.instruction, timeout);
            result.status = 'completed';
          }
        } finally {
          pendingResult = result;
          outbox?.save(result);
        }
      }
      try { await post('result', pendingResult, signal); }
      catch (error) { if (![404,409].includes(error.status)) throw error; }
      outbox?.clear(pendingResult.id);
      pendingResult = undefined;
    } finally {
      busy = false;
    }
  };
}

export function coordinatedRemoteExecutor(post, scan, db) {
  return async (settings, thread, instruction, signal, job) => {
    const { coordinateResume, remoteWorktree, checkRemoteWorktree } = await import('./coordinator.mjs');
    if (job.mode && !['worktree','resume'].includes(job.mode)) throw new Error('Modo indisponível.');
    if (job.mode === 'worktree' && !settings.editable?.has(thread.id)) throw new Error('Sessão não autorizada para worktree.');
    let check, tests;
    let phase = 'waiting', sending;
    const beat = () => {
      if (!sending) sending = post('progress', { id: job.id, receipt: job.receipt, phase }, signal)
        .catch(() => {}).finally(() => { sending = undefined; });
      return sending;
    };
    await beat();
    const timer = setInterval(beat, 10000);
    try {
      await coordinateResume(db, job.id, thread.cwd, signal, async record => {
        const current = (await scan()).find(t => t.id === thread.id && t.cwd === thread.cwd && isRemoteEligible(t, settings));
        if (!current) throw new Error('Sessão deixou de ser elegível.');
        const tree = job.mode === 'worktree' ? await remoteWorktree(db, job.id, current.cwd) : null;
        await resumeRemoteTurn(settings, current, instruction, signal, spawn, (kind, pid) => {
          phase = kind; record(kind, pid);
        }, tree, result => { if (tests !== 'failed') tests = result; });
        if (tree) check = await checkRemoteWorktree(db,job.id,tree);
      });
    } finally { clearInterval(timer); await sending; await beat(); }
    return {check,tests};
  };
}

export function startRemoteMonitor(credential) {
  const settings = remoteSettings();
  if (!settings || !credential) return () => {};
  const reader = createCodexReader({ codexHome: settings.home });
  async function post(route, body, signal) {
    const response = await fetch(endpoint + route, { method: 'POST', redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      headers: { 'Content-Type': 'application/json', 'OAI-Sites-Authorization': 'Bearer ' + credential,
        'X-Office-Device': settings.deviceToken }, body: JSON.stringify(body) });
    if (!response.ok) throw Object.assign(new Error('Remote queue unavailable'),{status:response.status});
    return response.json();
  }
  let db, poll;
  const dispatch = async (...args) => {
    const { openQueue } = await import('./coordinator.mjs');
    db ??= openQueue();
    return coordinatedRemoteExecutor(post, reader.scan, db)(...args);
  };
  const controller = new AbortController();
  let unavailable = false;
  function tick() {
    (async () => {
      if (!poll) {
        const { openQueue, remoteResults } = await import('./coordinator.mjs');
        db ??= openQueue();
        poll ??= createRemoteConsumer({settings,scan:reader.scan,post,dispatch,outbox:remoteResults(db)});
      }
      await poll(controller.signal);
    })().then(() => { unavailable = false; }, () => {
      if (!unavailable && !controller.signal.aborted) console.warn('Fila remota temporariamente indisponível.');
      unavailable = true;
    });
  }
  const timer = setInterval(tick, 5000);
  timer.unref();
  return () => { clearInterval(timer); controller.abort(); };
}
