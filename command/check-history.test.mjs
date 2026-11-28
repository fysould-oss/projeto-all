import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeCheckHistory } from './check-history.mjs';

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
