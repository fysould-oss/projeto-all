import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { cancelQueuedCoordinatorJob, cancelQueuedCoordinatorJobs } from './coordinator-cancel.mjs';

let DatabaseSync; try { ({ DatabaseSync } = await import('node:sqlite')); } catch {}
test('cancels only queued coordinator jobs atomically', { skip: !DatabaseSync }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'coordinator-cancel-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const db = new DatabaseSync(join(dir, 'jobs.sqlite'));
  db.exec('CREATE TABLE jobs(id TEXT PRIMARY KEY,status TEXT,result TEXT,prompt TEXT,updated TEXT)');
  const queued = '123e4567-e89b-12d3-a456-426614174000', running = '123e4567-e89b-12d3-a456-426614174001';
  db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run(queued, 'queued', null, 'secret', 'old');
  db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run(running, 'running', null, 'active', 'old'); db.close();
  assert.equal(await cancelQueuedCoordinatorJobs(dir, [queued, running]), false);
  const previous = new DatabaseSync(join(dir, 'jobs.sqlite'), { readOnly: true });
  assert.equal(previous.prepare('SELECT status FROM jobs WHERE id=?').get(queued).status, 'queued');
  previous.close();
  assert.equal(await cancelQueuedCoordinatorJob(dir, queued), true);
  const check = new DatabaseSync(join(dir, 'jobs.sqlite'));
  assert.deepEqual({ ...check.prepare('SELECT status,result,prompt FROM jobs WHERE id=?').get(queued) }, { status: 'failed', result: 'cancelled', prompt: '' });
  check.close();
  assert.equal(await cancelQueuedCoordinatorJob(dir, running), false);
});

test('does not create a missing coordinator database', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'coordinator-cancel-empty-')); t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal(await cancelQueuedCoordinatorJob(dir, '123e4567-e89b-12d3-a456-426614174002'), false);
  await assert.rejects(access(join(dir, 'jobs.sqlite')), { code: 'ENOENT' });
});
