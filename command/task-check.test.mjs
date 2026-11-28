import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { createCommandApi } from './api.mjs';

test('task.check gates dependencies and persists npm completion metadata', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'projeto-all-task-check-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, 'package.json'), JSON.stringify({
    scripts: { test: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(1)"' },
  }));
  const db = join(folder, 'command.json');
  const activity = () => ({ status: 'ready', projects: [] });
  let handler = createCommandApi(db, activity);
  const server = createServer((request, response) => handler(request, response, {}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { handler.close(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function post(action, data) {
    const response = await fetch(origin, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ action, data }) });
    const body = await response.json();
    return { response, body };
  }
  async function mutate(action, data) {
    const result = await post(action, data);
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    return result.body;
  }
  async function waitTask(id) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const snapshot = await (await fetch(origin)).json();
      const task = snapshot.tasks.find(item => item.id === id);
      if (['done', 'failed'].includes(task.state)) return task;
      await delay(50);
    }
    throw new Error('check não terminou a tempo');
  }

  const { body: projectState } = await post('project.create', { name: 'Checks', path: folder });
  assert.equal(projectState.projects?.length, 1, JSON.stringify(projectState));
  const project = projectState.projects[0];
  const objective = (await mutate('objective.create', { projectId: project.id, title: 'Checks' })).objectives[0];
  const first = (await mutate('task.create', { objectiveId: objective.id, title: 'passa', dependencies: [] })).tasks.find(task => task.title === 'passa');
  const second = (await mutate('task.create', { objectiveId: objective.id, title: 'falha', dependencies: [first.id] })).tasks.find(task => task.title === 'falha');

  const blocked = await post('task.check', { id: second.id, script: 'lint' });
  assert.equal(blocked.response.status, 400);
  const started = await post('task.check', { id: first.id, script: 'test' });
  assert.equal(started.response.status, 200, JSON.stringify(started.body));
  const passed = await waitTask(first.id);
  assert.equal(passed.state, 'done');
  assert.equal(passed.check.script, 'test');
  assert.ok(passed.check.status);

  const failedStart = await post('task.check', { id: second.id, script: 'lint' });
  assert.equal(failedStart.response.status, 200, JSON.stringify(failedStart.body));
  const failed = await waitTask(second.id);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.check.script, 'lint');
  assert.ok(failed.check.status);
  const retry = await post('task.check', { id: second.id, script: 'test' });
  assert.equal(retry.response.status, 200, JSON.stringify(retry.body));
  const retried = await waitTask(second.id);
  assert.equal(retried.state, 'done');
  await handler.close();
  handler = createCommandApi(db, activity);
  const { runs } = await (await fetch(origin + '/?view=checks&project=' + project.id)).json();
  assert.equal(runs.find(run => run.id === failed.check.id).taskId, second.id);
  assert.equal(runs.find(run => run.id === retried.check.id).taskId, second.id);
  assert.ok(runs.every(run => !Object.hasOwn(run, 'output')));
  const { quality } = await (await fetch(origin)).json();
  assert.deepEqual(quality, [{ projectId: project.id, passed: 2, failed: 1, timed_out: 0, cancelled: 0, interrupted: 0 }]);
});
