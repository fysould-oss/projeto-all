import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { listFiles, changeIndex, listCommittedPaths } from './index.mjs';

function run(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => code ? reject(new Error(output)) : resolve(output));
  });
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'index-fixture-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await run(dir, ['init', '-b', 'main']);
  await run(dir, ['config', 'user.name', 'Test']);
  await run(dir, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(dir, 'tracked.txt'), 'one\n');
  await run(dir, ['add', 'tracked.txt']);
  await run(dir, ['commit', '-m', 'base']);
  return dir;
}

test('paginates committed paths and detects a changed tree between pages', async t => {
  const dir = await fixture(t);
  await Promise.all(Array.from({ length: 61 }, (_, index) =>
    writeFile(join(dir, 'Relatório ' + String(index).padStart(2, '0') + '.txt'), 'private contents')));
  await run(dir, ['add', '--all']);
  await run(dir, ['commit', '-m', 'paths']);
  await writeFile(join(dir, 'Relatório draft.txt'), 'uncommitted');
  await run(dir, ['add', 'Relatório draft.txt']);
  const first = await listCommittedPaths(dir, { query: 'RELATÓRIO' });
  assert.equal(first.total, 61);
  assert.equal(first.paths.length, 60);
  assert.equal(first.paths[0], 'Relatório 00.txt');
  assert.doesNotMatch(JSON.stringify(first), /private contents|draft/);
  const last = await listCommittedPaths(dir, { query: 'relatório', offset: first.next, revision: first.revision });
  assert.deepEqual(last.paths, ['Relatório 60.txt']);
  assert.equal(last.next, null);
  await run(dir, ['commit', '-m', 'draft']);
  await assert.rejects(() => listCommittedPaths(dir, { offset: first.next, revision: first.revision }), /HEAD mudou/);
});

test('lists and stages/unstages without changing worktree content', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'new.txt'), 'new\n');
  let files = await listFiles(dir);
  assert.equal(files.find(file => file.path === 'new.txt').status, '??');
  files = await changeIndex(dir, 'git.stage', 'new.txt');
  assert.equal(files.find(file => file.path === 'new.txt').status, 'A ');
  assert.equal(await readFile(join(dir, 'new.txt'), 'utf8'), 'new\n');
  files = await changeIndex(dir, 'git.unstage', 'new.txt');
  assert.equal(files.find(file => file.path === 'new.txt').status, '??');
});

test('requires a listed literal path', async t => {
  const dir = await fixture(t);
  await assert.rejects(() => changeIndex(dir, 'git.stage', 'missing.txt'), /não está listado/);
  await writeFile(join(dir, 'file[1].txt'), 'literal\n');
  await writeFile(join(dir, 'file1.txt'), 'neighbor\n');
  await changeIndex(dir, 'git.stage', 'file[1].txt');
  assert.equal((await run(dir, ['diff', '--cached', '--name-only'])).trim(), 'file[1].txt');
});

test('unstages both sides of a rename and leaves the renamed file in place', async t => {
  const dir = await fixture(t);
  await run(dir, ['mv', 'tracked.txt', 'renamed.txt']);
  const [rename] = await listFiles(dir);
  assert.equal(rename.index, 'R');
  assert.equal(rename.renameFrom, 'tracked.txt');
  await changeIndex(dir, 'git.unstage', 'renamed.txt');
  assert.equal(await run(dir, ['diff', '--cached', '--name-only']), '');
  assert.equal(await readFile(join(dir, 'renamed.txt'), 'utf8'), 'one\n');
});
