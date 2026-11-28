import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { preparePush, executePush, githubCompareUrl, githubRepository, listBranches, listTagsAndStashes, summarizeGitHubChecks, summarizeGitHubStatuses,
  summarizeGitHubReviews, summarizeGitHubWorkflows } from './push.mjs';

test('builds a GitHub PR comparison with encoded refs and handles the default branch', () => {
  const repo = 'https://github.com/owner/repo';
  assert.equal(githubCompareUrl(repo, 'fix/ação#1', 'release/base'), repo + '/compare/release%2Fbase...fix%2Fa%C3%A7%C3%A3o%231?expand=1');
  assert.equal(githubCompareUrl(repo, 'fix/feature'), repo + '/compare/fix%2Ffeature?expand=1');
  assert.equal(githubCompareUrl(repo, 'main', 'main'), null);
  assert.equal(githubCompareUrl(repo, ''), null);
});

test('projects workflow runs for the exact PR commit and rejects invalid run data', () => {
  const sha = 'a'.repeat(40);
  assert.equal(summarizeGitHubWorkflows(null, sha), null);
  assert.deepEqual(summarizeGitHubWorkflows({ total_count: 0, workflow_runs: [] }, sha), {
    total: 0, runs: [], partial: false,
  });
  const workflow_runs = [
    { head_sha: sha, id: 1, name: ' APK ', status: 'completed', conclusion: 'success', run_attempt: 2, html_url: 'https://example.invalid' },
    { head_sha: sha, id: 2, status: 'in_progress' },
    { head_sha: sha, id: 3, status: 'completed', conclusion: { invalid: true } },
    { head_sha: 'b'.repeat(40), id: 4 },
    { head_sha: sha, id: -1 },
  ];
  assert.deepEqual(summarizeGitHubWorkflows({ total_count: 5, workflow_runs }, sha), {
    total: 5, runs: [
      { id: 1, name: 'APK', state: 'success', attempt: 2 },
      { id: 2, name: 'Workflow', state: 'in_progress', attempt: null },
      { id: 3, name: 'Workflow', state: null, attempt: null },
    ], partial: true,
  });
});

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
test('lists tag types and stash metadata without stash messages or contents', async t => {
  const { root } = await fixture(t);
  assert.deepEqual(await listTagsAndStashes(root), { tags: [], stashes: [], moreTags: false, moreStashes: false });
  await run(root, ['tag', 'v1']);
  await run(root, ['tag', '-a', 'release/v2', '-m', 'release annotation']);
  await writeFile(join(root, 'one.txt'), 'first-edited\n');
  await run(root, ['stash', 'push', '-m', 'private stash message']);
  await writeFile(join(root, 'one.txt'), 'second-edited\n');
  await run(root, ['stash', 'push', '-m', 'second private message']);
  const result = await listTagsAndStashes(root);
  const [annotated, lightweight] = result.tags;
  assert.equal(annotated.name, 'release/v2');
  assert.equal(annotated.type, 'tag');
  assert.equal(annotated.target, lightweight.sha);
  assert.equal(lightweight.name, 'v1');
  assert.equal(lightweight.type, 'commit');
  assert.deepEqual(result.stashes.map(stash => stash.ref), ['stash@{0}', 'stash@{1}']);
  assert.ok(result.stashes.every(stash => Number.isFinite(Date.parse(stash.created)) && /^[a-f0-9]{7,}$/.test(stash.sha)));
  assert.doesNotMatch(JSON.stringify(result), /private|edited|annotation/);
});

test('lists active, untracked, upstream and detached branch state from Git', async t => {
  const { root } = await fixture(t);
  await run(root, ['push', '-u', 'origin', 'main']);
  await run(root, ['branch', 'feature/local']);
  await run(root, ['commit', '--allow-empty', '-m', 'local']);
  const attached = await listBranches(root);
  assert.equal(attached.current, 'main');
  assert.equal(attached.branches[0].name, 'main');
  assert.equal(attached.branches[0].upstream, 'origin/main');
  assert.equal(attached.branches[0].tracking, '>');
  assert.equal(attached.branches.find(branch => branch.name === 'feature/local').upstream, '');
  await run(root, ['checkout', '--detach', 'HEAD']);
  const detached = await listBranches(root);
  assert.equal(detached.current, '');
  assert.equal(detached.detachedSha, attached.branches[0].sha);
});
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
