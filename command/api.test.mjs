import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createCommandApi } from './api.mjs';

test('persists workflow, gates dependent tasks and inspects a real Git worktree', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'projeto-all-command-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: folder, windowsHide: true });
  git('init', '-q');
  await writeFile(join(folder, 'sample.txt'), 'original\n');
  git('add', 'sample.txt');
  git('-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', 'commit', '-qm', 'Initial');
  await writeFile(join(folder, 'sample.txt'), 'changed\n');

  const db = join(folder, 'command.json');
  const getActivity = () => ({ status: 'ready', projects: [] });
  let handler = createCommandApi(db, getActivity);
  const server = createServer((request, response) => handler(request, response, {}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;

  const post = (action, data, source = origin) => fetch(origin, {
    method: 'POST',
    headers: { origin: source, 'content-type': 'application/json' },
    body: JSON.stringify({ action, data }),
  });
  async function mutate(action, data) {
    const result = await post(action, data);
    const body = await result.json();
    assert.equal(result.status, 200, JSON.stringify(body));
    return body;
  }

  assert.equal((await post('project.create', { name: 'Demo', path: folder }, 'https://example.invalid')).status, 403);
  const { projects: [project] } = await mutate('project.create', { name: 'Demo', path: folder });
  const { objectives: [objective] } = await mutate('objective.create', { projectId: project.id, title: 'Entrega' });
  const { tasks: [first] } = await mutate('task.create', { objectiveId: objective.id, title: 'Verificar', dependencies: [] });
  const { tasks } = await mutate('task.create', { objectiveId: objective.id, title: 'Revisar', dependencies: [first.id] });
  const second = tasks.find(entry => entry.id !== first.id);
  assert.equal((await post('task.state', { id: second.id, state: 'running' })).status, 400);
  await mutate('task.state', { id: first.id, state: 'running' });
  await mutate('task.state', { id: first.id, state: 'done' });
  await mutate('task.state', { id: second.id, state: 'running' });
  await mutate('task.state', { id: second.id, state: 'cancelled' });

  handler = createCommandApi(db, getActivity);
  const reopened = await (await fetch(origin)).json();
  assert.equal(reopened.tasks.find(entry => entry.id === second.id).state, 'cancelled');
  assert.equal(reopened.observed.sessions, 0);
  assert.ok(reopened.resources.total > 0);
  const diff = await (await fetch(origin + '/?view=diff&project=' + project.id)).json();
  assert.match(diff.output, /^\+changed$/m);
  const cleanCheck = await (await fetch(origin + '/?view=check&project=' + project.id)).json();
  assert.equal(cleanCheck.passed, true);
  await writeFile(join(folder, 'sample.txt'), 'changed \n');
  const failingCheck = await (await fetch(origin + '/?view=check&project=' + project.id)).json();
  assert.equal(failingCheck.passed, false);
  assert.match(failingCheck.output, /trailing whitespace/);
});

test('serializes concurrent mutations and keeps audit free of supplied titles', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'projeto-all-command-concurrent-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const db = join(folder, 'command.json');
  const handler = createCommandApi(db, () => ({ status: 'ready', projects: [] }));
  const server = createServer((request, response) => handler(request, response, {}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const post = (action, data, headers = {}) => fetch(origin, {
    method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ action, data }),
  });
  const { projects: [project] } = await (await post('project.create', { name: 'Concurrent', path: folder })).json();
  const objective = (await (await post('objective.create', { projectId: project.id, title: 'private objective title' })).json()).objectives[0];
  const responses = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    post('task.create', { objectiveId: objective.id, title: `private task title ${index}`, dependencies: [] })));
  assert.ok(responses.every(response => response.status === 200));
  const snapshot = await (await fetch(origin)).json();
  assert.equal(snapshot.tasks.length, 8);
  assert.equal(snapshot.audit.length, 10);
  const auditText = JSON.stringify(snapshot.audit);
  assert.doesNotMatch(auditText, /private objective title|private task title/);
  assert.equal((await fetch(origin, { headers: { 'sec-fetch-site': 'same-site' } })).status, 403);
  assert.equal((await post('task.state', { id: snapshot.tasks[0].id, state: 'done' }, { 'sec-fetch-site': 'same-site' })).status, 403);
});
