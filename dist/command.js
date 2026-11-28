const endpoint = './api/command';
const byId = id => document.getElementById(id);
const labels = {
  pending: 'Pendente', running: 'Em andamento', blocked: 'Bloqueada', review: 'Em revisão',
  done: 'Concluída', failed: 'Falhou', cancelled: 'Cancelada',
};
const actionLabels = {
  'project.create': 'Projeto cadastrado', 'objective.create': 'Objetivo criado',
  'task.create': 'Tarefa criada', 'task.state': 'Estado da tarefa atualizado',
};
let state = { projects: [], objectives: [], tasks: [], audit: [] };
let revision;
let loading = false;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function setText(id, text) {
  const target = byId(id);
  if (target && target.textContent !== String(text)) target.textContent = text;
}

function fill(id, entries, render, empty) {
  const target = byId(id);
  if (!target) return;
  target.replaceChildren(...(entries.length ? entries.map(render) : [element('p', empty, 'empty-state')]));
}

function row(title, detail) {
  const article = element('article', undefined, 'record-row');
  article.append(element('strong', title), element('p', detail));
  return article;
}

function options(select, entries, label, placeholder) {
  const previous = Array.from(select.selectedOptions, option => option.value);
  const values = [];
  if (placeholder && !select.multiple) values.push(new Option(placeholder, ''));
  values.push(...entries.map(entry => new Option(label(entry), entry.id)));
  select.replaceChildren(...values);
  for (const option of select.options) option.selected = previous.includes(option.value);
  if (!select.multiple && !select.value && select.options.length) select.selectedIndex = 0;
}

function activeDependencies() {
  const form = document.querySelector('form:has([name=objectiveId])');
  const select = form?.elements.dependencies;
  if (select?.tagName === 'SELECT') {
    options(select, state.tasks.filter(task => task.objectiveId === form.elements.objectiveId.value),
      task => task.title, 'Sem dependência');
  }
}

function render() {
  const getProject = id => state.projects.find(entry => entry.id === id)?.name;
  fill('project-list', state.projects, project => row(project.name, project.path), 'Cadastre a pasta de um projeto para começar.');
  fill('coordinator-detail', state.objectives, objective => {
    const tasks = state.tasks.filter(task => task.objectiveId === objective.id);
    return row(objective.title, [getProject(objective.projectId), tasks.filter(task => task.state === 'done').length + '/' + tasks.length + ' concluídas'].join(' · '));
  }, 'Crie um objetivo depois de cadastrar um projeto.');
  renderTasks();
  fill('history-list', state.audit.slice(-50).reverse(), entry =>
    row(actionLabels[entry.action] || entry.action, new Date(entry.at).toLocaleString('pt-BR')),
  'As ações realizadas nesta central aparecem aqui.');
  for (const select of document.querySelectorAll('select[name=projectId], select[data-project-select]')) {
    options(select, state.projects, project => project.name, 'Selecione um projeto');
  }
  for (const select of document.querySelectorAll('select[name=objectiveId]')) {
    options(select, state.objectives, objective => objective.title, 'Selecione um objetivo');
  }
  activeDependencies();
  setText('metric-projects', state.projects.length);
  setText('metric-objectives', state.objectives.length);
  setText('metric-tasks', state.tasks.filter(task => task.state === 'running').length);
}

function renderTasks() {
  const getObjective = id => state.objectives.find(entry => entry.id === id)?.title;
  function taskRow(task) {
    const dependencies = task.dependencies.map(id => state.tasks.find(entry => entry.id === id)?.title).filter(Boolean);
    const item = row(task.title, [getObjective(task.objectiveId), dependencies.length ? 'Depende de ' + dependencies.join(', ') : 'Sem dependências'].join(' · '));
    const select = element('select');
    select.setAttribute('aria-label', 'Estado de ' + task.title);
    select.dataset.task = task.id;
    for (const [value, title] of Object.entries(labels)) select.add(new Option(title, value));
    select.value = task.state;
    item.append(select);
    return item;
  }
  const list = byId('tasks-list');
  const isBoard = byId('task-view').value === 'board' && state.tasks.length > 0;
  list.classList.toggle('kanban', isBoard);
  if (!isBoard) {
    fill('tasks-list', state.tasks, taskRow, 'Adicione uma tarefa ao plano do objetivo.');
    return;
  }
  list.replaceChildren(...Object.entries(labels).map(([status, label]) => {
    const tasks = state.tasks.filter(task => task.state === status);
    const column = element('section', undefined, 'kanban-column');
    column.append(element('h3', label + ' ? ' + tasks.length), ...tasks.map(taskRow));
    return column;
  }));
}

function prepareGit(id, actions) {
  const target = byId(id);
  if (target.querySelector('select')) return;
  const select = element('select');
  select.dataset.projectSelect = '';
  select.setAttribute('aria-label', 'Projeto');
  const controls = element('div', undefined, 'inspection-controls');
  controls.append(select);
  for (const [view, label] of actions) {
    const button = element('button', label, 'button button-quiet');
    button.type = 'button';
    button.dataset.gitView = view;
    controls.append(button);
  }
  const result = element('pre', 'Selecione um projeto e execute a consulta.');
  result.dataset.gitOutput = '';
  result.setAttribute('aria-live', 'polite');
  target.replaceChildren(controls, result);
}

