import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { readCoordinatorJobs } from './coordinator-status.mjs';

let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* optional runtime */ }

test('reads coordinator schema as a bounded public projection', { skip: !DatabaseSync }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'coordinator-status-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = new DatabaseSync(join(directory, 'jobs.sqlite'));
  db.exec(`CREATE TABLE jobs(id TEXT PRIMARY KEY, repo TEXT, project TEXT, base TEXT, prompt TEXT,
    status TEXT, slot TEXT, owner INTEGER, child INTEGER, submitted TEXT, updated TEXT,
    worktree TEXT, files INTEGER, result TEXT);`);
  db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    'job-1', '/private/repo', 'Demo', 'abc', 'secret prompt', 'done', 'a', 1, 2,
    '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', '/private/worktree', 3, 'turn_completed',
  );
  db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    'job-2', '/private/repo', 'Demo', 'abc', 'secret prompt', 'mystery', null, null, null,
    '2026-01-02T00:00:00Z', '2026-01-02T00:01:00Z', '/private/worktree', 0, 'unknown',
  );
  db.close();
  const result = await readCoordinatorJobs(directory);
  assert.equal(result.available, true);
  assert.equal(result.jobs.length, 2);
  assert.equal(result.jobs[0].status, undefined);
  assert.equal(result.jobs[1].project, 'Demo');
  assert.equal(result.jobs[1].status, 'done');
  assert.equal(result.jobs[1].slot, 'a');
  assert.equal('prompt' in result.jobs[1], false);
  assert.equal('repo' in result.jobs[1], false);
  assert.equal('worktree' in result.jobs[1], false);
});

test('tolerates a missing coordinator database without writing', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'coordinator-status-empty-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.deepEqual(await readCoordinatorJobs(directory), { available: false, jobs: [] });
});
