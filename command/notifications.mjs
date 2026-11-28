const ACTIONS = new Set([
  'approval.request', 'approval.requestPush', 'approval.completed', 'approval.failed', 'approval.interrupted',
  'check.passed', 'check.failed', 'check.timed_out', 'check.cancelled',
  'task.check.passed', 'task.check.failed', 'task.check.timed_out', 'task.check.cancelled', 'task.check.interrupted',
  'task.executor.done', 'task.executor.failed', 'task.executor.cancelled', 'task.executor.dispatch_unknown',
  'task.dispatch.interrupted',
]);

export function notificationsFromAudit(audit, readIds = []) {
  const read = new Set(readIds);
  const notifications = [];
  for (let index = audit.length - 1; index >= 0 && notifications.length < 50; index--) {
    const entry = audit[index];
    if (!entry || typeof entry.id !== 'string' || !ACTIONS.has(entry.action)) continue;
    notifications.push({
      id: entry.id,
      at: entry.at,
      action: entry.action,
      result: entry.result,
      read: read.has(entry.id),
    });
  }
  return notifications;
}
