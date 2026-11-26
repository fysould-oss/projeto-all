'use strict';

const statusLabels = {
  disponivel: 'Disponível',
  'a-fazer': 'A fazer',
  'em-andamento': 'Em andamento',
  bloqueado: 'Bloqueado',
  concluido: 'Concluído',
  'sem-sinal': 'Sem sinal',
  registrado: 'Registro histórico',
};
const sourceLabels = {
  local: 'Monitor local',
  cloud: 'Codex Cloud',
  mixed: 'Local + nuvem',
  catalog: 'Catálogo histórico',
};
const sections = ['agentes', 'regras'];
const statusOrder = ['em-andamento', 'bloqueado', 'sem-sinal', 'a-fazer', 'concluido', 'disponivel'];
const roleLabels = {
  coordenacao: 'Coordenação',
  contas: 'Contas e acesso',
  comunidade: 'Operações do condomínio',
  integracoes: 'Financeiro e integrações',
  qualidade: 'Qualidade e publicação',
};
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
const staleAfterMs = 75 * 1000;
const roleSlots = ['coordenacao', 'contas', 'comunidade', 'integracoes', 'qualidade'];
const desktopDesks = [[15.7, 51.2], [42.2, 34.2], [70.5, 54.7], [35.6, 56.8], [47, 56.8], [36.5, 78.5], [76, 70], [51.9, 34.2], [64, 86.6]];
const mobileDesks = [[17, 36.3], [40.5, 44.7], [68.7, 44.7], [40.5, 65.9], [68.7, 65.9], [22.4, 91.2], [43, 91.2], [63.7, 91.2], [84.3, 91.2]];
// Each desk has an outward route through nearby walkable space, played in reverse on return.
const desktopWalks = [
  [[19, 61], [25, 56], [30, 49]],
  [[42, 36], [43, 38], [47, 38]],
  [[71, 57], [66, 53], [64, 47]],
  [[35, 59], [35, 62], [30, 65]],
  [[47, 59], [47, 62], [53, 62]],
  [[36.5, 81], [41, 83], [48, 84]],
  [[76, 72], [70, 74], [65, 70], [62, 66]],
  [[52, 36], [51, 39], [55, 36]],
  [[63, 89], [58, 91], [54, 88]],
];
const mobileWalks = [
  [[17, 39], [29, 39], [29, 48]],
  [[40.5, 47], [53, 47], [56, 44]],
  [[68.7, 47], [58, 47], [56, 44]],
  [[40.5, 68], [53, 69], [56, 73]],
  [[68.7, 68], [58, 69], [56, 73]],
  [[22.4, 94], [31, 94], [33, 90]],
  [[43, 94], [51, 94], [53, 90]],
  [[63.7, 94], [71, 94], [73, 90]],
  [[84.3, 94], [91, 94], [91, 86]],
];
const mobileFloor = window.matchMedia('(max-width: 640px)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const board = Object.fromEntries([
  'connection', 'top-project', 'top-signal', 'scope-note', 'floor-count', 'floor-list', 'bridge-note',
  'map-current', 'map-meta', 'project-repository', 'project-state', 'team-filter', 'status-filter',
  'sort-filter', 'agent-search', 'map-scroll', 'office-map', 'map-agents', 'team-legend', 'map-capacity',
  'map-overflow', 'summary-observed', 'summary-observed-note', 'summary-active', 'summary-blocked',
  'summary-signal', 'summary-signal-note', 'summary-scope', 'list-view', 'office-view', 'list-meta',
  'list-source-note', 'agent-list', 'agent-list-scroll', 'agent-focus', 'inspector-source', 'activity-scope',
  'live-feed', 'project-feed', 'agent-chat', 'chat-empty', 'chat-follow', 'chat-new', 'inspector-note',
  'view-office', 'view-list', 'map-fit', 'map-zoom-out', 'map-zoom-in', 'map-zoom-label',
  'summary-floors', 'scene-log', 'scene-agent', 'scene-activity', 'scene-open-chat', 'chat-tab', 'map-motion',
].map(id => [id, document.getElementById(id)]));
const rules = document.querySelector('#rules');
const ruleSearch = document.querySelector('#rule-search');
const detailTabs = [...document.querySelectorAll('.detail-tab')];
const selections = new Map();
const seatAssignments = new Map();
const chatRecords = new Map();
const sceneMarkers = new Map();
let sceneFloor = null;
const filters = { search: '', team: '', status: '', sort: 'recent' };
let catalog;
let projectManifest;
let latest = { status: 'starting', projects: [], receivedAt: null };
let lastValidSnapshot;
const initialFloorKey = new URLSearchParams(location.search).get('andar') || '';
let floorKey = initialFloorKey;
let floorSelectionExplicit = false;
let currentFloorId = '';
let lastCatalog = '';
let lastSnapshotSignature = '';
let refreshTimer;
let refreshInFlight = false;
let view = readPreference('view', 'office') === 'list' ? 'list' : 'office';
let zoom = clamp(Number(readPreference('zoom', '1')), 1, 2);
let followMessages = true;
let motionEnabled = readPreference('motion', 'on') !== 'off';

function readPreference(key, fallback) {
  try { return localStorage.getItem('projeto-all.' + key) ?? fallback; } catch { return fallback; }
}

function savePreference(key, value) {
  try { localStorage.setItem('projeto-all.' + key, String(value)); } catch { /* Preferences are optional. */ }
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined && content !== null) node.textContent = String(content);
  return node;
}

function safeClass(value) {
  return typeof value === 'string' && /^[a-z0-9_-]+$/i.test(value) ? value : '';
}

