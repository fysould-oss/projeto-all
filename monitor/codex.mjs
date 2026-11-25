import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const READ_LIMIT = 2 * 1024 * 1024;
const HISTORY_LIMIT = 20;
const DAY = 24 * 60 * 60 * 1000;
const ROLLOUT_FILE = /^rollout-.+\.jsonl$/i;
const IDENTIFIER = /^[a-z0-9_-]{1,128}$/i;
const AGENT_PATH = /^\/?[a-z0-9_-]{1,32}(?:\/[a-z0-9_-]{1,32}){0,7}$/i;

const toolLabels = new Map([
  ['exec_command', 'Terminal'],
  ['write_stdin', 'Terminal'],
  ['apply_patch', 'Edição de arquivos'],
  ['web.run', 'Consulta na web'],
  ['web__run', 'Consulta na web'],
  ['spawn_agent', 'Atribuição a um subagente'],
  ['followup_task', 'Atribuição a um subagente'],
  ['send_message', 'Coordenação de agentes'],
  ['list_agents', 'Coordenação de agentes'],
  ['wait_agent', 'Acompanhamento de agentes'],
  ['imagegen', 'Geração de imagem'],
]);

const eventLabels = new Map([
  ['exec_command_begin', 'Terminal em execução'],
  ['exec_command_end', 'Terminal finalizado'],
  ['patch_apply_begin', 'Editando arquivos'],
  ['patch_apply_end', 'Edição de arquivos finalizada'],
  ['mcp_tool_call_begin', 'Consultando integração'],
  ['mcp_tool_call_end', 'Consulta à integração finalizada'],
  ['web_search_begin', 'Consultando a web'],
  ['web_search_end', 'Consulta à web finalizada'],
]);

function identifier(value) {
  return typeof value === 'string' && IDENTIFIER.test(value) ? value : '';
}

function workspace(value) {
  if (typeof value !== 'string' || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) return '';
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value) ? value : '';
}

function isoDate(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function parseLine(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
}

async function discover(directory, files) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EPERM', 'EACCES'].includes(error.code)) return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) await discover(path.join(directory, entry.name), files);
    if (entry.isFile() && ROLLOUT_FILE.test(entry.name)) files.push(path.join(directory, entry.name));
  }
}

function initialState(meta, timestamp, mtimeMs, offset) {
  if (!meta || !identifier(meta.id)) return null;
  const spawn = meta.source?.subagent?.thread_spawn;
  const parentId = identifier(meta.parent_thread_id ?? spawn?.parent_thread_id);
  const rawPath = meta.agent_path ?? spawn?.agent_path;
  const agentPath = typeof rawPath === 'string' && rawPath.length <= 128 && AGENT_PATH.test(rawPath)
    ? rawPath : '';
  return {
    ownEvents: !parentId,
    offset,
    partial: Buffer.alloc(0),
    dropPartial: false,
    calls: new Map(),
    thread: {
      id: meta.id,
      parentId,
      cwd: workspace(meta.cwd),
      agentPath,
      name: '',
      status: 'disponivel',
      task: parentId ? 'Tarefa delegada' : 'Sessão do Codex',
      activity: 'Aguardando atividade',
      updatedAt: isoDate(timestamp) || isoDate(meta.timestamp) || isoDate(mtimeMs),
      events: [],
    },
  };
}

function update(state, at, activity, status) {
  const thread = state.thread;
  if (status) thread.status = status;
  const previous = thread.events.at(-1);
  thread.activity = activity;
  thread.updatedAt = at;
  if (previous?.activity === activity) {
    previous.at = at;
    return;
  }
  thread.events.push({ at, activity });
  if (thread.events.length > HISTORY_LIMIT) thread.events.shift();
}

function labelTool(payload) {
  const name = typeof payload.name === 'string' ? payload.name : '';
  if (toolLabels.has(name)) return toolLabels.get(name);
  if (payload.namespace === 'collaboration') return 'Coordenação de agentes';
  if (name.startsWith('mcp__') || typeof payload.namespace === 'string' && payload.namespace.startsWith('mcp__')) return 'Consulta a integração';
  if (payload.namespace === 'web') return 'Consulta na web';
  return 'Ferramentas do Codex';
}

function applyResponse(state, payload, at) {
  const kind = payload.type;
  const callId = identifier(payload.call_id);
  if (kind === 'function_call' || kind === 'custom_tool_call') {
    const label = labelTool(payload);
    if (callId) {
      state.calls.set(callId, label);
      if (state.calls.size > HISTORY_LIMIT * 2) state.calls.delete(state.calls.keys().next().value);
    }
    update(state, at, label, 'em-andamento');
  } else if (kind === 'function_call_output' || kind === 'custom_tool_call_output') {
    if (state.calls.delete(callId)) {
      update(state, at, 'Ferramenta retornou resultado', 'em-andamento');
    }
  }
}

