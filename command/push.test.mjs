import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { preparePush, executePush, githubRepository, summarizeGitHubChecks, summarizeGitHubStatuses, summarizeGitHubReviews } from './push.mjs';

test('summarizes current reviews without letting comments overwrite decisions', () => {
  const sha = 'a'.repeat(40);
  const review = (id, state, commit_id = sha) => ({ user: { id }, state, commit_id });
  assert.equal(summarizeGitHubReviews(null, sha), null);
  assert.deepEqual(summarizeGitHubReviews([
    review(1, 'CHANGES_REQUESTED'), review(1, 'APPROVED'), review(1, 'COMMENTED'),
    review(2, 'APPROVED'), review(2, 'DISMISSED'),
    review(3, 'CHANGES_REQUESTED', 'b'.repeat(40)), review(4, 'CHANGES_REQUESTED'),
    review(5, 'PENDING'),
  ], sha), { approved: 1, changesRequested: 1, earlier: 1, comments: 1, partial: false });
  assert.equal(summarizeGitHubReviews(Array.from({ length: 100 }, () => review(1, 'COMMENTED')), sha).partial, true);
});

test('projects external commit statuses without arbitrary URLs and distinguishes an empty result', () => {
  const sha = 'a'.repeat(40);
  assert.equal(summarizeGitHubStatuses({ sha: 'b'.repeat(40), total_count: 0, statuses: [] }, sha), null);
  assert.deepEqual(summarizeGitHubStatuses({ sha, total_count: 0, statuses: [], state: 'pending' }, sha),
    { total: 0, state: 'empty', contexts: [] });
  const statuses = [
    { context: 'CI/build', state: 'failure', target_url: 'https://example.invalid/private' },
    { context: 'CI/build', state: 'success' },
    { context: 'CI/test', state: 'pending' },
  ];
  assert.deepEqual(summarizeGitHubStatuses({ sha, total_count: 2, statuses, state: 'failure' }, sha),
    { total: 2, state: 'failure', contexts: [{ name: 'CI/build', state: 'failure' }, { name: 'CI/test', state: 'pending' }] });
});

test('summarizes check runs and distinguishes empty, partial, and unavailable results', () => {
  assert.equal(summarizeGitHubChecks(null), null);
  assert.equal(summarizeGitHubChecks({ total_count: 0, check_runs: [] }).partial, false);
  const check_runs = [
    { status: 'completed', conclusion: 'success' }, { status: 'in_progress' },
    { status: 'completed', conclusion: 'timed_out' }, { status: 'completed', conclusion: 'skipped' },
    { status: 'completed', conclusion: 'cancelled' },
  ];
  assert.deepEqual(summarizeGitHubChecks({ total_count: 6, check_runs }), {
    total: 6, pending: 1, passed: 1, skipped: 1, failed: 1, other: 1, partial: true,
  });
});

test('projects canonical GitHub remotes without credentials or redirects', () => {
  for (const url of ['https://github.com/owner/repo.git', 'ssh://git@github.com/owner/repo', 'git@github.com:owner/repo.git']) {
    assert.deepEqual(githubRepository(url), { owner: 'owner', repo: 'repo' });
  }
  for (const url of ['https://secret@github.com/owner/repo', 'https://github.com.example.invalid/owner/repo',
    'ssh://git@github.com:22/owner/repo', 'https://github.com/owner/repo?token=secret',
    'https://github.com/owner/...git', 'git@github.com:owner/repo/extra']) {
    assert.equal(githubRepository(url), null);
  }
});

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
