import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker from './index.mjs';
import { remoteQueue } from './remote.mjs';

const origin = 'https://projeto-all-condoconnect.sunnyode3.chatgpt.site';
const session = '0123456789abcdef01234567';

// Run the migration and production SQL on real SQLite with D1-shaped statements and transactions.
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../drizzle/0001_instructions.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('../drizzle/0002_instruction_progress.sql', import.meta.url), 'utf8'));
  const DB = {
    prepare(query) {
      const stmt = sql.prepare(query);
      return { bind(...args) { return {
        run: () => stmt.run(...args),
        first: () => stmt.get(...args),
        results: () => stmt.all(...args),
      }; } };
    },
    batch(statements) {
      sql.exec('BEGIN');
      try {
        const rows = statements.map(stmt => ({ results: stmt.results() }));
        sql.exec('COMMIT');
        return rows;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const env = { DB, OFFICE_OWNER_TOKEN: 'o'.repeat(40), OFFICE_DEVICE_TOKEN: 'd'.repeat(40) };
  function request(path, body, role = 'owner', override = {}) {
    const headers = role === 'owner' ? { 'X-Office-Owner': env.OFFICE_OWNER_TOKEN, Origin: origin }
      : { 'X-Office-Device': env.OFFICE_DEVICE_TOKEN };
    const req = new Request(origin + '/api/remote/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { ...headers, 'Content-Type': 'application/json', ...override },
      body: body ? JSON.stringify(body) : undefined,
    });
    return remoteQueue(req, env);
  }
  return { sql, env, request };
}

test('role separation, exact origin, configuration and private bundle gating', async () => {
  const { request, env } = fixture();
  const job = { id: crypto.randomUUID(), sessionId: session, instruction: 'Revisar tarefa' };
  assert.equal((await request('instructions', job, 'device')).status, 403);
  assert.equal((await request('instructions', job, 'owner', { Origin: 'https://example.org' })).status, 403);
  assert.equal((await request('claim', { sessionIds: [session] }, 'owner')).status, 403);
  assert.equal((await request('claim', { sessionIds: [session] }, 'device', { Origin: origin })).status, 403);
  assert.equal((await request('instructions', { ...job, instruction: 'a'.repeat(41_000) })).status, 413);
  assert.equal((await worker.fetch(new Request(origin + '/app.js'), env)).status, 503);
  assert.equal((await worker.fetch(new Request(origin + '/api/remote/instructions'), env)).status, 503);
  env.OFFICE_OWNER_TOKEN = env.OFFICE_DEVICE_TOKEN;
  assert.equal((await request('instructions', job)).status, 503);
});

test('atomic claims target only an eligible session, erase text and permit idempotent retries', async () => {
  const { request, sql } = fixture();
  const task = { id: crypto.randomUUID(), sessionId: session, instruction: 'Conferir a página inicial.' };
  assert.equal((await (await request('instructions', task)).json()).status, 'queued');
  assert.equal((await request('instructions', task)).status, 200);
  assert.equal((await request('instructions', { ...task, instruction: 'Outro texto' })).status, 409);
  assert.equal((await request('instructions', { ...task, mode: 'worktree' })).status, 409);
  assert.equal((await request('instructions', { ...task, mode: 'shell' })).status, 400);
  assert.deepEqual(await (await request('claim', { sessionIds: ['a'.repeat(24)] }, 'device')).json(), { job: null });
  const deliveries = await Promise.all([1, 2].map(async () =>
    (await (await request('claim', { sessionIds: [session] }, 'device')).json()).job));
  assert.equal(deliveries.filter(Boolean).length, 1);
  const delivery = deliveries.find(Boolean);
  assert.equal(delivery.instruction, task.instruction);
  assert.equal(sql.prepare('SELECT instruction FROM office_instructions').get().instruction, null);
  assert.equal((await request('instructions', task)).status, 200);
  const result = { id: task.id, receipt: delivery.receipt, status: 'completed', tests:'passed' };
  const beat = { id: task.id, receipt: delivery.receipt, phase: 'turn.started' };
  assert.equal((await request('progress', beat, 'owner')).status, 403);
  assert.equal((await request('progress', {...beat,receipt:crypto.randomUUID()}, 'device')).status, 409);
  assert.equal((await request('progress', {...beat,phase:'private text'}, 'device')).status, 400);
  assert.equal((await request('progress', beat, 'device')).status, 200);
  sql.prepare('UPDATE office_instructions SET updated_at=? WHERE id=?').run(Date.now()-46000,task.id);
  assert.equal((await (await request('instructions?id='+task.id)).json()).stale, true);
  assert.equal((await request('result', { ...result, receipt: crypto.randomUUID() }, 'device')).status, 409);
  assert.equal((await request('result', result, 'device')).status, 200);
  assert.equal((await request('result', result, 'device')).status, 200);
  assert.equal((await request('result', { ...result, status: 'failed' }, 'device')).status, 409);
  const read = await (await request('instructions?id=' + task.id)).json();
  assert.equal(read.id, task.id);
  assert.equal(read.status,'completed');
  assert.equal(read.stale,false);
  assert.equal(read.progress,'turn.started');
  assert.equal(read.tests,'passed');
  assert.equal((await request('progress',beat,'device')).status,409);
});

test('expired jobs are erased and cannot be claimed', async () => {
  const { request, sql } = fixture();
  const task = { id: crypto.randomUUID(), sessionId: session, instruction: 'Tarefa antiga' };
  await request('instructions', task);
  sql.prepare('UPDATE office_instructions SET created_at = ?').run(Date.now() - 3_600_001);
  assert.deepEqual(await (await request('claim', { sessionIds: [session] }, 'device')).json(), { job: null });
  assert.equal((await (await request('instructions?id=' + task.id)).json()).status, 'expired');
  assert.equal(sql.prepare('SELECT instruction FROM office_instructions').get().instruction, null);
});
