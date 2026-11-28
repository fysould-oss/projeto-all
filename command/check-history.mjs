const FIELDS = ['id', 'projectId', 'taskId', 'script', 'status', 'startedAt', 'durationMs', 'exitCode'];
const SCRIPTS = new Set(['lint', 'test', 'build', 'typecheck']);
const STATUSES = new Set(['running', 'passed', 'failed', 'timed_out', 'cancelled', 'interrupted']);

function publicRun(projectId, run) {
  if (!run || typeof run !== 'object') return null;
  const value = {};
  for (const field of FIELDS) {
    if (field === 'projectId') value[field] = projectId;
    else if (Object.hasOwn(run, field)) value[field] = run[field];
  }
  if (!['id', 'projectId'].every(field => typeof value[field] === 'string' && /^[a-z0-9_-]{1,128}$/i.test(value[field]))
    || !SCRIPTS.has(value.script) || !STATUSES.has(value.status)) return null;
  if (typeof value.taskId !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(value.taskId)) delete value.taskId;
  if (Object.hasOwn(value, 'startedAt') && (typeof value.startedAt !== 'string' || value.startedAt.length > 35 || !Number.isFinite(Date.parse(value.startedAt)))) delete value.startedAt;
  if (value.durationMs != null && (!Number.isFinite(value.durationMs) || value.durationMs < 0)) value.durationMs = null;
  if (value.exitCode != null && (!Number.isInteger(value.exitCode) || value.exitCode < 0)) value.exitCode = null;
  return value;
}

export function mergeCheckHistory(existing, projectId, run) {
  const history = Array.isArray(existing) ? existing : [];
  const next = history.map(item => publicRun(item?.projectId, item)).filter(Boolean);
  const current = publicRun(projectId, run);
  if (current) {
    const index = next.findIndex(item => item.id === current.id && item.projectId === current.projectId);
    if (index >= 0) next[index] = current;
    else next.push(current);
  }
  return next.slice(-50);
}

export function summarizeCheckHistory(history, projects) {
  const summaries = new Map(projects.map(({ id }) => [id, {
    projectId: id, passed: 0, failed: 0, timed_out: 0, cancelled: 0, interrupted: 0,
  }]));
  for (const run of history) {
    const summary = summaries.get(run.projectId);
    if (summary && STATUSES.has(run.status) && run.status !== 'running') summary[run.status] += 1;
  }
  return [...summaries.values()];
}