function applyEvent(state, payload, at) {
  switch (payload.type) {
    case 'task_started':
    case 'turn_started':
      state.calls.clear();
      update(state, at, 'Turno iniciado', 'em-andamento');
      break;
    case 'task_complete':
    case 'turn_completed':
      state.calls.clear();
      update(state, at, 'Turno concluído', 'concluido');
      break;
    case 'turn_aborted':
    case 'turn_failed':
      state.calls.clear();
      update(state, at, 'Turno interrompido', 'bloqueado');
      break;
    case 'agent_message':
      if (payload.phase === 'commentary') update(state, at, 'Agente enviou atualização', 'em-andamento');
      break;
    case 'sub_agent_activity':
      if (payload.kind === 'started') update(state, at, 'Subagente iniciado', 'em-andamento');
      if (payload.kind === 'interacted') update(state, at, 'Interação com subagente', 'em-andamento');
      break;
    default:
      if (eventLabels.has(payload.type)) {
        const failed = payload.success === false || (Number.isInteger(payload.exit_code) && payload.exit_code !== 0);
        update(state, at, failed ? 'Ferramenta reportou uma falha' : eventLabels.get(payload.type), 'em-andamento');
      }
  }
}

function applyLine(state, bytes) {
  const item = parseLine(bytes);
  if (!item?.payload || typeof item.payload !== 'object') return;
  const { type, payload } = item;
  if (!state.ownEvents) {
    // A fork can contain an exact copy of its parent's earlier turns.
    const nestedTurn = (type === 'event_msg' || type === 'turn_context')
      && identifier(payload.turn_id) && identifier(payload.root_turn_id) && payload.turn_id !== payload.root_turn_id;
    const startedHere = type === 'event_msg' && (payload.type === 'task_started' || payload.type === 'turn_started');
    const identifiedHere = type === 'token_usage_record' && payload.thread_id === state.thread.id;
    const agentTrigger = type === 'inter_agent_communication_metadata' && Boolean(payload.trigger_turn);
    if (!(startedHere && nestedTurn) && !identifiedHere && !agentTrigger) return;
    state.ownEvents = true;
  }
  const at = isoDate(item.timestamp) || state.thread.updatedAt;
  if (type === 'event_msg') applyEvent(state, payload, at);
  if (type === 'response_item') applyResponse(state, payload, at);
  if (type === 'turn_context') {
    const cwd = workspace(payload.cwd);
    if (cwd) state.thread.cwd = cwd;
  }
}

async function readBytes(file, offset, length) {
  const bytes = Buffer.alloc(length);
  let total = 0;
  while (total < length) {
    const { bytesRead } = await file.read(bytes, total, length - total, offset + total);
    if (!bytesRead) break;
    total += bytesRead;
  }
  return bytes.subarray(0, total);
}

async function readSession(file, details, previous) {
  const replaced = previous && (previous.ino !== details.ino || previous.dev !== details.dev
    || details.size < previous.offset || details.size === previous.size);
  let state = replaced ? null : previous;
  if (!state) {
    const header = await readBytes(file, 0, Math.min(details.size, READ_LIMIT));
    const end = header.indexOf(10);
    if (end < 0) return null;
    const first = parseLine(header.subarray(0, end));
    if (first?.type !== 'session_meta') return null;
    state = initialState(first.payload, first.timestamp, details.mtimeMs, end + 1);
    if (!state) return null;
  }
  if (details.size - state.offset > READ_LIMIT) {
    state.offset = details.size - READ_LIMIT;
    state.partial = Buffer.alloc(0);
    state.dropPartial = (await readBytes(file, state.offset - 1, 1))[0] !== 10;
    state.calls.clear();
  }
  const bytes = await readBytes(file, state.offset, details.size - state.offset);
  state.offset += bytes.length;
  const data = state.partial.length ? Buffer.concat([state.partial, bytes]) : bytes;
  let start = 0;
  let end = data.indexOf(10);
  while (end !== -1) {
    if (!state.dropPartial && end - start <= READ_LIMIT) applyLine(state, data.subarray(start, end));
    state.dropPartial = false;
    start = end + 1;
    end = data.indexOf(10, start);
  }
  if (data.length - start > READ_LIMIT) state.dropPartial = true;
  state.partial = state.dropPartial ? Buffer.alloc(0) : Buffer.from(data.subarray(start));
  Object.assign(state, { ino: details.ino, dev: details.dev, mtimeMs: details.mtimeMs, size: details.size });
  return state;
}

export function createCodexReader({ codexHome, maxDays = 7 }) {
  const cache = new Map();
  let running;

  async function collect() {
    const result = new Map();
    const discovered = [];
    const current = new Set();
    const cutoff = Date.now() - maxDays * DAY;
    await discover(path.join(codexHome, 'sessions'), discovered);
    await discover(path.join(codexHome, 'archived_sessions'), discovered);
    for (const filename of discovered) {
      try {
        const details = await stat(filename);
        if (!details.isFile() || details.mtimeMs < cutoff) continue;
        current.add(filename);
        let state = cache.get(filename);
        if (!state || state.size !== details.size || state.mtimeMs !== details.mtimeMs
          || state.ino !== details.ino || state.dev !== details.dev) {
          const file = await open(filename, 'r');
          try {
            state = await readSession(file, details, state);
          } finally {
            await file.close();
          }
          if (state) cache.set(filename, state);
          else cache.delete(filename);
        }
        if (!state) continue;
        const thread = state.thread;
        if (!result.has(thread.id) || result.get(thread.id).updatedAt < thread.updatedAt) {
          result.set(thread.id, structuredClone(thread));
        }
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
      }
    }
    for (const filename of cache.keys()) {
      if (!current.has(filename)) cache.delete(filename);
    }
    return [...result.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  return {
    scan() {
      running ??= collect().finally(() => { running = null; });
      return running;
    },
  };
}