function renderMetrics() {
  const { observed, resources } = state;
  if (observed) {
    setText('activity-meta', ({ connected: 'Monitor conectado', starting: 'Monitor iniciando', unavailable: 'Monitor indispon?vel' })[observed.status] || observed.status);
    const stats = [['Projetos', state.projects.length], ['Objetivos', state.objectives.length],
      ['Tarefas em execu??o', state.tasks.filter(task => task.state === 'running').length], ['Sess?es observadas', observed.sessions]];
    const signature = JSON.stringify(stats);
    const overview = byId('overview-stats');
    if (overview.dataset.signature !== signature) {
      overview.dataset.signature = signature;
      overview.replaceChildren(...stats.map(([title, value]) => {
        const card = element('article', undefined, 'stat-card');
        card.append(element('span', title), element('strong', value));
        return card;
      }));
    }
    setText('activity-chart', observed.sessions + ' sess?es em ' + observed.projects + ' projetos observados.');
  }
  if (!resources) return;
  const gib = bytes => (bytes / 2 ** 30).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' GiB';
  setText('metric-memory', gib(resources.total - resources.free) + ' / ' + gib(resources.total));
  setText('metric-cores', resources.cores);
  const used = Math.round(100 * (1 - resources.free / resources.total));
  setText('resource-percent', used + '% RAM');
  byId('resource-meter').style.width = used + '%';
  setText('resource-summary', gib(resources.total - resources.free) + ' em uso ? ' + resources.cores + ' n?cleos l?gicos');
}

async function request(query = '', init) {
  const response = await fetch(endpoint + query, { signal: AbortSignal.timeout(8000), ...init });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function update(snapshot) {
  if (snapshot.audit.length < state.audit.length) return;
  state = { ...state, ...snapshot };
  const next = state.audit.at(-1)?.id ?? '';
  if (revision !== next) {
    revision = next;
    render();
  }
  renderMetrics();
}

async function refresh() {
  if (loading || document.hidden) return;
  loading = true;
  try {
    update(await request());
    setText('connection-state', 'Servidor local conectado');
    setText('last-sync', new Date().toLocaleTimeString('pt-BR'));
  } catch {
    setText('connection-state', 'Servidor local indisponível');
  } finally {
    loading = false;
  }
}

async function mutate(action, data) {
  setText('form-feedback', 'Salvando…');
  try {
    update(await request('', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, data }),
    }));
    setText('form-feedback', actionLabels[action]);
    return true;
  } catch (error) {
    setText('form-feedback', error.message || 'Não foi possível salvar.');
    return false;
  }
}

document.addEventListener('submit', async event => {
  const form = event.target;
  const data = new FormData(form);
  const action = data.has('path') ? 'project.create'
    : data.has('objectiveId') ? 'task.create'
      : data.has('projectId') && data.has('title') ? 'objective.create' : null;
  if (!action) return;
  event.preventDefault();
  if (form.dataset.saving) return;
  form.dataset.saving = 'true';
  const fields = Object.fromEntries(data);
  if (action === 'task.create') fields.dependencies = data.getAll('dependencies').flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
  if (await mutate(action, fields)) {
    form.reset();
    activeDependencies();
  }
  delete form.dataset.saving;
});

document.addEventListener('change', async event => {
  const input = event.target;
  if (input.id === 'task-view') {
    try { localStorage.setItem('projeto-all.task-view', input.value); } catch {}
    renderTasks();
  }
  if (input.name === 'objectiveId') activeDependencies();
  if (!input.dataset.task) return;
  input.disabled = true;
  if (!await mutate('task.state', { id: input.dataset.task, state: input.value })) {
    input.value = state.tasks.find(task => task.id === input.dataset.task)?.state;
    input.disabled = false;
  }
});

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-git-view]');
  if (!button) return;
  const group = button.closest('section') || document;
  const project = group.querySelector('[data-project-select], select[name=projectId]')?.value;
  const output = group.querySelector('[data-git-output], pre');
  if (!output) return;
  if (!project) {
    output.textContent = 'Selecione um projeto cadastrado.';
    return;
  }
  button.disabled = true;
  output.textContent = 'Consultando Git…';
  try {
    const query = new URLSearchParams({ view: button.dataset.gitView, project });
    const result = await request('?' + query);
    output.textContent = result.output || (result.passed ? 'Nenhum problema de espaço em branco nas alterações rastreadas.' : 'Nenhuma alteração rastreada.');
  } catch (error) {
    output.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function highlightSection() {
  const hash = location.hash || '#visao';
  for (const link of document.querySelectorAll('[data-section]')) {
    const current = link.hash === hash;
    link.classList.toggle('is-active', current);
    if (current) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}
byId('refresh-command').addEventListener('click', refresh);
window.addEventListener('hashchange', highlightSection);
highlightSection();
try {
  if (localStorage.getItem('projeto-all.task-view') === 'board') byId('task-view').value = 'board';
} catch {}
await refresh();
setInterval(refresh, 5000);
document.addEventListener('visibilitychange', refresh);
window.addEventListener('online', refresh);
