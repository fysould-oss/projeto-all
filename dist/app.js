'use strict';

const statusLabels = {
  disponivel: 'Disponível',
  'a-fazer': 'A fazer',
  'em-andamento': 'Em andamento',
  'bloqueado': 'Bloqueado',
  'concluido': 'Concluído',
  'sem-sinal': 'Sem sinal',
  registrado: 'Registro histórico',
};
const sections = ['agentes', 'regras'];
const rules = document.querySelector('#rules');
const search = document.querySelector('#rule-search');
const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short',
});
const board = Object.fromEntries([
  'connection', 'floor-list', 'bridge-note', 'map-current', 'map-meta', 'project-repository',
  'team-filter', 'map-agents', 'team-legend', 'roster', 'agent-focus', 'live-feed', 'agent-chat', 'chat-empty',
].map(id => [id, document.getElementById(id)]));
const detailTabs = [...document.querySelectorAll('.detail-tab')];
const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
const roleDesks = {
  coordenacao: [830, 252],
  contas: [430, 306],
  comunidade: [1248, 305],
  integracoes: [414, 488],
  qualidade: [1259, 489],
};
const flexibleDesks = [[832, 487], [380, 687], [829, 687], [1291, 690]];
const selections = new Map();
const seatAssignments = new Map();
let catalog;
let projectManifest;
let latest = { status: 'starting', projects: [] };
let floorKey = '';
let renderedFloor = '';
let lastLive = '';
let lastCatalog = '';

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
}

