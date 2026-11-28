const KINDS = new Set(['all', 'approval', 'task', 'objective', 'project', 'git', 'check', 'preview']);

function normalize(value) {
  return typeof value === 'string' ? value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() : '';
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) ? Math.min(maximum, Math.max(minimum, n)) : fallback;
}

function matchesKind(action, kind) {
  return kind === 'all' || action.startsWith(kind + '.')
    || (kind === 'check' && (action === 'task.check' || action.startsWith('task.check.')));
}

function relatedNames(snapshot) {
  const projects = new Map(snapshot.projects?.map(project => [project.id, project]));
  const objectives = new Map(snapshot.objectives?.map(objective => [objective.id, objective]));
  const tasks = new Map(snapshot.tasks?.map(task => [task.id, task]));
  const approvals = new Map(snapshot.approvals?.map(approval => [approval.id, approval]));
  const checks = new Map(snapshot.checkHistory?.map(check => [check.id, check]));
  return entry => {
    const id = entry.result;
    const category = entry.action.split('.')[0];
    const task = category === 'task' ? tasks.get(id) : undefined;
    const objective = category === 'objective' ? objectives.get(id) : objectives.get(task?.objectiveId);
    const projectId = entry.projectId ?? objective?.projectId
      ?? (category === 'approval' ? approvals.get(id)?.projectId
        : category === 'check' ? checks.get(id)?.projectId : id);
    return [task?.title, objective?.title, projects.get(projectId)?.name];
  };
}

export function auditMetadata({ id, at, action, result, fields }) {
  return { id, at, action, result, fields };
}

export function searchAudit(snapshot, params = {}) {
  const get = key => typeof params.get === 'function' ? params.get(key) : params[key];
  const selected = get('kind');
  const kind = KINDS.has(selected) ? selected : 'all';
  const query = typeof get('q') === 'string' ? normalize(get('q').trim().slice(0, 120)) : '';
  const limit = boundedInteger(get('limit'), 25, 1, 100);
  const offset = boundedInteger(get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
  const names = query ? relatedNames(snapshot) : null;
  const entries = [];
  let total = 0;
  for (let index = snapshot.audit.length - 1; index >= 0; index--) {
    const entry = snapshot.audit[index];
    if (typeof entry?.action !== 'string' || !matchesKind(entry.action, kind)) continue;
    if (query && ![entry.action, entry.result, ...names(entry)].some(value => normalize(value).includes(query))) continue;
    if (total >= offset && entries.length < limit) {
      entries.push(auditMetadata(entry));
    }
    total++;
  }
  return { entries, total, offset, limit };
}
