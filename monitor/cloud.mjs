import { execFile } from 'node:child_process';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const EXECUTABLE = process.platform === 'win32' ? 'codex.exe' : 'codex';
const REFRESH_INTERVAL = 45_000;
const PAGE_LIMIT = 3;
const PAGE_SIZE = 20;
const IDENTIFIER = /^[a-z0-9_-]{1,128}$/i;
const ENVIRONMENT_LABEL = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}(?:\/[\p{L}\p{N}][\p{L}\p{N}._-]{0,99})?$/u;
const STATUSES = new Map([
  ['pending', ['em-andamento', 'Tarefa pendente ou em execução na nuvem']],
  ['ready', ['concluido', 'Resultado da tarefa disponível']],
  ['applied', ['concluido', 'Alterações aplicadas']],
  ['error', ['bloqueado', 'A tarefa na nuvem registrou uma falha']],
]);

function asIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER.test(value) ? value : '';
}

function safeEnvironmentLabel(value) {
  if (typeof value !== 'string' || value.length > 165 || /[\x00-\x1f\x7f]/.test(value)) return '';
  const label = value.trim();
  return ENVIRONMENT_LABEL.test(label) ? label : '';
}

function normalizeTask(task) {
  const taskId = asIdentifier(task?.id);
  if (!taskId || typeof task.updated_at !== 'string') return null;
  const date = new Date(task.updated_at);
  if (!Number.isFinite(date.getTime())) return null;
  const updatedAt = date.toISOString();
  const id = asIdentifier(task.environment_id);
  const label = safeEnvironmentLabel(task.environment_label);
  const [status, activity] = STATUSES.get(typeof task.status === 'string' ? task.status.toLowerCase() : '')
    ?? ['disponivel', 'Status da tarefa indisponível'];
  return {
    environmentId: id ? 'cloud:' + id : label ? 'cloud:label:' + encodeURIComponent(label.toLowerCase()) : 'cloud',
    label,
    agent: {
      id: 'cloud:' + taskId,
      name: 'Tarefa do Codex Cloud',
      source: 'cloud',
      status,
      task: task.is_review === true ? 'Revisão de código na nuvem' : 'Tarefa na nuvem',
      activity,
      updatedAt,
      events: [{ at: updatedAt, activity }],
    },
  };
}

function groupByEnvironment(tasks) {
  const environments = new Map();
  for (const task of tasks.sort((a, b) => b.agent.updatedAt.localeCompare(a.agent.updatedAt))) {
    let group = environments.get(task.environmentId);
    if (!group) {
      group = { id: task.environmentId, name: '', source: 'cloud', agents: [], updatedAt: task.agent.updatedAt };
      environments.set(group.id, group);
    }
    if (!group.name) group.name = task.label;
    group.agents.push(task.agent);
  }
  return [...environments.values()].map(group => ({ ...group, name: group.name || 'Codex Cloud' }));
}

export function createCloudReader({ execute = executeFile, now = Date.now } = {}) {
  let cache = [];
  let nextRefresh = 0;
  let running;

  async function refresh() {
    const tasks = new Map();
    const seenCursors = new Set();
    let cursor;
    let workingDirectory;
    try {
      // Some CLI versions create error.log in the working directory.
      workingDirectory = await mkdtemp(join(tmpdir(), 'projeto-all-cloud-'));
      for (let page = 0; page < PAGE_LIMIT; page++) {
        const args = ['cloud', 'list', '--limit', String(PAGE_SIZE), '--json'];
        if (cursor) args.push('--cursor=' + cursor);
        const { stdout } = await execute(EXECUTABLE, args, {
          encoding: 'utf8',
          cwd: workingDirectory,
          maxBuffer: 1024 * 1024,
          timeout: 5_000,
          windowsHide: true,
          shell: false,
        });
        const data = JSON.parse(stdout);
        if (!Array.isArray(data?.tasks)) break;
        for (const raw of data.tasks.slice(0, PAGE_SIZE)) {
          const task = normalizeTask(raw);
          if (task && (!tasks.has(task.agent.id) || tasks.get(task.agent.id).agent.updatedAt < task.agent.updatedAt)) {
            tasks.set(task.agent.id, task);
          }
        }
        cursor = data.cursor;
        if (typeof cursor !== 'string' || !cursor || cursor.length > 2048 || /[\x00-\x1f\x7f]/.test(cursor)
          || seenCursors.has(cursor)) break;
        seenCursors.add(cursor);
      }
    } catch {
      // Local monitoring keeps working if the CLI or its cloud connection is unavailable.
    } finally {
      if (workingDirectory) {
        await rm(join(workingDirectory, 'error.log'), { force: true }).catch(() => {});
        await rmdir(workingDirectory).catch(() => {});
      }
    }
    cache = groupByEnvironment([...tasks.values()]);
    nextRefresh = now() + REFRESH_INTERVAL;
  }

  return {
    async scan() {
      if (now() >= nextRefresh) {
        running ??= refresh().finally(() => { running = null; });
        await running;
      }
      return structuredClone(cache);
    },
  };
}