function normalized(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function validDate(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  return Number.isFinite(Date.parse(value));
}

function timeLabel(value) {
  return validDate(value) ? dateFormat.format(new Date(value)) : 'Não informado';
}

function dateTime(value, fallback = 'Não informado') {
  const node = element('time', '', validDate(value) ? timeLabel(value) : fallback);
  if (validDate(value)) node.dateTime = new Date(value).toISOString();
  return node;
}

function setPressed(button, pressed) {
  button.type = 'button';
  button.setAttribute('aria-pressed', String(pressed));
}

function safeStatus(value) {
  return Object.hasOwn(statusLabels, value) ? value : 'disponivel';
}

function agentTeam(agent) {
  const roleTeam = catalog?.agents?.find(post => post.id === agent?.roleId)?.teamId;
  return roleTeam || agent?.teamId || '';
}

function teamName(teamId) {
  return catalog?.teams?.find(team => team.id === teamId)?.name || 'Equipe não informada';
}

function roleName(agent) {
  if (agent?.roleId && roleLabels[agent.roleId]) return roleLabels[agent.roleId];
  const historic = catalog?.agents?.find(post => post.id === agent?.roleId);
  return historic?.name || (agentTeam(agent) ? teamName(agentTeam(agent)) : 'Função não informada');
}

function agentActivity(agent) {
  return agent?.activity || agent?.task || 'Sem atividade registrada.';
}

function sourceLabel(source) {
  return sourceLabels[source] || 'Origem não informada';
}

function sourceClass(source) {
  return source === 'cloud' || source === 'local' || source === 'mixed' ? 'source-' + source : '';
}

function floors() {
  if (!catalog) return [];
  const history = (Array.isArray(catalog.agents) ? catalog.agents : [])
    .filter(agent => agent.updatedAt)
    .map(agent => ({ ...agent, status: 'registrado', source: 'catalog' }));
  const archive = {
    id: 'catalog',
    name: 'Catálogo histórico · CondoConnect',
    agents: history,
    archive: true,
    source: 'catalog',
    available: true,
  };
  const observed = new Map((Array.isArray(latest.projects) ? latest.projects : []).map(project => [project.id, project]));
  const listed = Array.isArray(projectManifest)
    ? projectManifest
    : [...observed.values()].filter(project => project.pinned);
  const fixed = listed.map(definition => {
    const project = observed.get(definition.id);
    observed.delete(definition.id);
    return {
      ...(project || {}),
      id: definition.id,
      name: definition.name || project?.name || definition.id,
      remoteUrl: definition.remoteUrl || project?.remoteUrl,
      pinned: true,
      agents: Array.isArray(project?.agents) ? project.agents : [],
    };
  });
  const discovered = [...observed.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  return [...fixed, ...discovered, archive];
}

function setFloorDescription(floor) {
  if (floor.archive) return 'Registro histórico';
  if (floor.available === false) return 'Pasta local indisponível';
  if (!local && typeof window.fetchOnlineActivity !== 'function') return 'Visão pública · sessões privadas';
  if (floor.source === 'cloud') return 'Codex Cloud';
  const total = floor.agents.length;
  const running = floor.agents.filter(agent => safeStatus(agent.status) === 'em-andamento').length;
  return running ? `${running} ${running === 1 ? 'ativa' : 'ativas'} · ${total} observada${total === 1 ? '' : 's'}`
    : `${total} ${total === 1 ? 'sessão observada' : 'sessões observadas'}`;
}

function floorButton(floor, index, active) {
  const button = element('button', 'floor-button' + (floor.agents.some(agent => safeStatus(agent.status) === 'em-andamento') ? ' has-running' : ''));
  button.dataset.floor = floor.id;
  setPressed(button, active);
  const label = element('span', 'floor-label');
  const title = element('strong', '', floor.name);
  const description = element('span', '', setFloorDescription(floor));
  const activity = element('span', 'floor-activity', floor.archive ? 'Catálogo' : sourceLabel(floor.source));
  label.append(title, description, activity);
  button.append(element('span', 'floor-number', floor.archive ? 'H' : String(index + 1)), label);
  button.addEventListener('click', () => {
    floorKey = floor.id;
    floorSelectionExplicit = true;
    renderOffice();
  });
  return button;
}

function seatsFor(floor) {
  if (floor.archive) return [];
  const assignments = seatAssignments.get(floor.id) || new Map();
  seatAssignments.set(floor.id, assignments);
  const agents = Array.isArray(floor.agents) ? floor.agents : [];
  const agentById = new Map(agents.map(agent => [agent.id, agent]));
  const orderedAgents = [...agents].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const desks = mobileFloor.matches ? mobileDesks : desktopDesks;
  const walks = mobileFloor.matches ? mobileWalks : desktopWalks;
  const roleAgents = new Map();
  for (const agent of orderedAgents) {
    if (!roleSlots.includes(agent.roleId)) continue;
    const current = roleAgents.get(agent.roleId);
    const active = safeStatus(agent.status) === 'em-andamento';
    const currentActive = current && safeStatus(current.status) === 'em-andamento';
    if (!current || active && !currentActive) roleAgents.set(agent.roleId, agent);
  }
  const fixedIds = new Set([...roleAgents.values()].map(agent => agent.id));
  const occupied = new Set([...roleAgents.keys()].map(roleId => roleSlots.indexOf(roleId)));
  for (const [id, slot] of [...assignments]) {
    if (!agentById.has(id) || fixedIds.has(id) || !Number.isInteger(slot) || slot < 0 || slot >= desks.length || occupied.has(slot)) {
      assignments.delete(id);
      continue;
    }
    occupied.add(slot);
  }
  const free = desks.map((_, index) => index).filter(index => !occupied.has(index));
  for (const agent of orderedAgents) {
    if (fixedIds.has(agent.id) || assignments.has(agent.id) || !free.length) continue;
    assignments.set(agent.id, free.shift());
    occupied.add(assignments.get(agent.id));
  }
  const fixed = roleSlots.flatMap((roleId, slot) => {
    const agent = roleAgents.get(roleId);
    return agent ? [{ ...agent, point: desks[slot], walk: walks[slot], teamId: agentTeam(agent), avatarRole: roleId, lead: roleId === 'coordenacao' }] : [];
  });
  const assigned = [...assignments].map(([id, slot]) => {
    const agent = agentById.get(id);
    return {
      ...agent,
      point: desks[slot],
      walk: walks[slot],
      teamId: agentTeam(agent),
      avatarRole: 'flex',
      lead: false,
    };
  });
  return [...fixed, ...assigned];
}

function filterMatches(agent) {
  const teamId = agentTeam(agent);
  const status = safeStatus(agent.status);
  if (filters.team && teamId !== filters.team) return false;
  if (filters.status && status !== filters.status) return false;
  if (filters.search) {
    const haystack = normalized([agent.name, roleName(agent), teamName(teamId), agent.activity, agent.task].join(' '));
    if (!haystack.includes(normalized(filters.search))) return false;
  }
  return true;
}

function sortedAgents(agents) {
  const copy = [...agents];
  if (filters.sort === 'name') return copy.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  if (filters.sort === 'status') {
    return copy.sort((a, b) => statusOrder.indexOf(safeStatus(a.status)) - statusOrder.indexOf(safeStatus(b.status))
      || String(a.name).localeCompare(String(b.name), 'pt-BR'));
  }
  return copy.sort((a, b) => (validDate(b.updatedAt) ? Date.parse(b.updatedAt) : 0)
    - (validDate(a.updatedAt) ? Date.parse(a.updatedAt) : 0));
}

function centerSelectedSeat() {
  const map = board['map-scroll'];
  const pin = board['map-agents'].querySelector('button[aria-pressed="true"]');
  if (!pin || map.scrollWidth <= map.clientWidth) return;
  const mapBounds = map.getBoundingClientRect();
  const pinBounds = pin.getBoundingClientRect();
  if (pinBounds.left < mapBounds.left + 60 || pinBounds.right > mapBounds.right - 60) {
    map.scrollLeft += pinBounds.left + pinBounds.width / 2 - mapBounds.left - map.clientWidth / 2;
  }
}

function selectAgent(agent, center = false) {
  if (!agent?.id) return;
  selections.set(floorKey, agent.id);
  renderOffice();
  if (center) window.requestAnimationFrame(centerSelectedSeat);
}

const animationSupported = typeof Element.prototype.animate === 'function';

function motionAllowed() {
  return animationSupported && motionEnabled && !reducedMotion.matches;
}

function walkFrames(point, waypoints) {
  const path = [point, ...waypoints, ...waypoints.slice(0, -1).reverse(), point];
  const travel = [0];
  for (let index = 1; index < path.length; index++) {
    const [x, y] = path[index];
    const [previousX, previousY] = path[index - 1];
    travel.push(travel[index - 1] + Math.hypot(x - previousX, (y - previousY) * (mobileFloor.matches ? 1 : .6)) * 330);
  }
  const duration = Math.max(28_000, travel.at(-1) + 13_000);
  const rest = duration - travel.at(-1);
  const position = ([x, y], offset) => ({ left: x + '%', top: y + '%', offset });
  const positions = [position(point, 0), ...path.map((step, index) => position(step, (rest + travel[index]) / duration))];
  const stride = [{ transform: 'none', offset: 0 }];
  let facing = 1;
  for (let index = 1; index < path.length; index++) {
    const dx = path[index][0] - path[index - 1][0];
    if (dx) facing = Math.sign(dx);
    const segment = travel[index] - travel[index - 1];
    const steps = Math.max(2, Math.round(segment / 165));
    for (let step = 0; step < steps; step++) {
      const offset = (rest + travel[index - 1] + segment * step / steps) / duration;
      stride.push({ transform: `translateY(${step % 2 ? -2 : 0}px) scaleX(${facing})`, offset, easing: 'steps(1, end)' });
    }
  }
  stride[0].easing = 'steps(1, end)';
  stride.push({ transform: 'none', offset: 1 });
  return { positions, stride, duration };
}

function animateWalk(seat, button, avatar, agent) {
  const { positions, stride, duration } = walkFrames(agent.point, agent.walk);
  let phase = 0;
  for (const character of agent.id) phase = (Math.imul(phase, 31) + character.codePointAt(0)) >>> 0;
  const options = { duration, iterations: Infinity };
  // A stable phase keeps the same footstep if a marker is recreated after filtering or a layout change.
  const start = -(phase % duration);
  const animations = [seat.animate(positions, options), avatar.animate(stride, options)];
  for (const animation of animations) animation.startTime = start;
  let hovered = false;
  const syncPlayback = () => {
    const interacting = hovered || document.activeElement === button;
    for (const animation of animations) {
      if (interacting) animation.pause();
      else animation.play();
    }
  };
  button.addEventListener('pointerenter', () => { hovered = true; syncPlayback(); });
  button.addEventListener('pointerleave', () => { hovered = false; syncPlayback(); });
  button.addEventListener('focus', syncPlayback);
  button.addEventListener('blur', syncPlayback);
}

function seatMarker(agent, moving) {
  const [x, y] = agent.point;
  const teamId = safeClass(agent.teamId);
  const status = safeStatus(agent.status);
  const seat = element('div', 'map-seat' + (teamId ? ' team-' + teamId : ''));
  seat.dataset.state = status;
  seat.style.left = x + '%';
  seat.style.top = y + '%';
  if (x < 13) seat.classList.add('bubble-left');
  else if (x > 87) seat.classList.add('bubble-right');
  if (y < 15) seat.classList.add('bubble-top');
  const button = element('button', 'seat-button ' + status + ' has-avatar');
  button.classList.toggle('agent-lead', agent.lead === true);
  button.dataset.agent = agent.id;
  button.setAttribute('aria-label', `${agent.name} · ${roleName(agent)} · ${statusLabels[status]}`);
  button.title = `${agent.name} · ${statusLabels[status]}`;
  button.addEventListener('click', () => selectAgent(agent));
  const initials = String(agent.name || '?').trim().split(/\s+/u).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('pt-BR');
  const avatar = element('span', 'agent-avatar', initials);
  avatar.dataset.avatar = safeClass(agent.avatarRole) || 'flex';
  avatar.setAttribute('aria-hidden', 'true');
  button.append(avatar);
  seat.append(button);
  const speech = element('div', 'speech');
  speech.setAttribute('aria-hidden', 'true');
  speech.append(element('strong', '', agent.name));
  speech.append(element('span', 'speech-status ' + status, status === 'em-andamento' ? 'Trabalhando' : statusLabels[status]));
  seat.append(speech);
  if (moving) animateWalk(seat, button, avatar, agent);
  return seat;
}

function renderMapMarkers(floor, agents, selected) {
  const root = board['map-agents'];
  const activeIds = new Set(agents.map(agent => agent.id));
  if (sceneFloor !== floor.id) {
    root.replaceChildren();
    sceneMarkers.clear();
    sceneFloor = floor.id;
  }
  for (const [id, marker] of sceneMarkers) {
    if (activeIds.has(id)) continue;
    marker.node.remove();
    sceneMarkers.delete(id);
  }
  const allowMotion = motionAllowed();
  const hasRoute = agents.some(agent => safeStatus(agent.status) === 'em-andamento');
  const motionButton = board['map-motion'];
  motionButton.disabled = !animationSupported || reducedMotion.matches || !hasRoute;
  setPressed(motionButton, allowMotion);
  motionButton.title = reducedMotion.matches ? 'Movimento reduzido pelo sistema' : 'Animação ilustrativa dos agentes';

  for (const agent of agents) {
    const status = safeStatus(agent.status);
    const moving = allowMotion && status === 'em-andamento';
    const signature = JSON.stringify([agent.name, roleName(agent), agent.teamId, agent.avatarRole, agent.lead, status, agent.point, agent.walk, moving]);
    let marker = sceneMarkers.get(agent.id);
    if (marker?.signature !== signature) {
      const node = seatMarker(agent, moving);
      if (marker) marker.node.replaceWith(node);
      else root.append(node);
      marker = { node, button: node.querySelector('button'), signature };
      sceneMarkers.set(agent.id, marker);
    }
    const chosen = agent.id === selected?.id;
    marker.node.classList.toggle('selected', chosen);
    setPressed(marker.button, chosen);
  }
}

function sourceTag(source) {
  const tag = element('span', 'source-tag ' + sourceClass(source), sourceLabel(source));
  return tag;
}

function agentRow(agent, selected) {
  const status = safeStatus(agent.status);
  const teamId = safeClass(agentTeam(agent));
  const row = element('button', 'agent-row' + (teamId ? ' team-' + teamId : ''));
  row.dataset.agent = agent.id;
  setPressed(row, selected);
  const main = element('span', 'agent-row-main');
  main.append(element('strong', '', agent.name), element('span', '', `${roleName(agent)} · ${teamName(agentTeam(agent))}`));
  const activity = element('span', 'agent-row-activity');
  activity.append(element('strong', '', agentActivity(agent)), element('span', '', 'Última atividade registrada'));
  const meta = element('span', 'agent-row-meta');
  meta.append(element('span', 'status ' + status, statusLabels[status]), sourceTag(agent.source));
  const time = dateTime(agent.updatedAt);
  meta.append(time);
  row.append(main, activity, meta);
  row.addEventListener('click', () => selectAgent(agent, true));
  return row;
}

function updateSignalDisplays() {
  const signal = timeLabel(latest.receivedAt);
  board['top-signal'].textContent = signal;
  board['summary-signal'].textContent = signal;
  board['top-signal'].title = validDate(latest.receivedAt) ? new Date(latest.receivedAt).toISOString() : '';
  board['summary-signal'].title = board['top-signal'].title;
  board['summary-signal-note'].textContent = validDate(latest.receivedAt)
    ? 'Sincronização do monitor'
    : local || typeof window.fetchOnlineActivity === 'function' ? 'Horário não informado' : 'Não publicado na visão pública';
}

function renderConnection() {
  const publicView = !local && typeof window.fetchOnlineActivity !== 'function';
  let label = 'Iniciando monitor';
  let state = 'is-waiting';
  if (publicView) {
    label = 'Visualização pública';
    state = 'is-public';
  } else if (latest.status === 'starting') {
    label = 'Aguardando monitor';
    state = 'is-waiting';
  } else if (latest.status === 'unavailable') {
    const age = validDate(latest.receivedAt) ? Date.now() - Date.parse(latest.receivedAt) : Infinity;
    label = age > staleAfterMs ? 'Snapshot desatualizado' : 'Falha temporária';
    state = age > staleAfterMs ? 'is-warning' : 'is-error';
  } else if (latest.status === 'connected') {
    const hasSessions = latest.projects.some(project => Array.isArray(project.agents) && project.agents.length > 0);
    label = hasSessions ? 'Monitor conectado' : 'Aguardando sessões';
    state = hasSessions ? 'is-live' : 'is-waiting';
  }
  board.connection.textContent = label;
  board.connection.className = 'connection ' + state;
  board.connection.title = label;
  board['scope-note'].textContent = publicView
    ? 'Visão pública: andares e catálogo publicados; sessões e conversas ficam no painel privado.'
    : 'Sessões resumidas pelo monitor; horários de atividade e de sincronização são distintos.';
  board['bridge-note'].hidden = !publicView;
  updateSignalDisplays();
}

function renderSummary(floor) {
  const agents = Array.isArray(floor.agents) ? floor.agents : [];
  const active = agents.filter(agent => safeStatus(agent.status) === 'em-andamento').length;
  const blocked = agents.filter(agent => safeStatus(agent.status) === 'bloqueado').length;
  const publicView = !local && typeof window.fetchOnlineActivity !== 'function';
  const liveMetrics = !floor.archive && !publicView;
  board['summary-observed'].textContent = floor.archive || liveMetrics ? String(agents.length) : 'Não informado';
  board['summary-active'].textContent = liveMetrics ? String(active) : 'Não informado';
  board['summary-blocked'].textContent = liveMetrics ? String(blocked) : 'Não informado';
  board['summary-observed-note'].textContent = floor.archive
    ? 'Catálogo histórico'
    : publicView ? 'Sessões não publicadas' : `${sourceLabel(floor.source)} · escopo do andar`;
  board['summary-scope'].textContent = floor.archive
    ? 'Catálogo histórico: os registros abaixo não ocupam as nove cadeiras do escritório ao vivo.'
    : publicView
      ? 'Visualização pública: os andares são publicados, mas sessões, atividade e horários ficam no painel privado.'
    : floor.available === false
      ? 'Pasta configurada, mas indisponível neste computador; não há inferência de atividade.'
      : 'Sessões observadas pelo monitor. Em andamento e bloqueadas são estados registrados, não métricas de progresso.';
  if (floor.archive) board['project-state'].textContent = 'Catálogo histórico';
  else if (publicView) board['project-state'].textContent = 'Visualização pública';
  else if (floor.available === false) board['project-state'].textContent = 'Pasta indisponível';
  else if (latest.status === 'unavailable') board['project-state'].textContent = validDate(latest.receivedAt) ? 'Snapshot desatualizado' : 'Falha temporária';
  else board['project-state'].textContent = sourceLabel(floor.source);
  board['map-capacity'].textContent = floor.archive
    ? 'O catálogo histórico não ocupa cadeiras.'
    : publicView
      ? 'Sessões não publicadas na visão pública.'
      : `${Math.min(agents.length, 9)} de 9 posições com personagens observados.`;
  const overflow = Math.max(0, agents.length - 9);
  board['map-overflow'].hidden = overflow === 0;
  board['map-overflow'].textContent = overflow
    ? `${overflow} ${overflow === 1 ? 'sessão adicional' : 'sessões adicionais'} na lista.`
    : '';
  updateSignalDisplays();
}

function renderAgentFocus(agent, floor) {
  window.selectRemoteSession?.(latest.status === 'connected' && !floor.archive ? agent : null);
  board['agent-focus'].replaceChildren();
  if (!agent) {
    board['agent-focus'].append(element('p', 'empty-state', filters.team || filters.status || filters.search
      ? 'Nenhuma sessão selecionada corresponde aos filtros.'
      : 'Nenhuma sessão observada neste andar.'));
    board['inspector-source'].textContent = 'Não informado';
    board['inspector-source'].className = 'source-badge';
    board['inspector-note'].textContent = 'Selecione uma sessão observada para ver os detalhes.';
    return;
  }
  const status = safeStatus(agent.status);
  const heading = element('div', 'agent-heading');
  heading.append(element('h3', '', agent.name), element('span', 'status ' + status, statusLabels[status]));
  board['agent-focus'].append(heading);
  board['agent-focus'].append(element('p', 'agent-role', `${roleName(agent)} · ${teamName(agentTeam(agent))}`));
  board['agent-focus'].append(element('p', 'agent-task', agentActivity(agent)));
  if (agent.task && agent.task !== agent.activity) board['agent-focus'].append(element('p', 'agent-role', `Tarefa: ${agent.task}`));
  const updated = element('p', 'agent-role');
  updated.append('Última atividade registrada · ', dateTime(agent.updatedAt));
  board['agent-focus'].append(updated);
  const origin = element('div', 'agent-origin');
  origin.append(sourceTag(agent.source));
  board['agent-focus'].append(origin);
  board['inspector-source'].textContent = sourceLabel(agent.source);
  board['inspector-source'].className = 'source-badge ' + sourceClass(agent.source);
  board['inspector-note'].textContent = floor.archive
    ? 'Registro histórico do catálogo; não representa uma sessão ao vivo.'
    : 'Atividade e respostas pertencem somente à sessão selecionada.';
}

function feedItem(at, text) {
  const item = element('li');
  item.append(dateTime(at), element('span', '', text));
  return item;
}

function renderSessionActivity(agent) {
  const events = Array.isArray(agent?.events)
    ? agent.events.filter(event => event && typeof event.activity === 'string').sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    : [];
  board['activity-scope'].textContent = agent ? `${events.length} registro${events.length === 1 ? '' : 's'} da sessão` : 'Sessão não selecionada';
  board['live-feed'].replaceChildren(...(events.length
    ? events.slice(0, 12).map(event => feedItem(event.at, event.activity))
    : [element('li', 'empty-state', agent ? 'Nenhuma atividade registrada nesta sessão.' : 'Selecione uma sessão observada.')]));
}

function renderProjectActivity(floor) {
  const events = [];
  if (Array.isArray(floor.events)) events.push(...floor.events.filter(event => event && typeof event.activity === 'string'));
  if (floor.lastChangeAt) {
    const changeCount = Number.isInteger(floor.changes) ? floor.changes : null;
    events.push({ at: floor.lastChangeAt, activity: changeCount === null
      ? 'Mudança de arquivo registrada no Git.'
      : `${changeCount} arquivo${changeCount === 1 ? '' : 's'} com alterações no Git.` });
  }
  if (floor.branch) events.push({ at: floor.updatedAt, activity: `Branch do projeto: ${floor.branch}.` });
  if (floor.source === 'cloud') events.push({ at: floor.updatedAt, activity: 'Atividade agrupada do Codex Cloud.' });
  events.sort((a, b) => (validDate(b.at) ? Date.parse(b.at) : 0) - (validDate(a.at) ? Date.parse(a.at) : 0));
  board['project-feed'].replaceChildren(...(events.length
    ? events.slice(0, 8).map(event => feedItem(event.at, event.activity))
    : [element('li', 'empty-state', 'Nenhuma atividade geral registrada para este projeto.')]));
}

function chatKey(floor, agent) {
  return `${floor.id}:${agent?.id || 'none'}`;
}

function renderChat(agent, floor) {
  const messages = Array.isArray(agent?.chat)
    ? agent.chat.filter(entry => typeof entry?.text === 'string' && entry.text.trim())
    : [];
  const feed = board['agent-chat'];
  const key = chatKey(floor, agent);
  const previous = chatRecords.get(key);
  const signature = messages.map(message => `${message.at || ''}\u0000${message.text}`).join('\u0001');
  const changed = !previous || previous.signature !== signature;
  const scrollTop = feed.scrollTop;
  const unread = changed && previous && !followMessages ? (previous.unread || 0) + Math.max(1, messages.length - previous.count) : previous?.unread || 0;
  feed.replaceChildren(...messages.map(message => {
    const entry = element('li', 'chat-entry');
    entry.append(dateTime(message.at, 'Horário não informado'), element('p', 'chat-text', message.text));
    return entry;
  }));
  board['chat-empty'].hidden = messages.length > 0;
  if (messages.length === 0) {
    board['chat-empty'].textContent = floor.archive
      ? 'O catálogo histórico contém atividade resumida, não respostas de uma sessão.'
      : agent ? 'Nenhuma resposta registrada nesta sessão.' : 'Selecione uma sessão observada para consultar suas respostas.';
  }
  if (followMessages && changed) feed.scrollTop = feed.scrollHeight;
  else feed.scrollTop = Math.min(scrollTop, feed.scrollHeight);
  chatRecords.set(key, { signature, count: messages.length, unread });
  board['chat-new'].hidden = unread === 0;
  board['chat-new'].textContent = unread === 1 ? '1 nova mensagem' : `${unread} novas mensagens`;
}

function renderActivity(agent, floor) {
  renderAgentFocus(agent, floor);
  renderSessionActivity(agent);
  renderProjectActivity(floor);
  renderChat(agent, floor);
}

function renderList(agents, selectedAgent) {
  const scrollTop = board['agent-list-scroll'].scrollTop;
  const rows = sortedAgents(agents);
  board['list-meta'].textContent = `${rows.length} resultado${rows.length === 1 ? '' : 's'} de ${floorAgentCount()} sessões observadas`;
  const sourceCounts = new Map();
  rows.forEach(agent => sourceCounts.set(agent.source, (sourceCounts.get(agent.source) || 0) + 1));
  board['list-source-note'].textContent = [...sourceCounts.entries()].map(([source, count]) => `${count} · ${sourceLabel(source)}`).join('  ');
  board['agent-list'].replaceChildren(...(rows.length
    ? rows.map(agent => agentRow(agent, agent.id === selectedAgent?.id))
    : [element('div', 'empty-state', 'Nenhuma sessão corresponde aos filtros atuais.')]));
  board['agent-list-scroll'].scrollTop = scrollTop;
}

function floorAgentCount() {
  const floor = floors().find(project => project.id === floorKey);
  return floor?.agents?.length || 0;
}

function showDetails(active) {
  for (const tab of detailTabs) {
    const selected = tab === active;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
  }
}

function renderOffice() {
  if (!catalog) return;
  const activeElement = document.activeElement;
  const activeFloor = activeElement?.dataset?.floor;
  const activeAgent = activeElement?.dataset?.agent;
  const activeInScene = board['map-agents'].contains(activeElement);
  const availableFloors = floors();
  const preferredFloorKey = floorSelectionExplicit ? floorKey : (initialFloorKey || floorKey);
  const floor = availableFloors.find(project => project.id === preferredFloorKey)
    || availableFloors.find(project => project.id === floorKey)
    || availableFloors.find(project => !project.archive && project.agents.some(agent => safeStatus(agent.status) === 'em-andamento'))
    || availableFloors[0];
  if (!floor) return;
  floorKey = floor.id;
  currentFloorId = floor.id;
  window.setLiveOfficeFloor?.(floorKey);
  board['floor-count'].textContent = String(availableFloors.length);
  board['summary-floors'].textContent = String(availableFloors.length);
  board['floor-list'].replaceChildren(...availableFloors.map((item, index) => floorButton(item, index, item.id === floor.id)));
  board['top-project'].textContent = floor.name;
  board['map-current'].textContent = floor.name;
  const metadata = [];
  if (floor.branch) metadata.push(`branch ${floor.branch}`);
  if (floor.isRepository && Number.isInteger(floor.changes)) metadata.push(`${floor.changes} arquivo${floor.changes === 1 ? '' : 's'} alterado${floor.changes === 1 ? '' : 's'}`);
  metadata.push(floor.archive ? 'Catálogo histórico' : `${floor.agents.length} sessão${floor.agents.length === 1 ? '' : 'ões'} observada${floor.agents.length === 1 ? '' : 's'}`);
  board['map-meta'].textContent = metadata.join(' · ');
  const repositoryUrl = floor.remoteUrl || '';
  const repositoryLink = board['project-repository'];
  repositoryLink.hidden = !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/i.test(repositoryUrl);
  if (repositoryLink.hidden) repositoryLink.removeAttribute('href');
  else repositoryLink.href = repositoryUrl;
  const allAgents = Array.isArray(floor.agents) ? floor.agents : [];
  const filteredAgents = allAgents.filter(filterMatches);
  const selectedAgent = allAgents.find(agent => agent.id === selections.get(floor.id))
    || allAgents.find(agent => safeStatus(agent.status) === 'em-andamento')
    || allAgents.find(agent => validDate(agent.updatedAt))
    || allAgents[0];
  if (selectedAgent) selections.set(floor.id, selectedAgent.id);
  const seats = seatsFor(floor);
  const filteredSeats = seats.filter(filterMatches);
  const visibleSelection = filteredSeats.find(agent => agent.id === selectedAgent?.id);
  renderMapMarkers(floor, filteredSeats, visibleSelection);
  board['scene-log'].hidden = !visibleSelection;
  board['scene-agent'].textContent = visibleSelection?.name || '';
  const latestReply = Array.isArray(visibleSelection?.chat) ? visibleSelection.chat.at(-1)?.text : null;
  board['scene-activity'].textContent = visibleSelection ? latestReply || agentActivity(visibleSelection) : '';
  renderSummary(floor);
  renderList(filteredAgents, selectedAgent);
  renderActivity(selectedAgent, floor);
  renderView();
  if (activeFloor || activeAgent) {
    window.requestAnimationFrame(() => {
      if (document.activeElement !== document.body && document.activeElement !== activeElement) return;
      const group = activeFloor ? board['floor-list'] : board[activeInScene ? 'map-agents' : 'agent-list'];
      const selector = activeFloor ? `[data-floor="${CSS.escape(activeFloor)}"]` : `[data-agent="${CSS.escape(activeAgent)}"]`;
      group.querySelector(selector)?.focus({ preventScroll: true });
    });
  }
}

function loadCatalog(data) {
  catalog = {
    teams: Array.isArray(data?.teams) ? data.teams : [],
    agents: Array.isArray(data?.agents) ? data.agents : [],
  };
  const teamValue = filters.team;
  board['team-filter'].replaceChildren(new Option('Todas', ''), ...catalog.teams.map(team => new Option(team.name, team.id)));
  board['team-filter'].value = catalog.teams.some(team => team.id === teamValue) ? teamValue : '';
  filters.team = board['team-filter'].value;
  board['status-filter'].replaceChildren(new Option('Todos', ''), ...statusOrder.map(status => new Option(statusLabels[status], status)));
  board['status-filter'].value = filters.status;
  board['team-legend'].replaceChildren(...catalog.teams.map(team => element('span', 'team-' + safeClass(team.id), team.name)));
}

function applyView() {
  const office = view === 'office';
  board['office-view'].hidden = !office;
  board['list-view'].hidden = office;
  board['view-office'].setAttribute('aria-pressed', String(office));
  board['view-list'].setAttribute('aria-pressed', String(!office));
}

function renderView() {
  applyView();
  board['office-map'].style.width = `${zoom * 100}%`;
  board['map-zoom-label'].textContent = `${Math.round(zoom * 100)}%`;
  board['map-zoom-out'].disabled = zoom <= 1;
  board['map-zoom-in'].disabled = zoom >= 2;
}

function setView(next) {
  view = next === 'list' ? 'list' : 'office';
  savePreference('view', view);
  applyView();
  if (view === 'office') window.requestAnimationFrame(centerSelectedSeat);
}

function setZoom(next, resetScroll = false) {
  zoom = clamp(Math.round(next * 4) / 4, 1, 2);
  savePreference('zoom', zoom);
  renderView();
  if (resetScroll) {
    board['map-scroll'].scrollLeft = 0;
    board['map-scroll'].scrollTop = 0;
  }
}

function syncFilters() {
  filters.search = board['agent-search'].value.trim();
  filters.team = board['team-filter'].value;
  filters.status = board['status-filter'].value;
  filters.sort = board['sort-filter'].value;
  renderOffice();
}

function showPage() {
  const route = location.hash === '#regras' ? 'regras' : 'agentes';
  for (const section of sections) {
    document.getElementById(section).hidden = section !== route;
    const link = document.querySelector(`[data-view="${section}"]`);
    if (section === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

async function readText(path) {
  const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error('Leitura indisponível');
  return response.text();
}

async function fetchActivity() {
  if (local) return readText('./api/activity');
  const snapshot = await window.fetchOnlineActivity?.();
  return snapshot || null;
}

function normalizedSnapshot(data) {
  return {
    status: typeof data?.status === 'string' ? data.status : 'unavailable',
    projects: Array.isArray(data?.projects) ? data.projects : [],
    receivedAt: validDate(data?.receivedAt) ? new Date(data.receivedAt).toISOString() : null,
  };
}

function snapshotSignature(snapshot) {
  return JSON.stringify({ status: snapshot.status, projects: snapshot.projects });
}

function setLatestSnapshot(snapshot) {
  latest = normalizedSnapshot(snapshot);
  if (latest.status !== 'unavailable') {
    lastValidSnapshot = latest;
  } else if (!lastValidSnapshot && latest.projects.length) {
    lastValidSnapshot = { ...latest, status: 'connected' };
  }
  const signature = snapshotSignature(latest);
  const changed = signature !== lastSnapshotSignature;
  lastSnapshotSignature = signature;
  return changed;
}

function preserveLastSnapshot() {
  const fallback = lastValidSnapshot || latest;
  return setLatestSnapshot({
    ...fallback,
    status: 'unavailable',
    receivedAt: fallback.receivedAt || latest.receivedAt || null,
  });
}

function scheduleRefresh(delay = 3500) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refreshOffice, delay);
}

async function refreshOffice() {
  if (document.hidden) {
    scheduleRefresh(15000);
    return;
  }
  if (refreshInFlight) {
    scheduleRefresh(1000);
    return;
  }
  refreshInFlight = true;
  let changed = false;
  try {
    const archive = await readText('./progress.json');
    if (archive !== lastCatalog) {
      loadCatalog(JSON.parse(archive));
      lastCatalog = archive;
      changed = true;
    }
  } catch {
    if (!catalog) board.connection.textContent = 'Catálogo indisponível';
  }
  if (!projectManifest) {
    try {
      projectManifest = JSON.parse(await readText('./projects.json'));
      changed = true;
    } catch { /* O monitor pode fornecer projetos descobertos. */ }
  }
  const observing = local || typeof window.fetchOnlineActivity === 'function';
  if (observing) {
    try {
      const raw = await fetchActivity();
      if (raw) {
        const snapshotChanged = setLatestSnapshot(typeof raw === 'string' ? JSON.parse(raw) : raw);
        changed = snapshotChanged || changed;
      } else {
        const snapshotChanged = preserveLastSnapshot();
        changed = snapshotChanged || changed;
      }
    } catch {
      const snapshotChanged = preserveLastSnapshot();
      changed = snapshotChanged || changed;
    }
  }
  if (catalog) {
    renderConnection();
    if (changed) renderOffice();
  }
  refreshInFlight = false;
  scheduleRefresh(document.hidden ? 15000 : 3500);
}

function renderRules() {
  const term = normalized(ruleSearch.value.trim());
  const groups = Array.isArray(window.businessRules) ? window.businessRules : [];
  const matches = groups.flatMap(group => {
    const entries = (Array.isArray(group.entries) ? group.entries : []).filter(rule =>
      normalized([group.title, rule.title, rule.text].join(' ')).includes(term));
    if (!entries.length) return [];
    const details = element('details', 'rule-group');
    details.open = Boolean(term) || group.open === true;
    const list = element('ul', 'rule-list');
    list.append(...entries.map(rule => {
      const item = element('li');
      item.append(element('h3', '', rule.title), element('p', '', rule.text));
      const sources = Array.isArray(rule.sources) ? rule.sources : [];
      if (sources.length) item.append(element('p', 'sources', 'Fontes: ' + sources.join(' · ')));
      return item;
    }));
    details.append(element('summary', '', group.title), list);
    return [details];
  });
  rules.replaceChildren(...(matches.length ? matches : [element('p', 'panel-note', 'Nenhuma regra encontrada.')]));
}

board['team-filter'].addEventListener('change', syncFilters);
board['status-filter'].addEventListener('change', syncFilters);
board['sort-filter'].addEventListener('change', syncFilters);
board['agent-search'].addEventListener('input', syncFilters);
mobileFloor.addEventListener('change', renderOffice);
reducedMotion.addEventListener('change', renderOffice);
board['map-motion'].addEventListener('click', () => {
  motionEnabled = !motionEnabled;
  savePreference('motion', motionEnabled ? 'on' : 'off');
  renderOffice();
});
board['scene-open-chat'].addEventListener('click', () => {
  showDetails(board['chat-tab']);
  board['chat-tab'].focus();
});
board['view-office'].addEventListener('click', () => setView('office'));
board['view-list'].addEventListener('click', () => setView('list'));
board['map-fit'].addEventListener('click', () => setZoom(1, true));
board['map-zoom-out'].addEventListener('click', () => setZoom(zoom - .25));
board['map-zoom-in'].addEventListener('click', () => setZoom(zoom + .25));
board['chat-follow'].addEventListener('change', () => {
  followMessages = board['chat-follow'].checked;
  if (followMessages) {
    board['agent-chat'].scrollTop = board['agent-chat'].scrollHeight;
    const key = chatKey({ id: currentFloorId }, floors().find(floor => floor.id === currentFloorId)?.agents.find(agent => agent.id === selections.get(currentFloorId)));
    const record = chatRecords.get(key);
    if (record) { record.unread = 0; board['chat-new'].hidden = true; }
  }
});
board['chat-new'].addEventListener('click', () => {
  board['agent-chat'].scrollTop = board['agent-chat'].scrollHeight;
  const floor = floors().find(item => item.id === currentFloorId);
  const agent = floor?.agents.find(item => item.id === selections.get(currentFloorId));
  const record = chatRecords.get(chatKey(floor || { id: currentFloorId }, agent));
  if (record) record.unread = 0;
  board['chat-new'].hidden = true;
});
for (const [index, tab] of detailTabs.entries()) {
  tab.addEventListener('click', () => showDetails(tab));
  tab.addEventListener('keydown', event => {
    const next = { ArrowLeft: (index + detailTabs.length - 1) % detailTabs.length,
      ArrowRight: (index + 1) % detailTabs.length, Home: 0, End: detailTabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    showDetails(detailTabs[next]);
    detailTabs[next].focus();
  });
}
window.addEventListener('hashchange', showPage);
window.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    window.clearTimeout(refreshTimer);
    refreshOffice();
  }
});
ruleSearch.addEventListener('input', renderRules);
showPage();
renderRules();
applyView();
renderView();
refreshOffice();
