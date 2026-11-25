'use strict';

const statusLabels = {
  disponivel: 'Disponível',
  'a-fazer': 'A fazer',
  'em-andamento': 'Em andamento',
  'bloqueado': 'Bloqueado',
  'concluido': 'Concluído',
};
const sections = ['agentes', 'regras'];
const rules = document.querySelector('#rules');
const search = document.querySelector('#rule-search');
const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short',
});
const originalRepository = 'https://github.com/etecab/sisc-test/blob/f7846b3/';
const board = Object.fromEntries([
  'connection', 'floor-list', 'bridge-note', 'map-current', 'map-meta',
  'team-filter', 'map-agents', 'team-legend', 'roster', 'agent-focus', 'live-feed',
].map(id => [id, document.getElementById(id)]));
const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
const coordinates = {
  produto: [[320, 177], [501, 181], [300, 298], [483, 293]],
  contas: [[736, 177], [947, 181], [728, 295], [947, 296]],
  comunidade: [[1184, 177], [1364, 183], [1188, 294], [1380, 298]],
  integracoes: [[280, 462], [489, 463], [256, 597], [481, 593]],
  qualidade: [[1193, 462], [1409, 462], [1200, 591], [1422, 596]],
};
const selections = new Map();
const seatAssignments = new Map();
let catalog;
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
  const preview = { id: 'catalog', name: 'Histórico do CondoConnect', agents: catalog.agents, archive: true };
  return [...latest.projects.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), preview];
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
  const description = floor.archive ? 'Registro anterior' : floor.source === 'cloud' ? 'Codex Cloud' : activity;
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
  if (floor.archive) return floor.agents;
  const assignments = seatAssignments.get(floor.id) || new Map();
  seatAssignments.set(floor.id, assignments);
  const agentById = new Map(floor.agents.map(agent => [agent.id, agent]));
  for (const [id] of assignments) {
    if (!agentById.has(id)) assignments.delete(id);
  }
  const slots = [0, 1, 2, 3].flatMap(seat => catalog.teams.map(team => team.id + '/' + seat));
  const free = slots.filter(slot => ![...assignments.values()].includes(slot));
  for (const agent of floor.agents) {
    if (!assignments.has(agent.id) && free.length) {
      const preferred = free.findIndex(slot => slot.startsWith(agent.teamId + '/'));
      assignments.set(agent.id, free.splice(Math.max(0, preferred), 1)[0]);
    }
  }
  const seated = new Map([...assignments].map(([id, slot]) => [slot, agentById.get(id)]));
  const selected = agentById.get(selections.get(floor.id));
  if (selected && !assignments.has(selected.id)) seated.set(slots.at(-1), selected);
  return catalog.agents.map(post => {
    const agent = seated.get(post.teamId + '/' + post.seat);
    return agent ? { ...agent, teamId: post.teamId, seat: post.seat } : {
      ...post, id: 'desk-' + post.id, status: 'disponivel', task: '', activity: '', updatedAt: null,
    };
  });
}

function agentActivity(agent) {
  return agent.activity || agent.task || 'Aguardando uma tarefa.';
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
  const [x, y] = coordinates[agent.teamId][agent.seat];
  const seat = element('div', 'map-seat team-' + agent.teamId);
  seat.style.left = x / 16.72 + '%';
  seat.style.top = y / 9.41 + '%';
  const button = element('button', 'seat-button ' + agent.status);
  setPressed(button, selected);
  button.dataset.agent = agent.id;
  button.setAttribute('aria-label', agent.name + ' · ' + statusLabels[agent.status]);
  button.title = agent.name;
  button.addEventListener('click', () => selectAgent(agent));
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

function renderActivity(agent, floor) {
  board['agent-focus'].replaceChildren();
  if (agent) {
    const heading = element('div', 'agent-heading');
    heading.append(element('h3', '', agent.name), element('span', 'status ' + agent.status, statusLabels[agent.status]));
    board['agent-focus'].append(heading, element('p', '', agentActivity(agent)));
    if (agent.task && agent.task !== agent.activity) board['agent-focus'].append(element('p', 'agent-task', agent.task));
    if (agent.updatedAt) board['agent-focus'].append(element('time', '', timeLabel(agent.updatedAt)));
  }
  const events = floor.agents.flatMap(item => (item.events || []).map(event => ({ ...event, name: item.name })));
  if (floor.lastChangeAt) events.push({ at: floor.lastChangeAt, name: 'Diretório', activity: 'Mudança de arquivo registrada.' });
  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  board['live-feed'].replaceChildren(...events.slice(0, 8).map(event => {
    const item = element('li');
    item.append(element('time', '', timeLabel(event.at)), element('span', '', event.name + ' · ' + event.activity));
    return item;
  }));
}

function renderOffice() {
  if (!catalog) return;
  const focus = document.activeElement;
  const availableFloors = floors();
  const floor = availableFloors.find(project => project.id === floorKey) || latest.projects[0] || availableFloors.at(-1);
  floorKey = floor.id;
  board['floor-list'].replaceChildren(...availableFloors.map((item, index) => floorButton(item, index, item.id === floor.id)));
  board['map-current'].textContent = floor.name;
  const fileSummary = floor.changes === 1 ? '1 arquivo com alterações no Git' : floor.changes + ' arquivos com alterações no Git';
  const summary = floor.archive ? ['20 postos', '5 equipes'] : [
    floor.source === 'cloud' ? 'Codex Cloud' : null,
    floor.branch,
    floor.isRepository && floor.changes != null ? fileSummary : null,
    floor.agents.length + (floor.agents.length === 1 ? ' sessão observada' : ' sessões observadas'),
  ].filter(Boolean);
  board['map-meta'].textContent = summary.join(' · ');
  const filter = board['team-filter'].value;
  const seats = seatsFor(floor);
  const onMap = seats.filter(agent => !filter || agent.teamId === filter);
  const offMap = floor.archive || filter ? [] : floor.agents.filter(agent => !seats.some(seat => seat.id === agent.id));
  const roster = [...onMap, ...offMap];
  const agent = roster.find(entry => entry.id === selections.get(floor.id))
    || roster.find(entry => entry.status === 'em-andamento')
    || roster.find(entry => entry.updatedAt) || roster[0];
  const selectedPoint = agent?.teamId ? coordinates[agent.teamId][agent.seat] : null;
  board['map-agents'].replaceChildren(...onMap.map(item => {
    const [x, y] = coordinates[item.teamId][item.seat];
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
  if (local) {
    try {
      const raw = await readText('./api/activity');
      if (raw !== lastLive) {
        const snapshot = JSON.parse(raw);
        if (!latest.projects.length && snapshot.projects.length) floorKey = snapshot.projects[0].id;
        latest = snapshot;
        lastLive = raw;
        changed = true;
      }
    } catch {
      latest = { ...latest, status: 'unavailable' };
      lastLive = '';
    }
  }
  if (catalog) {
    const label = local ? {
      connected: latest.projects.length ? 'Monitor local ativo' : 'Aguardando sessões locais',
      starting: 'Procurando sessões…',
      unavailable: 'Monitor temporariamente indisponível',
    }[latest.status] : 'Histórico publicado';
    if (board.connection.textContent !== label) board.connection.textContent = label;
    board.connection.classList.toggle('live', local && latest.status === 'connected');
    board['bridge-note'].hidden = local;
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
      const link = element('a', '', source);
      link.href = originalRepository + source;
      references.append(link);
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
showPage();
renderRules();
refreshOffice();
