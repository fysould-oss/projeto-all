import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createCommandApi } from './api.mjs';
import { prepareCoordinatorDispatch } from './coordinator-dispatch.mjs';

let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch {}

test('dispatch requires a trusted absolute module path', async () => {
  await assert.rejects(() => prepareCoordinatorDispatch({ executorModule: './monitor/coordinator.mjs' }), TypeError);
});

test('dispatch associates a persistent queue job with a task and requires review of completion', { skip: !DatabaseSync }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'projeto-all-dispatch-'));
  const executorModule = join(directory, 'executor.mjs');
  await writeFile(executorModule, [
    "import { DatabaseSync } from 'node:sqlite';",
    "import { randomUUID } from 'node:crypto';",
    "import { join } from 'node:path';",
    "export function openQueue(dir) {",
    "  const db = new DatabaseSync(join(dir, 'jobs.sqlite'));",
    "  db.exec('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,project TEXT,status TEXT,slot TEXT,submitted TEXT,updated TEXT,files INTEGER,result TEXT,prompt TEXT,repo TEXT,base TEXT,worktree TEXT)');",
    "  return db;",
    "}",
    "export async function enqueue(db, repo, instruction) {",
    "  const id = randomUUID();",
    "  const at = new Date().toISOString();",
    "  db.prepare('INSERT INTO jobs (id,project,status,submitted,updated,prompt) VALUES (?,?,?,?,?,?)').run(id,'Fixture','queued',at,at,instruction);",
    "  return id;",
    "}",
  ].join('\n'));
  const git = (...args) => execFileSync('git', args, { cwd: directory, windowsHide: true });
  git('init', '-q');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'Fixture');
  const handler = createCommandApi(join(directory, 'command.json'), () => ({ status: 'ready', projects: [] }), {
    coordinatorDirectory: directory, executorModule,
  });
  const server = createServer((req, res) => handler(req, res, {}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await handler.close();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  async function post(action, data, status = 200) {
    const response = await fetch(origin, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ action, data }),
    });
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body;
  }
  const { projects: [project] } = await post('project.create', { name: 'Project', path: directory });
  const { objectives: [objective] } = await post('objective.create', { projectId: project.id, title: 'Goal' });
  const { tasks: [first] } = await post('task.create', { objectiveId: objective.id, title: 'Predecessor' });
  const { tasks } = await post('task.create', { objectiveId: objective.id, title: 'Synthetic private instruction', dependencies: [first.id] });
  const taskId = tasks.at(-1).id;
  await post('task.dispatch', { id: taskId }, 400);
  await post('task.state', { id: first.id, state: 'done' });
  const sent = await post('task.dispatch', { id: taskId });
  const { id: jobId, status } = sent.tasks.at(-1).executor;
  assert.equal(status, 'queued');
  await post('task.dispatch', { id: taskId }, 400);
  await post('objective.control', { id: objective.id, control: 'cancel' }, 400);
  const jobs = await (await fetch(origin + '/?view=coordinator-jobs')).json();
  assert.equal(jobs.dispatchEnabled, true);
  assert.equal(jobs.jobs[0].id, jobId);
  assert.doesNotMatch(JSON.stringify(jobs), /Synthetic private instruction/);

  const base = git('rev-parse', 'HEAD').toString().trim();
  const worktree = join(directory, 'worktrees', jobId);
  await mkdir(join(directory, 'worktrees'), { recursive: true });
  git('worktree', 'add', '-qb', 'coordinator/' + jobId, worktree, base);
  await writeFile(join(worktree, 'tracked.txt'), 'reviewable marker\n');
  execFileSync('git', ['add', '--', 'tracked.txt'], { cwd: worktree, windowsHide: true });
  await writeFile(join(worktree, 'untracked.txt'), 'private fixture contents\n');
  const db = new DatabaseSync(join(directory, 'jobs.sqlite'));
  try {
    assert.equal(db.prepare('SELECT count(*) AS count FROM jobs').get().count, 1);
    db.prepare("UPDATE jobs SET status='done', files=2, repo=?, base=?, worktree=? WHERE id=?")
      .run(directory, base, worktree, jobId);
  } finally {
    db.close();
  }
  const graph = await (await fetch(origin + '/?view=graph&objective=' + objective.id)).json();
  const node = graph.nodes.find(item => item.id === taskId);
  assert.equal(node.state, 'review');
  assert.equal(node.executor.status, 'done');
  assert.equal(node.executor.files, 2);
  await post('task.state', { id: taskId, state: 'done' }, 400);
  const reviewUrl = origin + '/?view=executor-review&task=' + taskId;
  const review = await (await fetch(reviewUrl)).json();
  assert.match(review.output, /reviewable marker/);
  assert.ok(review.files.includes('untracked.txt'));
  assert.doesNotMatch(JSON.stringify(review), /private fixture contents/);
  await writeFile(join(worktree, 'tracked.txt'), 'changed after review\n');
  await post('task.state', { id: taskId, state: 'done', reviewRevision: review.revision }, 400);
  const refreshed = await (await fetch(reviewUrl)).json();
  await post('task.state', { id: taskId, state: 'done', reviewRevision: refreshed.revision }, 400);
  await writeFile(join(worktree, 'untracked.txt'), 'changed untracked marker\n');
  await post('task.state', { id: taskId, state: 'done', reviewRevision: refreshed.revision, confirmUntracked: true }, 400);
  const final = await (await fetch(reviewUrl)).json();
  const done = await post('task.state', { id: taskId, state: 'done', reviewRevision: final.revision, confirmUntracked: true });
  assert.equal(done.tasks.at(-1).state, 'done');
});
