'use strict';

const statusLabels = {
  'a-fazer': 'A fazer',
  'em-andamento': 'Em andamento',
  'bloqueado': 'Bloqueado',
  'concluido': 'Concluído',
};
const sections = ['agentes', 'regras'];
const lastUpdated = document.querySelector('#updated');
const rules = document.querySelector('#rules');
const search = document.querySelector('#rule-search');
const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
});
const originalRepository = 'https://github.com/etecab/sisc-test/blob/f7846b3/';
let lastSnapshot = '';

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

function agentCard(agent) {
  const card = element('article', 'card');
  const heading = element('div', 'card-top');
  heading.append(element('h3', '', agent.name),
    element('span', 'status ' + agent.status, statusLabels[agent.status]));
  const time = element('time', '', dateFormat.format(new Date(agent.updatedAt)));
  time.dateTime = agent.updatedAt;
  card.append(heading, element('p', 'task', agent.task), element('p', 'activity', agent.activity), time);
  return card;
}

function metric(count, label) {
  const item = element('div', 'metric');
  item.append(element('strong', '', String(count)), element('span', '', label));
  return item;
}

async function refreshProgress() {
  try {
    const response = await fetch('./progress.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Registro indisponível');
    const snapshot = await response.text();
    if (snapshot !== lastSnapshot) {
      const { agents } = JSON.parse(snapshot);
      if (!agents.length) throw new Error('Equipe ausente');
      document.querySelector('#team').replaceChildren(...agents.map(agentCard));
      document.querySelector('#summary').replaceChildren(
        metric(agents.length, 'Na equipe'),
        metric(agents.filter(agent => agent.status === 'em-andamento').length, 'Em andamento'),
        metric(agents.filter(agent => agent.status === 'concluido').length, 'Concluídos'),
      );
      lastSnapshot = snapshot;
    }
    const latest = document.querySelector('#team time[datetime]');
    const newest = [...document.querySelectorAll('#team time')].reduce(
      (current, time) => Date.parse(time.dateTime) > Date.parse(current.dateTime) ? time : current, latest,
    );
    const label = 'Último registro em ' + newest.textContent;
    if (lastUpdated.textContent !== label) lastUpdated.textContent = label;
  } catch {
    const label = lastSnapshot ? 'Atualização indisponível. Exibindo o último registro.'
      : 'Registro indisponível. Abra o painel por um servidor HTTP.';
    if (lastUpdated.textContent !== label) lastUpdated.textContent = label;
  }
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
showPage();
renderRules();
refreshProgress();
setInterval(refreshProgress, 5000);