function showPage() {
  const route = location.hash === '#regras' ? 'regras' : 'agentes';
  for (const section of sections) {
    document.getElementById(section).hidden = section !== route;
    const link = document.querySelector('[data-view="' + section + '"]');
    if (section === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function floors() {
  const history = catalog.agents.filter(agent => agent.updatedAt)
    .map(agent => ({ ...agent, status: 'registrado' }));
  const preview = { id: 'catalog', name: 'Histórico do CondoConnect', agents: history, archive: true };
  const observed = new Map(latest.projects.map(project => [project.id, project]));
  const listed = projectManifest ?? latest.projects.filter(project => project.pinned);
  const fixed = listed.map(({ id, name, remoteUrl }) => {
    const project = observed.get(id);
    observed.delete(id);
    return { agents: [], ...project, id, name, remoteUrl: remoteUrl || project?.remoteUrl, pinned: true };
  });
  const discovered = [...observed.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return [...fixed, ...discovered, preview];
}

function setPressed(button, pressed) {
  button.type = 'button';
  button.setAttribute('aria-pressed', String(pressed));
}

function floorButton(floor, index, active) {
  const button = element('button', 'floor-button');
  button.dataset.floor = floor.id;
  setPressed(button, active);
  const running = floor.agents.filter(agent => agent.status === 'em-andamento').length;
  const activity = running > 0 ? running + (running === 1 ? ' sessão ativa' : ' sessões ativas') : 'Sem atividade em andamento';
  const description = floor.archive ? 'Registro anterior'
    : floor.source === 'cloud' ? 'Codex Cloud'
    : floor.available === false && !floor.agents.length ? 'Pasta local indisponível' : activity;
  const label = element('span', 'floor-label');
  label.append(element('strong', '', floor.name), element('span', '', description));
  button.append(element('span', 'floor-number', floor.archive ? 'H' : String(index + 1)), label);
  button.addEventListener('click', () => {
    floorKey = floor.id;
    board['team-filter'].value = '';
    renderOffice();
  });
  return button;
}

function seatsFor(floor) {
  if (floor.archive) return [];
  const assignments = seatAssignments.get(floor.id) || new Map();
  seatAssignments.set(floor.id, assignments);
  const agentById = new Map(floor.agents.map(agent => [agent.id, agent]));
  const orderedAgents = [...floor.agents].sort((a, b) => a.id.localeCompare(b.id));
  const roleAgents = new Map();
  for (const agent of orderedAgents) {
    if (!Object.hasOwn(roleDesks, agent.roleId)) continue;
    const current = roleAgents.get(agent.roleId);
    if (!current || (agent.status === 'em-andamento' && current.status !== 'em-andamento')) {
      roleAgents.set(agent.roleId, agent);
    }
  }
  const fixedIds = new Set([...roleAgents.values()].map(agent => agent.id));
  for (const id of assignments.keys()) {
    if (!agentById.has(id) || fixedIds.has(id)) assignments.delete(id);
  }
  const occupied = new Set(assignments.values());
  const free = flexibleDesks.map((_, index) => index).filter(index => !occupied.has(index));
  for (const agent of orderedAgents) {
    if (fixedIds.has(agent.id) || assignments.has(agent.id) || !free.length) continue;
    assignments.set(agent.id, free.shift());
  }

  const seated = new Map([...assignments].map(([id, slot]) => [slot, agentById.get(id)]));
  const selected = agentById.get(selections.get(floor.id));
  const filter = board['team-filter'].value;
  if (selected && !fixedIds.has(selected.id) && !assignments.has(selected.id) && (!filter || agentTeam(selected) === filter)) {
    seated.set(flexibleDesks.length - 1, selected);
  }
  const fixed = [...roleAgents].map(([roleId, agent]) => ({
    ...agent, point: roleDesks[roleId], teamId: agentTeam(agent), lead: roleId === 'coordenacao',
  }));
  return [...fixed, ...[...seated].map(([slot, agent]) => ({
    ...agent, point: flexibleDesks[slot], teamId: agentTeam(agent),
  }))];
}

function agentTeam(agent) {
  return catalog.agents.find(post => post.id === agent.roleId)?.teamId ?? agent.teamId;
}

function agentActivity(agent) {
  return agent.activity || agent.task || 'Sem atividade registrada.';
}

function centerSelectedSeat() {
  const map = document.querySelector('.map-scroll');
  const pin = board['map-agents'].querySelector('button[aria-pressed="true"]');
  if (!pin || map.scrollWidth <= map.clientWidth) return;
  const mapBounds = map.getBoundingClientRect();
  const pinBounds = pin.getBoundingClientRect();
  if (pinBounds.left < mapBounds.left + 75 || pinBounds.right > mapBounds.right - 75) {
    map.scrollLeft += pinBounds.left - mapBounds.left - map.clientWidth / 2;
  }
}

function selectAgent(agent, scroll) {
  selections.set(floorKey, agent.id);
  renderOffice();
  if (scroll) centerSelectedSeat();
}

function seatMarker(agent, selected, preview) {
  const [x, y] = agent.point;
  const seat = element('div', 'map-seat' + (agent.teamId ? ' team-' + agent.teamId : ''));
  seat.style.left = (x * 100 / 1672) + '%';
  seat.style.top = (y * 100 / 941) + '%';
  const button = element('button', 'seat-button ' + agent.status);
  button.classList.toggle('agent-lead', agent.lead === true);
  setPressed(button, selected);
  button.dataset.agent = agent.id;
  button.setAttribute('aria-label', (agent.lead ? 'Coordenação · ' : '') + agent.name + ' · ' + statusLabels[agent.status]);
  button.title = agent.name;
  button.addEventListener('click', () => selectAgent(agent));
  const initials = agent.name.trim().split(/\s+/u).slice(0, 2)
    .map(part => part[0]).join('').toLocaleUpperCase('pt-BR');
  const avatar = element('span', 'agent-avatar', initials);
  avatar.setAttribute('aria-hidden', 'true');
  button.append(avatar);
  seat.append(button);
  if (selected || preview) {
    const speech = element('div', selected ? 'speech' : 'speech speech-preview');
    if (selected) {
      speech.append(element('strong', '', agent.name));
      seat.classList.add('selected');
    }
    speech.append(element('span', '', agentActivity(agent)));
    seat.append(speech);
  }
  return seat;
}

function rosterButton(agent, selected) {
  const button = element('button', 'roster-button' + (agent.teamId ? ' team-' + agent.teamId : ''));
  setPressed(button, selected);
  button.dataset.agent = agent.id;
  button.append(element('strong', '', agent.name), element('span', 'status ' + agent.status, statusLabels[agent.status]));
  button.addEventListener('click', () => selectAgent(agent, true));
  return button;
}

function timeLabel(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return dateFormat.format(new Date(value));
}

function showDetails(active) {
  for (const tab of detailTabs) {
    const selected = tab === active;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
  }
}

function renderChat(agent, floor) {
  const messages = Array.isArray(agent?.chat)
    ? agent.chat.filter(entry => typeof entry?.text === 'string' && entry.text.trim()) : [];
  board['agent-chat'].replaceChildren(...messages.map(message => {
    const entry = element('li', 'chat-entry');
    const label = timeLabel(message.at);
    if (label) {
      const time = element('time', '', label);
      time.dateTime = message.at;
      entry.append(time);
    }
    entry.append(element('p', 'chat-text', message.text));
    return entry;
  }));
  const empty = board['chat-empty'];
  empty.hidden = messages.length > 0;
  if (floor.archive) empty.textContent = 'Este histórico contém registros de atividade.';
  else if (!agent) empty.textContent = 'Selecione uma sessão observada para consultar suas respostas.';
  else empty.textContent = 'Nenhuma resposta registrada nesta sessão.';
}

function renderActivity(agent, floor) {
  board['agent-focus'].replaceChildren();
  if (agent) {
    const heading = element('div', 'agent-heading');
    heading.append(element('h3', '', agent.name), element('span', 'status ' + agent.status, statusLabels[agent.status]));
    board['agent-focus'].append(heading);
    if (agent.lead) board['agent-focus'].append(element('p', 'agent-task', 'Coordenação'));
    board['agent-focus'].append(element('p', '', agentActivity(agent)));
    if (agent.task && agent.task !== agent.activity) board['agent-focus'].append(element('p', 'agent-task', agent.task));
    if (agent.updatedAt) board['agent-focus'].append(element('time', '', timeLabel(agent.updatedAt)));
  } else {
    const empty = board['team-filter'].value ? 'Nenhuma sessão observada nesta equipe.' : 'Nenhuma sessão observada neste andar.';
    board['agent-focus'].append(element('p', 'agent-empty', empty));
  }
  const events = floor.agents.flatMap(item => (item.events || []).map(event => ({ ...event, name: item.name })));
  if (floor.lastChangeAt) events.push({ at: floor.lastChangeAt, name: 'Diretório', activity: 'Mudança de arquivo registrada.' });
  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  board['live-feed'].replaceChildren(...events.slice(0, 8).map(event => {
    const item = element('li');
    item.append(element('time', '', timeLabel(event.at)), element('span', '', event.name + ' · ' + event.activity));
    return item;
  }));
  renderChat(agent, floor);
}

function renderOffice() {
  if (!catalog) return;
  const focus = document.activeElement;
  const availableFloors = floors();
  const floor = availableFloors.find(project => project.id === floorKey)
    || availableFloors.find(project => !project.archive && project.agents.some(agent => agent.status === 'em-andamento'))
    || availableFloors[0];
  floorKey = floor.id;
  board['floor-list'].replaceChildren(...availableFloors.map((item, index) => floorButton(item, index, item.id === floor.id)));
  board['map-current'].textContent = floor.name;
  const fileSummary = floor.changes === 1 ? '1 arquivo com alterações no Git' : floor.changes + ' arquivos com alterações no Git';
  const summary = floor.archive ? ['Registros anteriores'] : [
    floor.source === 'cloud' ? 'Codex Cloud' : null,
    floor.available === false ? 'Pasta local indisponível' : null,
    floor.branch,
    floor.isRepository && floor.changes != null ? fileSummary : null,
    floor.agents.length === 0 ? 'Sem sessões observadas'
      : floor.agents.length + (floor.agents.length === 1 ? ' sessão observada' : ' sessões observadas'),
  ].filter(Boolean);
  board['map-meta'].textContent = summary.join(' · ');
  const repositoryLink = board['project-repository'];
  const repositoryUrl = floor.remoteUrl ?? '';
  repositoryLink.hidden = !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/i.test(repositoryUrl);
  if (repositoryLink.hidden) repositoryLink.removeAttribute('href');
  else repositoryLink.href = repositoryUrl;
  const filter = board['team-filter'].value;
  const seats = seatsFor(floor);
  const onMap = seats.filter(agent => !filter || agent.teamId === filter);
  const seatedIds = new Set(seats.map(agent => agent.id));
  const offMap = floor.agents.filter(agent => !seatedIds.has(agent.id)).flatMap(agent => {
    const teamId = agentTeam(agent);
    return !filter || teamId === filter ? [{ ...agent, teamId }] : [];
  });
  const roster = [...onMap, ...offMap];
  const agent = roster.find(entry => entry.id === selections.get(floor.id))
    || roster.find(entry => entry.status === 'em-andamento')
    || roster.find(entry => entry.updatedAt) || roster[0];
  const selectedPoint = agent?.point;
  board['map-agents'].replaceChildren(...onMap.map(item => {
    const [x, y] = item.point;
    const nearSelected = selectedPoint && Math.abs(x - selectedPoint[0]) < 320 && Math.abs(y - selectedPoint[1]) < 100;
    const preview = item.status === 'em-andamento' && !nearSelected;
    return seatMarker(item, item.id === agent?.id, preview);
  }));
  board.roster.replaceChildren(...roster.map(item => rosterButton(item, item.id === agent?.id)));
  renderActivity(agent, floor);
  if (renderedFloor !== floorKey) {
    renderedFloor = floorKey;
    centerSelectedSeat();
  }
  if (focus?.dataset.floor || focus?.dataset.agent) {
    const group = focus.dataset.floor ? board['floor-list']
      : focus.classList.contains('seat-button') ? board['map-agents'] : board.roster;
    [...group.querySelectorAll('button')].find(button =>
      focus.dataset.floor ? button.dataset.floor === focus.dataset.floor : button.dataset.agent === focus.dataset.agent,
    )?.focus({ preventScroll: true });
  }
}

function loadCatalog(data) {
  catalog = data;
  const existingFilter = board['team-filter'].value;
  board['team-filter'].replaceChildren(new Option('Todas', ''),
    ...catalog.teams.map(team => new Option(team.name, team.id)));
  board['team-filter'].value = existingFilter;
  board['team-legend'].replaceChildren(...catalog.teams.map(team => element('span', 'team-' + team.id, team.name)));
}

async function readText(path) {
  const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error('Leitura indisponível');
  return response.text();
}

async function fetchActivity() {
  if (local) return readText('./api/activity');
  const snapshot = await window.fetchOnlineActivity?.();
  return snapshot ? JSON.stringify(snapshot) : '';
}

async function refreshOffice() {
  let changed = false;
  try {
    const archive = await readText('./progress.json');
    if (archive !== lastCatalog) {
      loadCatalog(JSON.parse(archive));
      lastCatalog = archive;
      changed = true;
    }
  } catch {
    if (!catalog) board.connection.textContent = 'Escritório indisponível';
  }
  if (!projectManifest) {
    try {
      projectManifest = JSON.parse(await readText('./projects.json'));
      changed = true;
    } catch { /* The local monitor can supply fixed projects if the manifest is unavailable. */ }
  }
  const online = !local && typeof window.fetchOnlineActivity === 'function';
  if (local || online) {
    try {
      const raw = await fetchActivity();
      if (raw && raw !== lastLive) {
        const snapshot = JSON.parse(raw);
        latest = snapshot;
        lastLive = raw;
        changed = true;
      } else if (!raw && lastLive) {
        latest = { status: 'starting', projects: [] };
        lastLive = '';
        changed = true;
      }
    } catch {
      if (local) latest = { ...latest, status: 'unavailable' };
      else {
        latest = { status: 'unavailable', projects: [] };
        changed ||= Boolean(lastLive);
      }
      lastLive = '';
    }
  }
  if (catalog) {
    const observing = local || Boolean(lastLive);
    const label = observing ? {
      connected: latest.projects.some(project => project.agents.length)
        ? (local ? 'Monitor local ativo' : 'Monitor online ativo') : 'Aguardando sessões',
      starting: 'Procurando sessões…',
      unavailable: 'Monitor temporariamente indisponível',
    }[latest.status] : 'Histórico publicado';
    if (board.connection.textContent !== label) board.connection.textContent = label;
    board.connection.classList.toggle('live', observing && latest.status === 'connected');
    board['bridge-note'].hidden = observing;
  }
  if (changed) renderOffice();
  setTimeout(refreshOffice, 2000);
}

function searchable(text) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function ruleItem(rule) {
  const item = element('li');
  item.append(element('h3', '', rule.title), element('p', '', rule.text));
  if (rule.sources.length) {
    const references = element('p', 'sources');
    rule.sources.forEach((source, index) => {
      if (index) references.append(' · ');
      references.append(element('code', '', source));
    });
    item.append(references);
  }
  return item;
}

function renderRules() {
  const term = searchable(search.value.trim());
  const matches = window.businessRules.flatMap(group => {
    const entries = group.entries.filter(rule =>
      searchable([group.title, rule.title, rule.text].join(' ')).includes(term),
    );
    if (!entries.length) return [];
    const details = element('details', 'rule-group');
    details.open = Boolean(term) || group.open === true;
    const list = element('ul', 'rule-list');
    list.append(...entries.map(ruleItem));
    details.append(element('summary', '', group.title), list);
    return [details];
  });
  rules.replaceChildren(...(matches.length ? matches : [element('p', 'panel-note', 'Nenhuma regra encontrada.')]));
}

window.addEventListener('hashchange', showPage);
search.addEventListener('input', renderRules);
board['team-filter'].addEventListener('change', renderOffice);
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
showPage();
renderRules();
refreshOffice();
