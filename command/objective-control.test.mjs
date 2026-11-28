import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { createCommandApi } from './api.mjs';

test('objective control pauses, resumes, and cancels work without changing completed tasks', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'projeto-all-objective-control-'));
  await writeFile(join(folder, 'package.json'), JSON.stringify({
    scripts: {
      test: 'node -e "setTimeout(() => process.exit(0), 250)"',
      build: 'node -e "setTimeout(() => process.exit(0), 5000)"',
    },
  }));
  const handler = createCommandApi(join(folder, 'command.json'), () => ({ status: 'ready', projects: [] }));
  const server = createServer((request, response) => handler(request, response, {}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await handler.close();
    await new Promise(resolve => server.close(resolve));
    await rm(folder, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function post(action, data) {
    const response = await fetch(origin, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ action, data }) });
    return { response, body: await response.json() };
  }
  async function mutate(action, data) {
    const result = await post(action, data);
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    return result.body;
  }
  async function task(id) {
    const snapshot = await (await fetch(origin)).json();
    return snapshot.tasks.find(item => item.id === id);
  }
  async function waitState(id, states) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const current = await task(id);
      if (states.includes(current.state)) return current;
      await delay(50);
    }
    throw new Error('tarefa não terminou a tempo');
  }

  const projectState = await mutate('project.create', { name: 'Controls', path: folder });
  const objective = (await mutate('objective.create', { projectId: projectState.projects[0].id, title: 'Controls' })).objectives[0];
  const completed = (await mutate('task.create', { objectiveId: objective.id, title: 'completed', dependencies: [] })).tasks[0];
  const blocker = (await mutate('task.create', { objectiveId: objective.id, title: 'blocker', dependencies: [] })).tasks.find(item => item.title === 'blocker');
  const queued = (await mutate('task.create', { objectiveId: objective.id, title: 'queued', dependencies: [blocker.id] })).tasks.find(item => item.title === 'queued');
  const active = (await mutate('task.create', { objectiveId: objective.id, title: 'active', dependencies: [] })).tasks.find(item => item.title === 'active');
  const pending = (await mutate('task.create', { objectiveId: objective.id, title: 'pending', dependencies: [active.id] })).tasks.at(-1);
  await mutate('task.state', { id: completed.id, state: 'running' });
  await mutate('task.state', { id: completed.id, state: 'done' });
  const scheduled = await post('task.schedule', { id: queued.id, script: 'test' });
  assert.equal(scheduled.response.status, 200, JSON.stringify(scheduled.body));
  const paused = await post('objective.control', { id: objective.id, control: 'pause' });
  assert.equal(paused.response.status, 200, JSON.stringify(paused.body));
  assert.equal(paused.body.objectives[0].status, 'paused');
  await mutate('task.schedule', { id: pending.id, script: 'test' });
  const blocked = await post('task.check', { id: active.id, script: 'test' });
  assert.equal(blocked.response.status, 400);
  await mutate('task.state', { id: blocker.id, state: 'done' });
  assert.equal((await task(queued.id)).scheduledScript, 'test');
  assert.equal((await task(queued.id)).state, 'pending');
  const graph = await (await fetch(origin + '/?view=graph&objective=' + objective.id)).json();
  assert.equal(graph.nodes.find(node => node.id === queued.id).ready, false);

  const resumed = await post('objective.control', { id: objective.id, control: 'resume' });
  assert.equal(resumed.response.status, 200, JSON.stringify(resumed.body));
  await waitState(queued.id, ['done']);
  assert.equal((await task(completed.id)).state, 'done');

  const started = await post('task.check', { id: active.id, script: 'build' });
  assert.equal(started.response.status, 200, JSON.stringify(started.body));
  const runId = started.body.tasks.find(item => item.id === active.id).check.id;
  const cancelled = await post('objective.control', { id: objective.id, control: 'cancel' });
  assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.objectives[0].status, 'cancelled');
  assert.equal((await waitState(active.id, ['cancelled', 'failed'])).state, 'cancelled');
  assert.equal((await task(completed.id)).state, 'done');
  assert.equal((await task(pending.id)).state, 'cancelled');
  assert.equal((await task(pending.id)).scheduledScript, undefined);
  const checks = await (await fetch(origin + '/?view=checks&project=' + projectState.projects[0].id)).json();
  assert.equal(checks.runs.find(run => run.id === runId).status, 'cancelled');
  assert.equal((await post('objective.control', { id: objective.id, control: 'resume' })).response.status, 400);
});
