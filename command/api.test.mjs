import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
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
  const graphUrl = origin + '/?view=graph&objective=' + objective.id;
  const before = await (await fetch(graphUrl)).json();
  assert.equal(before.objective.id, objective.id);
  assert.deepEqual(before.edges, [{ from: first.id, to: second.id }]);
  assert.equal(before.nodes.find(node => node.id === first.id).ready, true);
  assert.equal(before.nodes.find(node => node.id === second.id).ready, false);
  assert.equal((await post('task.state', { id: second.id, state: 'running' })).status, 400);
  await mutate('task.state', { id: first.id, state: 'running' });
  await mutate('task.state', { id: first.id, state: 'done' });
  const after = await (await fetch(graphUrl)).json();
  assert.equal(after.nodes.find(node => node.id === second.id).ready, true);
  assert.equal((await fetch(origin + '/?view=graph&objective=missing')).status, 404);
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

test('previews and registers a dependent plan and executes a project script over HTTP', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'projeto-all-command-workflow-'));
  const openHandler = () => createCommandApi(join(folder, 'command.json'), () => ({ status: 'ready', projects: [] }));
  let handler = openHandler();
  const server = createServer((request, response) => handler(request, response, {}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await handler.close();
    await new Promise(resolve => server.close(resolve));
    await rm(folder, { recursive: true, force: true });
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const post = (action, data) => fetch(origin, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ action, data }),
  });
  const body = async response => {
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  await writeFile(join(folder, 'package.json'), JSON.stringify({ scripts: { test: 'node verify.cjs' } }));
  await writeFile(join(folder, 'verify.cjs'), 'console.log("fixture completed");\n');
  const { projects: [project] } = await body(await post('project.create', { name: 'Workflow', path: folder }));
  const title = 'Analise o projeto; implemente a tela; execute os testes';
  const { objectives: [objective] } = await body(await post('objective.create', { projectId: project.id, title }));
  const { steps } = await body(await fetch(origin + '/?view=plan&objective=' + objective.id));
  assert.equal(steps.length, 3);
  const { tasks } = await body(await post('objective.plan', { id: objective.id }));
  assert.deepEqual(tasks.map(task => task.dependencies), steps.map(step => step.dependencies.map(index => tasks[index].id)));
  assert.equal((await post('objective.plan', { id: objective.id })).status, 400);

  const checksUrl = origin + '/?view=checks&project=' + project.id;
  assert.deepEqual((await body(await fetch(checksUrl))).scripts, ['test']);
  assert.equal((await post('check.start', { projectId: project.id, script: 'deploy' })).status, 400);
  assert.equal((await post('check.cancel', { projectId: project.id, id: 'missing' })).status, 404);
  const { run } = await body(await post('check.start', { projectId: project.id, script: 'test' }));
  let completed;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const { runs } = await body(await fetch(checksUrl));
    completed = runs.find(entry => entry.id === run.id);
    if (completed?.output?.includes('fixture completed') && completed.durationMs != null) break;
    await delay(100);
  }
  assert.match(completed.output, /fixture completed/);
  assert.equal(completed.status, 'passed');
  assert.ok(completed.durationMs >= 0);
  await handler.close();
  assert.doesNotMatch(await readFile(join(folder, 'command.json'), 'utf8'), /fixture completed|"output"/);
  handler = openHandler();
  const history = (await body(await fetch(checksUrl))).runs;
  const restored = history.find(entry => entry.id === run.id);
  assert.equal(restored.status, 'passed');
  assert.equal(restored.durationMs, completed.durationMs);
  assert.equal(Object.hasOwn(restored, 'output'), false);

  const before = await body(await fetch(origin));
  const [notice] = before.notifications;
  assert.equal(notice.action, 'check.passed');
  assert.equal(notice.result, run.id);
  assert.equal(notice.read, false);
  assert.doesNotMatch(JSON.stringify(notice), /fixture completed|Workflow/);
  assert.equal((await post('notification.read', { id: 'missing' })).status, 400);
  const marked = await body(await post('notification.read', { id: notice.id }));
  assert.equal(marked.notifications[0].read, true);
  assert.equal(marked.audit.length, before.audit.length);
  await handler.close();
  handler = openHandler();
  assert.equal((await body(await fetch(origin))).notifications[0].read, true);
  const all = await body(await post('notification.read', { all: true }));
  assert.ok(all.notifications.every(item => item.read));
});

