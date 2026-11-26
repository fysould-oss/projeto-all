import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { resolve } from 'node:path';
import { createRemoteConsumer, remoteSettings, resumeRemoteTurn, observedTest, coordinatedRemoteExecutor } from './remote.mjs';

const id = 'aaaaaaaa-1111-2222-3333-123456789012';
const hash = createHash('sha256').update(id).digest('hex').slice(0, 24);
const settings = remoteSettings({ PROJETO_ALL_REMOTE_SESSIONS: id,
  PROJETO_ALL_CODEX_BIN: resolve('codex.exe'), PROJETO_ALL_DEVICE_TOKEN: 'test' });
const thread = { id, cwd: resolve('.'), status: 'concluido', turnCompleted: true };
const job = { id: 'job', receipt: 'receipt', sessionId: hash, instruction: 'inspect' };
const signal = new AbortController().signal;

test('only known completed test commands produce a summarized result', () => {
  const event = (command,exit_code) => ({type:'item.completed',item:{type:'command_execution',command,exit_code}});
  assert.equal(observedTest(event('node --test',0)), 'passed');
  assert.equal(observedTest(event('powershell.exe -Command "npm test"',1)), 'failed');
  assert.equal(observedTest(event('echo -Command npm test',0)), null);
  assert.equal(observedTest(event('npm test && echo ok',0)), null);
  assert.equal(observedTest(event('node --test',null)), null);
});

test('remote worktrees require a separately authorized local session', async () => {
  const run = coordinatedRemoteExecutor(assert.fail,assert.fail,null);
  await assert.rejects(run(settings,thread,'teste',signal,{id:'test',mode:'worktree'}),/não autorizada/);
});

test('opt-in is mandatory, unfinished, archived and revoked sessions cannot run', async () => {
  assert.equal(remoteSettings({}), null);
  for (const update of [{ archived: true }, { turnCompleted: false }, { parentId: id },
    { id: 'other' }, { status: 'em-andamento' }]) {
    let scans = 0, status;
    const poll = createRemoteConsumer({ settings, scan: async () => [scans++ ? { ...thread, ...update } : thread],
      post: async (route, body) => {
        if (route === 'claim') { assert.deepEqual(body.sessionIds, [hash]); return { job }; }
        status = body.status;
      }, resume: assert.fail });
    await poll(signal);
    assert.equal(status, 'failed');
  }
});

test('delivery acknowledgement retry does not repeat the resumed turn', async () => {
  let claims = 0, runs = 0, acks = 0;
  const poll = createRemoteConsumer({ settings, scan: async () => [thread],
    post: async (route, body) => {
      if (route === 'claim') { claims++; return { job }; }
      assert.deepEqual(body, { id: job.id, receipt: job.receipt, status: 'completed' });
      if (++acks === 1) throw new Error('offline');
    }, resume: async () => { runs++; } });
  await assert.rejects(poll(signal)); await poll(signal);
  assert.deepEqual([claims, runs, acks], [1, 1, 2]);
});

test('resume passes the prompt only on stdin and verifies matching thread completion', async () => {
  for (const confirmed of [false, true]) {
    const prompt = '-c arbitrary; whoami';
    function launch(binary, args, options) {
      assert.equal(binary, settings.binary); assert.equal(options.shell, false);
      assert.deepEqual(args, ['exec', '--sandbox', 'read-only', '--json', 'resume', id, '-']);
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill() {} });
      child.stdin.on('data', chunk => assert.equal(chunk.toString(), prompt));
      process.nextTick(() => {
        child.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: confirmed ? id : 'wrong' }) + '\n');
        child.stdout.write('{"type":"turn.completed"}\n'); child.emit('close', 0);
      });
      return child;
    }
    const execution = resumeRemoteTurn(settings, thread, prompt, signal, launch);
    if (confirmed) await execution; else await assert.rejects(execution);
  }
});
