import { execFile, spawn } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const exec = promisify(execFile);
const slots = ['a', 'b'];
const defaultHome = join(homedir(), '.projeto-all', 'coordinator');
const home = () => resolve(process.env.PROJETO_ALL_COORDINATOR_HOME || defaultHome);
const file = dir => join(dir, 'jobs.sqlite');

export function openQueue(dir = home()) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file(dir));
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, repo TEXT NOT NULL, project TEXT NOT NULL,
      base TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
      slot TEXT, owner INTEGER, child INTEGER, submitted TEXT NOT NULL, updated TEXT NOT NULL,
      worktree TEXT, files INTEGER, result TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS running_slot ON jobs(slot) WHERE status='running';
    CREATE TABLE IF NOT EXISTS events(job TEXT NOT NULL, seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, at TEXT NOT NULL);`);
  return db;
}

async function git(cwd, args) {
  const { stdout } = await exec('git', ['-C', cwd, ...args], { windowsHide: true, maxBuffer: 8_000_000 });
  return stdout;
}

export async function enqueue(db, repo, prompt) {
  if (!prompt?.trim() || Buffer.byteLength(prompt) > 32_768) throw new Error('Instrução vazia ou maior que 32 KiB.');
  const root = realpathSync((await git(repo, ['rev-parse', '--show-toplevel'])).trim());
  const base = (await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  const id = randomUUID(), now = new Date().toISOString();
  db.prepare('INSERT INTO jobs(id,repo,project,base,prompt,submitted,updated) VALUES(?,?,?,?,?,?,?)')
    .run(id, root, basename(root), base, prompt.trim(), now, now);
  return id;
}

function claim(db, slot) {
  const now = new Date().toISOString();
  return db.prepare(`UPDATE jobs SET status='running',slot=?,owner=?,updated=?
    WHERE id=(SELECT id FROM jobs WHERE status='queued' ORDER BY submitted,rowid LIMIT 1)
    AND NOT EXISTS (SELECT 1 FROM jobs WHERE slot=? AND status='running') RETURNING *`)
    .get(slot, process.pid, now, slot);
}

export function recentJobs(dir = home()) {
  let db;
  try {
    db = new DatabaseSync(file(dir), { readOnly: true });
    return db.prepare('SELECT id,project,status,slot,submitted,updated,files,result FROM jobs ORDER BY submitted DESC,rowid DESC LIMIT 50').all();
  } catch (e) {
    if (e.errcode === 14) return [];
    throw e;
  } finally { db?.close(); }
}

export async function runSlot(db, slot, { binary, model, dir = home(), start = spawn, signal } = {}) {
  if (!slots.includes(slot) || !isAbsolute(binary || '')) throw new Error('Escolha a ou b e indique o caminho absoluto do executável Codex.');
  if (signal?.aborted) return null;
  const job = claim(db, slot);
  if (!job) return null;
  const tree = join(dir, 'worktrees', job.id), branch = 'coordinator/' + job.id;
  let status = 'failed', result = 'worktree_failed', files = null;
  const now = () => new Date().toISOString();
  try {
    mkdirSync(join(dir, 'worktrees'), { recursive: true });
    await git(job.repo, ['worktree', 'add', '-b', branch, tree, job.base]);
    db.prepare('UPDATE jobs SET worktree=?,updated=? WHERE id=?').run(tree, now(), job.id);
    result = 'executor_failed';
    if (signal?.aborted) throw new Error('Interrompido.');
    const args = ['exec', '--json', '--sandbox', 'workspace-write', ...(model ? ['--model', model] : []), '-'];
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('PROJETO_ALL_')) delete env[key];
    const child = start(binary, args, { cwd: tree, windowsHide: true, shell: false,
      env, signal, stdio: ['pipe', 'pipe', 'ignore'] });
    const exit = new Promise(resolveExit => {
      child.once('error', () => resolveExit(-1));
      child.once('close', code => resolveExit(code));
    });
    if (child.pid) db.prepare('UPDATE jobs SET child=? WHERE id=?').run(child.pid, job.id);
    child.stdin.on('error', () => {});
    child.stdin.end(job.prompt);
    let completed = false, failed = false, seen = 0;
    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (!['thread.started','turn.started','item.started','item.completed','turn.completed','turn.failed','error'].includes(event?.type)) continue;
      if (event.type === 'turn.completed') completed = true;
      if (['turn.failed','error'].includes(event.type)) failed = true;
      if (seen++ < 1000 || event.type.startsWith('turn.')) db.prepare('INSERT INTO events(job,kind,at) VALUES(?,?,?)').run(job.id, event.type, now());
    }
    const code = await exit;
    if (signal?.aborted) { result = 'interrupted'; }
    else if (code !== 0) { result = 'executor_exit_' + (code ?? 'signal'); }
    else if (!completed || failed) { result = 'turn_incomplete'; }
    else {
      const porcelain = await git(tree, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all']);
      files = porcelain.split('\0').filter(Boolean).length;
      status = 'done'; result = 'turn_completed';
    }
  } catch { if (signal?.aborted) result = 'interrupted'; }
  finally {
    db.prepare("UPDATE jobs SET status=?,result=?,files=?,updated=?,prompt='',child=NULL WHERE id=?")
      .run(status, result, files, now(), job.id);
  }
  return { id: job.id, status, result, files };
}

export async function coordinateResume(db, id, cwd, signal, run) {
  const now = () => new Date().toISOString();
  // A remote delivery never becomes an editable local job. Keep its text only in memory.
  db.prepare("INSERT INTO jobs(id,repo,project,base,prompt,status,owner,submitted,updated) VALUES(?,?,?,'','','waiting_remote',?,?,?)")
    .run(id, cwd, basename(cwd), process.pid, now(), now());
  try {
    const take = db.prepare(`UPDATE jobs SET status='running',slot=?,updated=?
      WHERE id=? AND status='waiting_remote' AND NOT EXISTS
      (SELECT 1 FROM jobs WHERE slot=? AND status='running') RETURNING slot`);
    let slot;
    while (!slot) {
      signal.throwIfAborted();
      slot = slots.find(s => take.get(s, now(), id, s));
      if (!slot) await sleep(1000, undefined, { signal });
    }
    let emitted = 0;
    const record = (kind, pid) => {
      if (Number.isSafeInteger(pid)) db.prepare('UPDATE jobs SET child=? WHERE id=?').run(pid, id);
      if (emitted++ < 1000 && ['running','turn.started','item.started','item.completed','turn.completed'].includes(kind)) {
        db.prepare('INSERT INTO events(job,kind,at) VALUES(?,?,?)').run(id, kind, now());
      }
    };
    await run(record);
    db.prepare("UPDATE jobs SET status='done',result='turn_completed',child=NULL,updated=? WHERE id=?").run(now(), id);
  } catch (error) {
    db.prepare("UPDATE jobs SET status='failed',result='turn_failed',child=NULL,updated=? WHERE id=?").run(now(), id);
    throw error;
  }
}

export function recover(db, id) {
  const job = db.prepare("SELECT owner,child FROM jobs WHERE id=? AND status IN ('running','waiting_remote')").get(id);
  if (!job) throw new Error('Tarefa em execução não encontrada.');
  for (const pid of [job.owner, job.child].filter(Boolean)) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === 'ESRCH') continue; throw error; }
    throw new Error('O processo ainda existe. Aguarde o encerramento.');
  }
  db.prepare("UPDATE jobs SET status='failed',result='interrupted',prompt='',updated=? WHERE id=? AND status IN ('running','waiting_remote')")
    .run(new Date().toISOString(), id);
}