test('requires a current approval and commits exactly the reviewed Git index', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'projeto-all-approved-commit-'));
  const repository = join(folder, 'repo');
  await mkdir(repository);
  const git = (...args) => execFileSync('git', args, { cwd: repository, windowsHide: true }).toString().trim();
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Review Fixture');
  await writeFile(join(repository, 'sample.txt'), 'base\n');
  git('add', 'sample.txt');
  git('commit', '-qm', 'Initial');
  const base = git('rev-parse', 'HEAD');

  const file = join(folder, 'command.json');
  const activity = () => ({ status: 'ready', projects: [] });
  let handler = createCommandApi(file, activity);
  const server = createServer((request, response) => handler(request, response, {}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await handler.close();
    await new Promise(resolve => server.close(resolve));
    await rm(folder, { recursive: true, force: true });
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const post = (action, data) => fetch(origin, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ action, data }),
  });
  async function successful(action, data) {
    const response = await post(action, data);
    const json = await response.json();
    assert.equal(response.status, 200, JSON.stringify(json));
    return json;
  }
  const { projects: [project] } = await successful('project.create', { name: 'Review fixture', path: repository });
  await writeFile(join(repository, 'sample.txt'), 'staged\n');
  const filesURL = origin + '/?view=files&project=' + project.id;
  const { files } = await (await fetch(filesURL)).json();
  assert.ok(files.some(file => file.path === 'sample.txt'));
  assert.equal((await post('git.stage', { projectId: project.id, path: '../command.json' })).status, 400);
  await successful('git.stage', { projectId: project.id, path: 'sample.txt' });
  assert.match(git('diff', '--cached'), /^\+staged$/m);
  await successful('git.unstage', { projectId: project.id, path: 'sample.txt' });
  assert.equal(git('diff', '--cached'), '');
  assert.match(git('diff'), /^\+staged$/m);
  await successful('git.stage', { projectId: project.id, path: 'sample.txt' });
  await writeFile(join(repository, 'sample.txt'), 'user edit\n');
  const { approvals: [pending] } = await successful('approval.request', {
    projectId: project.id, message: 'Original proposal', reason: 'Review what is staged',
  });
  assert.equal(pending.state, 'pending');
  assert.equal(git('rev-parse', 'HEAD'), base);
  assert.ok(!Object.hasOwn(pending, 'prepared'));
  const approvalDiff = async id => (await (await fetch(origin + '/?view=approval-diff&approval=' + id)).json()).output;
  assert.match(await approvalDiff(pending.id), /^\+staged$/m);
  assert.doesNotMatch(await approvalDiff(pending.id), /user edit/);
  const { approvals: [edited] } = await successful('approval.edit', {
    id: pending.id, revision: pending.revision, message: 'Reviewed commit', reason: 'Updated rationale',
  });
  assert.notEqual(edited.revision, pending.revision);
  assert.equal((await post('approval.approve', { id: pending.id, revision: pending.revision })).status, 400);
  assert.equal(git('rev-parse', 'HEAD'), base);
  await handler.close();
  handler = createCommandApi(file, activity);
  const { approvals: [decision], audit } = await successful('approval.approve', { id: edited.id, revision: edited.revision });
  assert.equal(decision.state, 'completed', JSON.stringify(decision));
  assert.equal(decision.commit, git('rev-parse', 'HEAD'));
  assert.equal(git('show', 'HEAD:sample.txt'), 'staged');
  assert.match(git('diff', '--', 'sample.txt'), /user edit/);
  assert.doesNotMatch(JSON.stringify(audit), /Updated rationale|Reviewed commit/);
  assert.equal((await post('approval.approve', { id: edited.id, revision: edited.revision })).status, 400);

  git('add', 'sample.txt');
  const request = { projectId: project.id, message: 'Stale commit', reason: 'Test changed scope' };
  const { approvals } = await successful('approval.request', request);
  const stale = approvals.at(-1);
  await writeFile(join(repository, 'sample.txt'), 'changed stage\n');
  git('add', 'sample.txt');
  assert.match(await approvalDiff(stale.id), /^\+user edit$/m);
  assert.doesNotMatch(await approvalDiff(stale.id), /changed stage/);
  const failed = (await successful('approval.approve', { id: stale.id, revision: stale.revision })).approvals.at(-1);
  assert.equal(failed.state, 'failed');
  assert.equal(git('rev-parse', 'HEAD'), decision.commit);

  const reject = (await successful('approval.request', request)).approvals.at(-1);
  assert.equal((await successful('approval.reject', { id: reject.id, revision: reject.revision })).approvals.at(-1).state, 'rejected');
  assert.equal(git('rev-parse', 'HEAD'), decision.commit);

  const expired = (await successful('approval.request', request)).approvals.at(-1);
  const interrupted = (await successful('approval.request', request)).approvals.at(-1);
  await handler.close();
  const persisted = JSON.parse(await readFile(file, 'utf8'));
  persisted.approvals.find(item => item.id === expired.id).expiresAt = '2000-01-01T00:00:00.000Z';
  persisted.approvals.find(item => item.id === interrupted.id).state = 'executing';
  await writeFile(file, JSON.stringify(persisted));
  handler = createCommandApi(file, activity);
  const recovered = await (await fetch(origin)).json();
  assert.equal(recovered.approvals.find(item => item.id === expired.id).state, 'expired');
  assert.equal(recovered.approvals.find(item => item.id === interrupted.id).state, 'failed');
  assert.equal((await post('approval.approve', { id: expired.id, revision: expired.revision })).status, 400);
  assert.equal(git('rev-parse', 'HEAD'), decision.commit);
});

