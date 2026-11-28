import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function cancelQueuedCoordinatorJob(directory, jobId) {
  return cancelQueuedCoordinatorJobs(directory, [jobId]);
}

export async function cancelQueuedCoordinatorJobs(directory, jobIds) {
  const ids = [...new Set(jobIds)];
  if (ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) {
    throw new TypeError('Identificador inválido.');
  }
  if (!ids.length) return true;
  const file = join(resolve(directory), 'jobs.sqlite');
  try { await access(file); } catch { return false; }
  let DatabaseSync; try { ({ DatabaseSync } = await import('node:sqlite')); } catch { throw new Error('SQLite indisponível.'); }
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout=500');
    db.exec('BEGIN IMMEDIATE');
    try {
      const remove = db.prepare(`UPDATE jobs SET status='failed', result='cancelled', prompt='', updated=?
        WHERE id=? AND status='queued'`);
      const at = new Date().toISOString();
      if (ids.some(id => remove.run(at, id).changes !== 1)) {
        db.exec('ROLLBACK');
        return false;
      }
      db.exec('COMMIT');
      return true;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally { db.close(); }
}
