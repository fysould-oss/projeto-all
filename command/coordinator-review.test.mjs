import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { readCoordinatorReview } from './coordinator-review.mjs';

let DatabaseSync; try { ({ DatabaseSync } = await import('node:sqlite')); } catch {}
test('reviews only the canonical completed coordinator worktree', { skip: !DatabaseSync }, async t => {
  const project = await mkdtemp(join(tmpdir(), 'coordinator-review-project-')); const directory = await mkdtemp(join(tmpdir(), 'coordinator-review-home-')); const id = '123e4567-e89b-12d3-a456-426614174000';
  t.after(() => Promise.all([rm(project, { recursive: true, force: true }), rm(directory, { recursive: true, force: true })]));
  const git = (...args) => execFileSync('git', args, { cwd: project, windowsHide: true });
  await writeFile(join(project, 'a.txt'), 'a\n'); git('init', '-q'); git('add', '.'); git('-c', 'user.name=T', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD').toString().trim();
  const tree = join(directory, 'worktrees', id); await mkdir(join(directory, 'worktrees'), { recursive: true }); git('worktree', 'add', '-q', '-b', 'review/' + id, tree, base); await writeFile(join(tree, 'a.txt'), 'changed\n'); await writeFile(join(tree, 'new.txt'), 'new\n');
  const db = new DatabaseSync(join(directory, 'jobs.sqlite')); db.exec('CREATE TABLE jobs(id TEXT PRIMARY KEY,repo TEXT,project TEXT,base TEXT,prompt TEXT,status TEXT,slot TEXT,owner INTEGER,child INTEGER,submitted TEXT,updated TEXT,worktree TEXT,files INTEGER,result TEXT)'); db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, project, 'x', base, 'secret', 'done', null, null, null, '', '', tree, 2, 'turn_completed'); db.close();
  const result = await readCoordinatorReview(directory, id, project); assert.match(result.output, /changed/); assert.deepEqual(result.files.sort(), ['a.txt', 'new.txt']); assert.match(result.revision, /^[0-9a-f]{64}$/); assert.equal(result.base, base);
});
