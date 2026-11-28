import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { preparePush, executePush } from './push.mjs';

const execute = promisify(execFile);

async function run(cwd, args) {
  return (await execute('git', args, { cwd, windowsHide: true })).stdout;
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'push-fixture-'));
  const bare = await mkdtemp(join(tmpdir(), 'push-bare-'));
  t.after(() => Promise.all([root, bare].map(path => rm(path, { recursive: true, force: true }))));
  await run(bare, ['init', '--bare']);
  await run(root, ['init', '-b', 'main']);
  await run(root, ['config', 'user.name', 'Test']);
  await run(root, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(root, 'one.txt'), 'one\n');
  await run(root, ['add', 'one.txt']);
  await run(root, ['commit', '-m', 'one']);
  await run(root, ['remote', 'add', 'origin', bare]);
  return { root, bare };
}
test('creates a branch and advances it via fast-forward on a local bare remote', async t => {
  const { root, bare } = await fixture(t);
  const prepared = await preparePush(root, 'origin');
  assert.equal(prepared.remoteHead, '');
  assert.deepEqual(prepared.paths, ['one.txt']);
  assert.match(await executePush(root, prepared), /^[0-9a-f]{40}$/);
  assert.equal((await run(bare, ['rev-parse', 'refs/heads/main'])).trim(), prepared.head);
  await run(root, ['commit', '--allow-empty', '-m', 'two']);
  const advance = await preparePush(root, 'origin');
  assert.equal(advance.remoteHead, prepared.head);
  assert.equal(await executePush(root, advance), advance.head);
});
test('rejects unknown destinations and credentials in URLs', async t => {
  const { root } = await fixture(t);
  await assert.rejects(() => preparePush(root, 'other'), /não configurado/);
  await run(root, ['remote', 'set-url', 'origin', 'https://user:fixture@example.invalid/repo.git']);
  await assert.rejects(() => preparePush(root, 'origin'), /sem credenciais/);
});

test('checks the push URL, which can differ from the fetch URL', async t => {
  const { root, bare } = await fixture(t);
  const destination = await mkdtemp(join(tmpdir(), 'push-destination-'));
  t.after(() => rm(destination, { recursive: true, force: true }));
  await run(destination, ['init', '--bare']);
  await run(root, ['push', 'origin', 'main']);
  await run(root, ['remote', 'set-url', '--push', 'origin', destination]);
  const prepared = await preparePush(root, 'origin');
  assert.equal(prepared.remoteHead, '');
  await executePush(root, prepared);
  assert.equal((await run(destination, ['rev-parse', 'refs/heads/main'])).trim(), prepared.head);
  assert.equal((await run(bare, ['rev-parse', 'refs/heads/main'])).trim(), prepared.head);
});

test('rejects changes to reviewed local or remote refs and refuses non-fast-forward updates', async t => {
  const { root, bare } = await fixture(t);
  const prepared = await preparePush(root, 'origin');
  await run(root, ['push', 'origin', 'main']);
  await assert.rejects(() => executePush(root, prepared), /estado Git ou o destino mudou/);
  await run(root, ['commit', '--allow-empty', '-m', 'two']);
  const advance = await preparePush(root, 'origin');
  await run(root, ['commit', '--allow-empty', '-m', 'three']);
  await assert.rejects(() => executePush(root, advance), /estado Git ou o destino mudou/);
  await run(root, ['push', 'origin', 'main']);
  await run(root, ['reset', '--soft', advance.head]);
  await assert.rejects(() => preparePush(root, 'origin'), /fast-forward/);
  assert.notEqual((await run(bare, ['rev-parse', 'refs/heads/main'])).trim(), advance.head);
});
