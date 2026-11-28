import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const STATUSES = new Set(['queued', 'running', 'done', 'failed', 'waiting_remote']);
const RESULTS = new Set(['worktree_failed', 'executor_failed', 'interrupted', 'turn_incomplete', 'turn_completed', 'turn_failed', 'cancelled']);

function time(value) {
  if (typeof value !== 'string' || value.length > 35) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
}

export async function readCoordinatorJobs(directory, ids = null) {
  const file = join(resolve(directory), 'jobs.sqlite');
  try { await access(file); } catch { return { available: false, jobs: [] }; }
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { return { available: false, jobs: [] }; }
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const columns = 'SELECT id,project,status,slot,submitted,updated,files,result FROM jobs';
    const lookup = ids && db.prepare(columns + ' WHERE id = ?');
    const rows = lookup ? ids.map(id => lookup.get(id)).filter(Boolean)
      : db.prepare(columns + ' ORDER BY submitted DESC,rowid DESC LIMIT 50').all();
    const jobs = rows.flatMap(row => {
      if (typeof row.id !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(row.id)) return [];
      const job = {
        id: row.id,
        project: typeof row.project === 'string' && /^[^/\\:\x00-\x1f\x7f]{1,160}$/.test(row.project) ? row.project : 'Projeto',
        slot: ['a', 'b'].includes(row.slot) ? row.slot : undefined,
        submitted: time(row.submitted), updated: time(row.updated),
        files: Number.isSafeInteger(row.files) && row.files >= 0 ? row.files : undefined,
      };
      if (STATUSES.has(row.status)) job.status = row.status;
      if (row.status === 'failed' && row.result === 'cancelled') job.status = 'cancelled';
      if (RESULTS.has(row.result) || (typeof row.result === 'string' && /^executor_exit_(?:\d{1,5}|signal)$/.test(row.result))) {
        job.result = row.result;
      }
      return [job];
    });
    return { available: true, jobs };
  } catch { return { available: false, jobs: [] }; }
  finally { db?.close(); }
}
