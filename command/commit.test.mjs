import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { prepareCommit, executeCommit } from './commit.mjs';

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
  const dir = await mkdtemp(join(tmpdir(), 'commit-fixture-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await run(dir, ['init', '-b', 'main']);
  await run(dir, ['config', 'user.name', 'Test']);
  await run(dir, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(dir, 'file.txt'), 'one\n');
  await run(dir, ['add', 'file.txt']);
  await run(dir, ['commit', '-m', 'base']);
  await writeFile(join(dir, 'file.txt'), 'two\n');
  await run(dir, ['add', 'file.txt']);
  return dir;
}

test('prepares and executes a real staged commit without unstaged content', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'unstaged.txt'), 'private\n');
  const prepared = await prepareCommit(dir, 'update file');
  assert.deepEqual(prepared.paths, ['file.txt']);
  const result = await executeCommit(dir, prepared);
  assert.match(result, /^[0-9a-f]{40}$/);
  assert.equal(await readFile(join(dir, 'unstaged.txt'), 'utf8'), 'private\n');
  assert.equal((await run(dir, ['status', '--porcelain'])).trim(), '?? unstaged.txt');
});

test('rejects stale approval when the index changes', async t => {
  const dir = await fixture(t);
  const prepared = await prepareCommit(dir, 'update file');
  await writeFile(join(dir, 'file.txt'), 'three\n');
  await run(dir, ['add', 'file.txt']);
  await assert.rejects(() => executeCommit(dir, prepared), /estado Git mudou/);
});

test('rejects detached HEAD, unfinished operations and configured signing', async t => {
  const dir = await fixture(t);
  await run(dir, ['config', 'commit.gpgSign', 'true']);
  await assert.rejects(() => prepareCommit(dir, 'update file'), /exige assinatura/);
  await run(dir, ['config', '--unset', 'commit.gpgSign']);
  const head = (await run(dir, ['rev-parse', 'HEAD'])).trim();
  await writeFile(join(dir, '.git', 'CHERRY_PICK_HEAD'), head + '\n');
  await assert.rejects(() => prepareCommit(dir, 'update file'), /operação Git pendente/);
  await rm(join(dir, '.git', 'CHERRY_PICK_HEAD'));
  await run(dir, ['checkout', '--detach']);
  await assert.rejects(() => prepareCommit(dir, 'update file'), /branch ativa/);
});