test('discloses and updates only the approved branch on a configured remote', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'projeto-all-approved-push-'));
  const repository = join(folder, 'repo');
  const remote = join(folder, 'remote.git');
  await mkdir(repository);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, windowsHide: true }).toString().trim();
  git(repository, 'init', '-qb', 'main');
  git(repository, '-c', 'user.name=Fixture', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'Publishable');
  git(folder, 'init', '-q', '--bare', remote);
  git(repository, 'remote', 'add', 'origin', remote);
  const head = git(repository, 'rev-parse', 'HEAD');
  const handler = createCommandApi(join(folder, 'command.json'), () => ({ status: 'ready', projects: [] }));
  const server = createServer((request, response) => handler(request, response, {}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await handler.close();
    await new Promise(resolve => server.close(resolve));
    await rm(folder, { recursive: true, force: true });
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  async function post(action, data) {
    const response = await fetch(origin, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ action, data }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  }
  const { projects: [project] } = await post('project.create', { name: 'Push fixture', path: repository });
  const remotes = await (await fetch(origin + '/?view=remotes&project=' + project.id)).json();
  assert.deepEqual(remotes.remotes, ['origin']);
  const { approvals: [pending] } = await post('approval.requestPush', { projectId: project.id, remote: 'origin', reason: 'Verify approved push' });
  assert.equal(pending.kind, 'git.push');
  assert.equal(pending.branch, 'main');
  assert.equal(pending.head, head);
  assert.equal(git(remote, 'for-each-ref'), '');
  assert.equal((await fetch(origin + '/?view=approval-diff&approval=' + pending.id)).status, 404);
  const { approvals: [edited] } = await post('approval.edit', { id: pending.id, revision: pending.revision, reason: 'Reviewed destination' });
  assert.notEqual(edited.revision, pending.revision);
  assert.equal(edited.destination, pending.destination);
  const { approvals: [completed], audit } = await post('approval.approve', { id: edited.id, revision: edited.revision });
  assert.equal(completed.state, 'completed', JSON.stringify(completed));
  assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), head);
  assert.equal(completed.commit, head);
  assert.doesNotMatch(JSON.stringify(audit), /Reviewed destination/);
});

test('persists one local preview per project without copying the URL to audit', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'projeto-all-preview-'));
  const file = join(folder, 'command.json');
  const activity = () => ({ status: 'ready', projects: [] });
  let handler = createCommandApi(file, activity);
  const server = createServer((request, response) => handler(request, response, {}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await handler.close();
    await new Promise(resolve => server.close(resolve));
    await rm(folder, { recursive: true, force: true });
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const post = (action, data) => fetch(origin, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ action, data }),
  });
  const { projects: [project] } = await (await post('project.create', { name: 'Preview fixture', path: folder })).json();
  const projectId = project.id;
  assert.equal((await post('preview.save', { projectId: 'missing', url: 'http://localhost:3000/' })).status, 400);
  assert.equal((await post('preview.save', { projectId, url: 'https://example.invalid/' })).status, 400);
  assert.equal((await post('preview.save', { projectId, url: 'http://localhost:3000/' })).status, 200);
  const url = 'http://127.0.0.1:8080/screen?fixture=1';
  assert.equal((await post('preview.save', { projectId, url })).status, 200);
  await handler.close();
  handler = createCommandApi(file, activity);
  const { previews, audit } = await (await fetch(origin)).json();
  assert.deepEqual(previews.map(preview => [preview.projectId, preview.url]), [[projectId, url]]);
  assert.doesNotMatch(JSON.stringify(audit), /localhost|127\.0\.0\.1|fixture=1/);
});
