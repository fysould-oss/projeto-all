import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { createStore } from './store.mjs';

test('project policy persists and limits concurrent dispatch across objectives without cancelling active work', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'projeto-all-executor-policy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'command.json');
  let store = await createStore(file);
  const project = await store.mutate('project.create', { name: 'Policy', path: directory });
  assert.deepEqual(project.executorPolicy, { enabled: true, maxActive: 2 });
  const objectiveA = await store.mutate('objective.create', { projectId: project.id, title: 'Objective A' });
  const objectiveB = await store.mutate('objective.create', { projectId: project.id, title: 'Objective B' });
  const first = await store.mutate('task.create', { objectiveId: objectiveA.id, title: 'First' });
  const second = await store.mutate('task.create', { objectiveId: objectiveB.id, title: 'Second' });
  let launches = 0;
  const prepare = async () => async () => { launches++; return randomUUID(); };
  await store.mutate('project.executorPolicy', { id: project.id, enabled: false, maxActive: 1 });
  store = await createStore(file);
  await assert.rejects(() => store.dispatchTask({ id: first.id }, prepare), /desabilitado/);
  assert.equal(launches, 0);
  for (const maxActive of [0, 1.5, 11]) {
    await assert.rejects(() => store.mutate('project.executorPolicy', { id: project.id, enabled: true, maxActive }), /limite inteiro/);
  }
  await store.mutate('project.executorPolicy', { id: project.id, enabled: true, maxActive: 1 });
  const outcomes = await Promise.allSettled([first, second].map(task => store.dispatchTask({ id: task.id }, prepare)));
  const accepted = outcomes.find(outcome => outcome.status === 'fulfilled').value;
  const rejected = outcomes.find(outcome => outcome.status === 'rejected').reason;
  assert.match(rejected.message, /atingiu o limite/);
  assert.equal(launches, 1);
  await store.mutate('project.executorPolicy', { id: project.id, enabled: false, maxActive: 1 });
  assert.equal(store.snapshot().tasks.find(task => task.id === accepted.id).executor.status, 'queued');
  await store.syncExecutorJobs([{ id: accepted.executor.id, status: 'done', updated: new Date().toISOString() }]);
  await store.mutate('project.executorPolicy', { id: project.id, enabled: true, maxActive: 1 });
  const other = accepted.id === first.id ? second : first;
  assert.equal((await store.dispatchTask({ id: other.id }, prepare)).executor.status, 'queued');
  assert.equal(launches, 2);
});
