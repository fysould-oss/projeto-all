import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { createCommandApi } from './api.mjs';

test('task.schedule waits for dependency, can be cleared, then runs npm after release', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'projeto-all-scheduler-'));
  await writeFile(join(folder, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
  const openHandler = () => createCommandApi(join(folder, 'command.json'), () => ({ status: 'ready', projects: [] }));
  let handler = openHandler();
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
  async function waitDone(id) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const current = await task(id);
      if (current.state === 'done') return current;
      if (current.state === 'failed') throw new Error('tarefa agendada falhou');
      await delay(50);
    }
    throw new Error('tarefa agendada não terminou a tempo');
  }

  const created = await mutate('project.create', { name: 'Scheduler', path: folder });
  const project = created.projects[0];
  const objective = (await mutate('objective.create', { projectId: project.id, title: 'Scheduler' })).objectives[0];
  const first = (await mutate('task.create', { objectiveId: objective.id, title: 'pré-requisito', dependencies: [] })).tasks.find(item => item.title === 'pré-requisito');
  const second = (await mutate('task.create', { objectiveId: objective.id, title: 'agendada', dependencies: [first.id] })).tasks.find(item => item.title === 'agendada');
  const unscheduled = (await mutate('task.create', { objectiveId: objective.id, title: 'removida', dependencies: [first.id] })).tasks.find(item => item.title === 'removida');

  const scheduled = await post('task.schedule', { id: second.id, script: 'test' });
  assert.equal(scheduled.response.status, 200, JSON.stringify(scheduled.body));
  assert.equal((await task(second.id)).state, 'pending');
  assert.equal((await task(second.id)).scheduledScript, 'test');
  await mutate('task.schedule', { id: unscheduled.id, script: 'test' });
  const cleared = await post('task.schedule', { id: unscheduled.id, script: null });
  assert.equal(cleared.response.status, 200, JSON.stringify(cleared.body));
  const afterClear = await task(unscheduled.id);
  assert.equal(afterClear.scheduledScript, undefined);

  await handler.close();
  handler = openHandler();
  handler.start();
  assert.equal((await task(second.id)).scheduledScript, 'test');
  assert.equal((await task(second.id)).check, undefined);
  await mutate('task.state', { id: first.id, state: 'running' });
  await mutate('task.state', { id: first.id, state: 'done' });
  const complete = await waitDone(second.id);
  assert.equal(complete.state, 'done');
  assert.equal(complete.check.script, 'test');
  assert.equal(complete.check.status, 'passed');
  assert.equal(complete.scheduledScript, undefined);
  assert.equal((await task(unscheduled.id)).state, 'pending');
});
