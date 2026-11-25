import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const READ_LIMIT = 2 * 1024 * 1024;
const HISTORY_LIMIT = 20;
const CHAT_LENGTH_LIMIT = 800;
const NO_SIGNAL_DELAY = 10 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const ROLLOUT_FILE = /^rollout-.+\.jsonl$/i;
const IDENTIFIER = /^[a-z0-9_-]{1,128}$/i;
const AGENT_PATH = /^\/?[a-z0-9_-]{1,32}(?:\/[a-z0-9_-]{1,32}){0,7}$/i;
const CHAT_PHASES = new Set(['commentary', 'final', 'final_answer']);
const HIDDEN_CREDENTIAL = '[credencial ocultada]';
const HIDDEN_PATH = '[caminho ocultado]';
const ASSIGNED_CREDENTIAL = /(\b(?:[\w-]*(?:(?:api|access|private|secret)[ _-]?key|token|password|passwd|passphrase|senha|secret|credentials?|signature|[_-]pass)|authorization|cookie|session|pass|sig)["'`]?[ \t]*[:=][ \t]*|\B--(?:api-key|token|password|client-secret)(?:[ \t]+|=))(?:(?:bearer|basic)[ \t]+[a-z0-9._~+\/=-]+|"[^"\n]*"|'[^'\n]*'|`[^`\n]*`|[^\s<>,;\])}&]+)/gi;
const PROVIDER_TOKEN = /\b(?:sk[-_]|rk_live_|pk_live_|gh[pousr]_|github_pat_|AIza|AKIA|ASIA|xox[baprs]-|npm_)[a-z0-9_-]{12,}|\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+/gi;
const QUOTED_PATH = /(["'`<])(?:[a-z]:[\\/]+|\\\\|\/{1,2})[^\n"'`<>]+(?=["'`>])/gi;
const ABSOLUTE_PATH = /(?<![\p{L}\p{N}\\/])(?:[a-z]:[\\/]+|\\\\|(?<!:)\/\/|\/(?!\/))[^\s`"'<>()\[\]{},;]+/giu;

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
      agentRole: identifier(meta.agent_role) || identifier(spawn?.agent_role),
      name: '',
      status: 'disponivel',
      task: parentId ? 'Tarefa delegada' : 'Sessão do Codex',
      activity: 'Aguardando atividade',
      updatedAt: isoDate(timestamp) || isoDate(meta.timestamp) || isoDate(mtimeMs),
      events: [],
      chat: [],
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

function sanitizeChat(raw, cwd) {
  let text = raw.replace(/\r\n?/g, '\n').replace(/\t/g, ' ')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]|\p{Cf}/gu, '')
    .replace(/-----BEGIN [A-Z -]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z -]*PRIVATE KEY-----|$)/gi, HIDDEN_CREDENTIAL)
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^@\/\s]+@/gi, '$1' + HIDDEN_CREDENTIAL + '@')
    .replace(ASSIGNED_CREDENTIAL, '$1' + HIDDEN_CREDENTIAL)
    .replace(/\b(bearer|basic)[ \t]+[a-z0-9._~+\/=-]{8,}/gi, '$1 ' + HIDDEN_CREDENTIAL)
    .replace(PROVIDER_TOKEN, HIDDEN_CREDENTIAL)
    .replace(/\bfile:\/\/[^\s"'`<>()]+/gi, HIDDEN_PATH)
    .replace(QUOTED_PATH, '$1' + HIDDEN_PATH);
  if (cwd && cwd.length > 3) {
    for (const variant of new Set([cwd, cwd.replaceAll('\\', '/'), cwd.replaceAll('/', '\\')])) {
      text = text.replaceAll(variant, HIDDEN_PATH);
    }
  }
  const sanitized = text.replace(ABSOLUTE_PATH, HIDDEN_PATH).trim();
  return sanitized.length > CHAT_LENGTH_LIMIT ? Array.from(sanitized).slice(0, CHAT_LENGTH_LIMIT).join('') : sanitized;
}

function recordChat(state, phase, raw, at) {
  if (!CHAT_PHASES.has(phase) || typeof raw !== 'string') return;
  const text = sanitizeChat(raw, state.thread.cwd);
  if (!text) return;
  const commentary = phase === 'commentary';
  update(state, at, commentary ? 'Agente enviou atualização' : 'Agente enviou a resposta final',
    commentary ? 'em-andamento' : 'concluido');
  const chat = state.thread.chat;
  const previous = chat.findIndex(message => message.text === text);
  if (previous >= 0) chat.splice(previous, 1);
  chat.push({ at, text });
  if (chat.length > HISTORY_LIMIT) chat.shift();
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
  if (kind === 'message' && payload.role === 'assistant' && Array.isArray(payload.content) && CHAT_PHASES.has(payload.phase)) {
    const text = payload.content.filter(item => item?.type === 'output_text' && typeof item.text === 'string')
      .map(item => item.text).join('\n');
    recordChat(state, payload.phase, text, at);
    return;
  }
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
      recordChat(state, payload.phase, payload.message, at);
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
    const role = identifier(payload.agent_role);
    if (role) state.thread.agentRole = role;
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
    const now = Date.now();
    const cutoff = now - maxDays * DAY;
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
          const view = structuredClone(thread);
          if (view.status === 'em-andamento' && now - Date.parse(view.updatedAt) > NO_SIGNAL_DELAY) {
            view.status = 'sem-sinal';
          }
          result.set(thread.id, view);
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
