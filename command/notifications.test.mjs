import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notificationsFromAudit } from './notifications.mjs';

test('derives recent outcome and approval metadata only', () => {
  const result = notificationsFromAudit([
    { id: 'old', at: '2026-01-01', action: 'task.create', result: 'ignored', secret: 'private' },
    { id: 'a', at: '2026-01-02', action: 'task.check.passed', result: 'passed', secret: 'private' },
    { id: 'b', at: '2026-01-03', action: 'approval.completed', result: 'approved', data: { prompt: 'private' } },
  ], ['a']);
  assert.deepEqual(result, [
    { id: 'b', at: '2026-01-03', action: 'approval.completed', result: 'approved', read: false },
    { id: 'a', at: '2026-01-02', action: 'task.check.passed', result: 'passed', read: true },
  ]);
});

test('caps notifications at the 50 most recent events', () => {
  const audit = Array.from({ length: 55 }, (_, index) => ({ id: String(index), at: String(index), action: 'approval.completed', result: 'ok' }));
  const result = notificationsFromAudit(audit);
  assert.equal(result.length, 50);
  assert.equal(result[0].id, '54');
  assert.equal(result.at(-1).id, '5');
});
