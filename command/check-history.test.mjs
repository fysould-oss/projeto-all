import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeCheckHistory, summarizeCheckHistory } from './check-history.mjs';

test('summarizes only retained terminal outcomes from registered projects', () => {
  const results = summarizeCheckHistory([
    { projectId: 'a', status: 'passed' }, { projectId: 'a', status: 'running' },
    { projectId: 'a', status: 'timed_out' }, { projectId: 'removed', status: 'failed' },
    { projectId: 'a', status: 'cancelled' }, { projectId: 'a', status: 'interrupted' },
  ], [{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(results, [
    { projectId: 'a', passed: 1, failed: 0, timed_out: 1, cancelled: 1, interrupted: 1 },
    { projectId: 'b', passed: 0, failed: 0, timed_out: 0, cancelled: 0, interrupted: 0 },
  ]);
});

test('keeps only bounded public check metadata and updates by id', () => {
  const existing = Array.from({ length: 51 }, (_, index) => ({ id: String(index), projectId: 'p', script: 'test', status: 'passed', output: 'secret' }));
  const merged = mergeCheckHistory(existing, 'p', { id: '50', script: 'lint', status: 'failed', startedAt: '2026-11-28T00:00:00Z', durationMs: 12, exitCode: 1, output: 'private' });
  assert.equal(merged.length, 50);
  assert.equal(merged.at(-1).id, '50');
  assert.equal(merged.at(-1).script, 'lint');
  assert.deepEqual(Object.keys(merged.at(-1)).sort(), ['durationMs', 'exitCode', 'id', 'projectId', 'script', 'startedAt', 'status']);
  assert.equal('output' in merged.at(-1), false);
  assert.equal(merged.some(item => item.id === '0'), false);
});

test('does not mutate input and ignores invalid runs', () => {
  const existing = [{ id: 'a', projectId: 'p', script: 'build', status: 'running', durationMs: null, exitCode: null }];
  const before = JSON.stringify(existing);
  assert.deepEqual(mergeCheckHistory(existing, 'p', { id: '', script: 'test', status: 'failed' }), existing);
  assert.equal(JSON.stringify(existing), before);
  assert.deepEqual(mergeCheckHistory(null, 'p', null), []);
});
