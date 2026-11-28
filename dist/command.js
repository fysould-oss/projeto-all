const endpoint = './api/command';
const byId = id => document.getElementById(id);
const labels = {
  pending: 'Pendente', running: 'Em andamento', blocked: 'Bloqueada', review: 'Em revisão',
  done: 'Concluída', failed: 'Falhou', cancelled: 'Cancelada',
};
const planRoles = {
  scan: 'Análise', implementation: 'Implementação', qa: 'Qualidade',
  delivery: 'Entrega', coordination: 'Coordenação',
};
const modelTiers = { economy: 'econômico', balanced: 'equilibrado', advanced: 'avançado' };
const actionLabels = {
  'project.create': 'Projeto cadastrado', 'objective.create': 'Objetivo criado',
  'task.create': 'Tarefa criada', 'task.state': 'Estado da tarefa atualizado',
  'objective.plan': 'Tarefas do plano registradas', 'approval.request': 'Aprovação solicitada', 'approval.requestPush': 'Aprovação de push solicitada',
  'approval.approve': 'Aprovação encaminhada', 'approval.reject': 'Aprovação rejeitada',
  'approval.edit': 'Aprovação editada', 'git.stage': 'Caminho preparado', 'git.unstage': 'Caminho retirado do índice',
  'approval.completed': 'Commit registrado',
  'approval.failed': 'Falha ao tentar o commit',
  'approval.interrupted': 'Execução interrompida',
  'preview.save': 'Preview salvo',
};
let state = { projects: [], objectives: [], tasks: [], audit: [], approvals: [], previews: [] };
let revision;
let loading = false;
let approvalsSignature;
let previewReloadTimer;

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
  const table = byId('projects-table');
  if (state.projects.length) {
    table.replaceChildren(...state.projects.map(project => {
      const tr = element('tr');
      tr.append(element('td', project.name), element('td', project.path));
      return tr;
    }));
  }
  setText('projects-count', state.projects.length + ' cadastrados');
  setText('tasks-count', state.tasks.filter(task => !['done', 'cancelled'].includes(task.state)).length + ' abertas');
  setText('coordinator-status', 'Rascunhos de plano e acompanhamento');
  prepareGit('git-list', [['status', 'Consultar status'], ['diff', 'Ver diff completo'], ['staged', 'Ver diff preparado']]);
  renderApprovals();
  renderPreviewPanel();
  prepareGit('quality-list', [['check', 'Verificar alterações']]);
  fill('coordinator-detail', state.objectives, objective => {
    const tasks = state.tasks.filter(task => task.objectiveId === objective.id);
    const card = row(objective.title, [getProject(objective.projectId), tasks.filter(task => task.state === 'done').length + '/' + tasks.length + ' concluídas'].join(' · '));
    if (!tasks.length) {
      const button = element('button', 'Gerar rascunho', 'button button-quiet');
      button.type = 'button';
      button.dataset.plan = objective.id;
      card.append(button);
    }
    return card;
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
}

function renderTasks() {
  const getObjective = id => state.objectives.find(entry => entry.id === id)?.title;
  function taskRow(task) {
    const item = row(task.title, [getObjective(task.objectiveId), planRoles[task.role], modelTiers[task.modelTier] && 'Perfil ' + modelTiers[task.modelTier]].filter(Boolean).join(' · '));
    item.id = 'task-' + task.id;
    if (task.dependencies.length) {
      const description = element('p', 'Depende de ');
      for (const id of task.dependencies) {
        const dependency = state.tasks.find(entry => entry.id === id);
        if (!dependency) continue;
        const link = element('a', dependency.title);
        link.href = '#task-' + id;
        description.append(link, ' ');
      }
      item.append(description);
    }
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
    column.append(element('h3', label + ' · ' + tasks.length), ...tasks.map(taskRow));
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
  if (id === 'git-list') {
    const feedback = element('p', '', 'empty-state');
    feedback.id = 'git-index-feedback';
    feedback.setAttribute('role', 'status');
    const files = element('div', undefined, 'git-index');
    files.dataset.gitFiles = '';
    files.append(element('p', 'Selecione um projeto para listar os caminhos alterados.', 'empty-state'));
    target.append(feedback, files);
  }
}

function renderGitFiles(group, project, files) {
  const target = group.querySelector('[data-git-files]');
  if (group.querySelector('[data-project-select]')?.value !== project) return;
  fillGitFiles(target, project, files);
}

function fillGitFiles(target, project, files) {
  if (!files.length) {
    target.replaceChildren(element('p', 'Nenhum caminho alterado no índice ou na árvore de trabalho.', 'empty-state'));
    return;
  }
  target.replaceChildren(...files.map(file => {
    const row = element('div', undefined, 'git-file-row');
    const status = file.status === '??' ? 'Não rastreado' : [
      file.index !== ' ' && 'Índice ' + file.index, file.worktree !== ' ' && 'Cópia de trabalho ' + file.worktree,
    ].filter(Boolean).join(' · ');
    const name = file.renameFrom ? file.renameFrom + ' → ' + file.path : file.path;
    row.append(element('code', name), element('span', status, 'git-file-status'));
    const controls = element('span', undefined, 'git-file-actions');
    for (const [action, label, available] of [
      ['stage', 'Preparar', file.worktree !== ' '],
      ['unstage', 'Retirar', ![' ', '?'].includes(file.index)],
    ]) {
      if (!available) continue;
      const button = element('button', label, 'button button-quiet');
      button.type = 'button';
      button.dataset.gitIndexAction = action;
      button.dataset.gitProject = project;
      button.dataset.gitPath = file.path;
      button.setAttribute('aria-label', label + ' ' + file.path);
      controls.append(button);
    }
    row.append(controls);
    return row;
  }));
}

async function refreshGitFiles(group, project) {
  const target = group.querySelector('[data-git-files]');
  if (!target) return;
  if (!project) {
    target.replaceChildren(element('p', 'Selecione um projeto para listar os caminhos alterados.', 'empty-state'));
    return;
  }
  target.replaceChildren(element('p', 'Carregando caminhos alterados…', 'empty-state'));
  try {
    const query = new URLSearchParams({ view: 'files', project });
    const { files } = await request('?' + query);
    renderGitFiles(group, project, files);
  } catch (error) {
    if (group.querySelector('[data-project-select]')?.value === project) target.replaceChildren(element('p', error.message, 'empty-state'));
  }
}

function renderApprovals() {
  const target = byId('approval-list');
  if (!target) return;
  const approvals = Array.isArray(state.approvals) ? state.approvals : [];
  fill('approval-list', approvals.slice().reverse(), approval => {
    const project = state.projects.find(entry => entry.id === approval.projectId);
    const status = { pending: 'Pendente', rejected: 'Rejeitada', executing: 'Em execução', completed: 'Concluída', failed: 'Falhou', expired: 'Expirada' }[approval.state] || approval.state;
    const item = element('article', undefined, 'approval-card');
    const heading = element('div', undefined, 'approval-card-heading');
    const isPush = approval.kind === 'git.push';
    heading.append(element('strong', isPush ? 'Push para ' + (approval.remote || 'remote') : (approval.message || 'Commit sem mensagem')), element('span', status, 'approval-status approval-' + approval.state));
    item.append(heading);
    const impact = [project?.name || 'Projeto não encontrado', approval.branch && 'branch ' + approval.branch,
      !isPush && approval.base && 'base ' + approval.base.slice(0, 12), approval.paths?.length ? approval.paths.length + ' caminho(s)' : 'Sem diferenças de arquivos'].filter(Boolean).join(' · ');
    item.append(element('p', impact, 'approval-impact'), element('p', approval.reason || 'Sem motivo informado.', 'approval-reason'));
    if (isPush) item.append(element('p', [
      'Destino ' + approval.destination, 'Commit local ' + approval.head,
      approval.base ? 'Commit remoto ' + approval.base : 'Cria uma branch no remoto',
    ].join(' · '), 'approval-push-target'));
    if (approval.paths?.length) item.append(element('p', 'Arquivos: ' + approval.paths.join(', '), 'approval-paths'));
    if (approval.commit) item.append(element('p', 'Commit: ' + approval.commit, 'approval-commit'));
    if (approval.error) item.append(element('p', approval.error, 'approval-error'));
    if (approval.expiresAt) item.append(element('p', 'Expira em ' + new Date(approval.expiresAt).toLocaleString('pt-BR'), 'approval-expiry'));
    if (approval.state === 'pending') {
      if (isPush) item.append(element('p', 'O push publica os commits até o hash revisado. Para reverter o conteúdo publicado, crie e aprove um novo commit de reversão.', 'approval-impact'));
      if (!isPush) {
        const diffButton = element('button', 'Ver diff da solicitação', 'button button-quiet'); diffButton.type = 'button'; diffButton.dataset.approvalDiff = approval.id; item.append(diffButton);
        const diffOutput = element('pre', '', 'approval-diff'); diffOutput.dataset.approvalDiffOutput = approval.id; diffOutput.hidden = true; item.append(diffOutput);
      }
      const edit = element('div', undefined, 'approval-edit');
      const message = element('input'); message.value = approval.message || ''; message.maxLength = 200; message.dataset.approvalMessage = approval.id; message.setAttribute('aria-label', 'Mensagem da aprovação');
      const reason = element('textarea'); reason.value = approval.reason || ''; reason.maxLength = 500; reason.rows = 2; reason.dataset.approvalReason = approval.id; reason.setAttribute('aria-label', 'Motivo da aprovação');
      const controls = element('div', '');
      const save = element('button', 'Salvar edição', 'button button-quiet'); save.type = 'button'; save.dataset.approvalAction = 'edit'; save.dataset.approvalId = approval.id; save.dataset.approvalRevision = approval.revision || '';
      const reject = element('button', 'Rejeitar', 'button button-quiet'); reject.type = 'button'; reject.dataset.approvalAction = 'reject'; reject.dataset.approvalId = approval.id; reject.dataset.approvalRevision = approval.revision || '';
      const approve = element('button', 'Aprovar', 'button'); approve.type = 'button'; approve.dataset.approvalAction = 'approve'; approve.dataset.approvalId = approval.id; approve.dataset.approvalRevision = approval.revision || '';
      controls.append(save, reject, approve);
      if (!isPush) edit.append(message);
      edit.append(reason, controls);
      item.append(edit);
    }
    return item;
  }, 'Nenhuma aprovação registrada.');
}

let activePreviewUrl;
const previewSizes = { desktop: [1280, 720], tablet: [768, 1024], mobile: [390, 844] };

function savedPreviewUrl() {
  const projectId = byId('preview-project').value;
  return state.previews?.find(preview => preview.projectId === projectId)?.url || '';
}

function renderPreviewPanel() {
  options(byId('preview-project'), state.projects, project => project.name, 'Selecione um projeto');
}

function applyPreviewSize() {
  const frame = byId('preview-frame');
  for (const side of ['width', 'height']) {
    const input = byId('preview-' + side);
    input.value = Math.min(2400, Math.max(240, Math.round(input.valueAsNumber) || 240));
    frame.style[side] = input.value + 'px';
  }
}

function configurePreviewReload() {
  clearInterval(previewReloadTimer);
  const seconds = Number(byId('preview-autoreload').value);
  if (!activePreviewUrl || ![5, 15, 30].includes(seconds)) return;
  previewReloadTimer = setInterval(() => {
    if (!document.hidden && activePreviewUrl) byId('preview-frame').src = activePreviewUrl;
  }, seconds * 1000);
}

function showPreview(url) {
  activePreviewUrl = url;
  const frame = byId('preview-frame');
  frame.hidden = !url;
  frame.parentElement.hidden = !url;
  if (url) {
    applyPreviewSize();
    frame.src = url;
  } else {
    frame.removeAttribute('src');
  }
  for (const action of ['reload', 'stop']) {
    byId('previews').querySelector('[data-preview-' + action + ']').disabled = !url;
  }
  configurePreviewReload();
}

function updateApprovalFields() {
  const push = byId('approval-kind').value === 'git.push';
  const message = byId('approval-message');
  message.closest('label').hidden = push;
  message.disabled = push;
  byId('approval-remote-label').hidden = !push;
  byId('approval-remote').disabled = true;
  if (push) void refreshApprovalRemotes(byId('approval-project').value);
}

async function refreshApprovalRemotes(project) {
  const remote = byId('approval-remote');
  if (!remote) return;
  remote.disabled = true; remote.replaceChildren(new Option('Carregando remotos…', ''));
  if (!project) { remote.replaceChildren(new Option('Selecione um projeto primeiro', '')); return; }
  try {
    const query = new URLSearchParams({ view: 'remotes', project });
    const { remotes = [] } = await request('?' + query);
    if (byId('approval-project').value !== project || byId('approval-kind').value !== 'git.push') return;
    remote.replaceChildren(...(remotes.length ? remotes.map(value => new Option(value, value)) : [new Option('Nenhum remoto configurado', '')]));
    remote.disabled = !remotes.length;
  } catch (error) { remote.replaceChildren(new Option(error.message, '')); }
}

function renderMetrics() {
  const { observed, resources } = state;
  if (observed) {
    setText('activity-meta', ({ connected: 'Monitor conectado', starting: 'Monitor iniciando', unavailable: 'Monitor indisponível' })[observed.status] || observed.status);
    const stats = [['Projetos', state.projects.length], ['Objetivos', state.objectives.length],
      ['Tarefas em execução', state.tasks.filter(task => task.state === 'running').length], ['Sessões observadas', observed.sessions]];
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
    setText('activity-chart', observed.sessions + ' sessões em ' + observed.projects + ' projetos observados.');
  }
  if (!resources) return;
  const gib = bytes => (bytes / 2 ** 30).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' GiB';
  const used = Math.round(100 * (1 - resources.free / resources.total));
  setText('resource-percent', used + '% RAM');
  byId('resource-meter').style.width = used + '%';
  setText('resource-summary', gib(resources.total - resources.free) + ' em uso · ' + resources.cores + ' núcleos lógicos');
}

async function request(query = '', init) {
  let action;
  try { action = init?.body && JSON.parse(init.body).action; } catch {}
  const timeout = ['approval.requestPush', 'approval.approve'].includes(action) ? 70000 : 8000;
  const response = await fetch(endpoint + query, { signal: AbortSignal.timeout(timeout), ...init });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

const checksProject = byId('checks-project');
const checksScript = byId('checks-script');
const checksStart = byId('checks-start');
let checksSignature;
let checksRequest = 0;
let checksPending = false;

function updateCheckControls() {
  checksStart.disabled = checksPending || checksScript.disabled || !checksScript.value;
}

async function refreshChecks() {
  const project = checksProject.value;
  const sequence = ++checksRequest;
  if (!project) {
    checksSignature = undefined;
    checksScript.replaceChildren(new Option('Selecione um script', ''));
    checksScript.disabled = true;
    updateCheckControls();
    byId('checks-runs').replaceChildren();
    setText('checks-status', 'Selecione um projeto para localizar os scripts.');
    return;
  }
  try {
    const query = new URLSearchParams({ view: 'checks', project });
    const { scripts, runs } = await request('?' + query);
    if (sequence !== checksRequest) return;
    const signature = JSON.stringify([project, scripts, runs]);
    const available = scripts.map(script => ({ id: script }));
    if (checksSignature !== signature) {
      checksSignature = signature;
      options(checksScript, available, script => script.id, 'Selecione um script');
      fill('checks-runs', runs, run => {
        const duration = run.durationMs == null ? '' : (run.durationMs / 1000).toFixed(1) + ' s';
        const status = labels[run.status] || ({ passed: 'Aprovado', timed_out: 'Tempo limite' })[run.status] || run.status;
        const item = row(run.script, [status, duration].filter(Boolean).join(' · '));
        if (run.output) {
          const logs = element('details');
          logs.append(element('summary', 'Saída'), element('pre', run.output, 'check-output'));
          item.append(logs);
        }
        if (run.status === 'running') {
          const cancel = element('button', 'Interromper', 'button button-quiet');
          cancel.type = 'button';
          cancel.dataset.cancelCheck = run.id;
          item.append(cancel);
        }
        return item;
      }, 'Nenhuma execução neste projeto.');
    }
    checksScript.disabled = !available.length;
    updateCheckControls();
    setText('checks-status', available.length ? '' : 'Este projeto não tem scripts de qualidade compatíveis.');
  } catch (error) {
    if (sequence !== checksRequest) return;
    checksScript.disabled = true;
    updateCheckControls();
    setText('checks-status', error.message);
  }
}

async function submitCheck(action, data) {
  if (checksPending) return;
  checksPending = true;
  updateCheckControls();
  try {
    await request('', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, data: { projectId: checksProject.value, ...data } }),
    });
    await refreshChecks();
  } catch (error) {
    setText('checks-status', error.message);
  } finally {
    checksPending = false;
    updateCheckControls();
  }
}

function update(snapshot) {
  if (snapshot.audit.length < state.audit.length) return;
  state = { ...state, ...snapshot };
  const nextApprovals = JSON.stringify(state.approvals || []);
  if (approvalsSignature !== nextApprovals) {
    approvalsSignature = nextApprovals;
    renderApprovals();
  }
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
  const feedback = action.startsWith('approval.') ? 'approval-feedback' : action === 'preview.save' ? 'preview-feedback' : 'form-feedback';
  setText(feedback, 'Salvando…');
  try {
    update(await request('', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, data }),
    }));
    setText(feedback, actionLabels[action]);
    return true;
  } catch (error) {
    setText(feedback, error.message || 'Não foi possível salvar.');
    return false;
  }
}

document.addEventListener('submit', async event => {
  const form = event.target;
  const data = new FormData(form);
  let action = form.id === 'approval-form' ? 'approval.request'
    : data.has('path') ? 'project.create'
    : data.has('objectiveId') ? 'task.create'
      : data.has('projectId') && data.has('title') ? 'objective.create' : null;
  if (!action) return;
  event.preventDefault();
  if (form.dataset.saving) return;
  form.dataset.saving = 'true';
  const fields = Object.fromEntries(data);
  if (action === 'approval.request') fields.projectId = byId('approval-project').value;
  if (action === 'approval.request' && fields.kind === 'git.push') {
    if (!fields.remote) {
      setText('approval-feedback', 'Selecione um remoto disponível.');
      delete form.dataset.saving;
      return;
    }
    action = 'approval.requestPush';
    delete fields.kind;
    delete fields.message;
  }
  if (action === 'task.create') fields.dependencies = data.getAll('dependencies').flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
  if (await mutate(action, fields)) {
    form.reset();
    if (form.id === 'approval-form') updateApprovalFields();
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
  if (input.matches('#git-list [data-project-select]')) {
    setText('git-index-feedback', '');
    refreshGitFiles(input.closest('section'), input.value);
  }
  if (input.id === 'approval-project' && byId('approval-kind').value === 'git.push') refreshApprovalRemotes(input.value);
  if (input.id === 'approval-kind') updateApprovalFields();
  if (input.id === 'preview-viewport') {
    const size = previewSizes[input.value];
    if (size) [byId('preview-width').value, byId('preview-height').value] = size;
    applyPreviewSize();
  }
  if (input.id === 'preview-width' || input.id === 'preview-height') {
    byId('preview-viewport').value = 'custom';
    applyPreviewSize();
  }
  if (input.id === 'preview-autoreload') configurePreviewReload();
  if (input.id === 'preview-project') {
    showPreview();
    byId('preview-url').value = savedPreviewUrl();
    setText('preview-feedback', savedPreviewUrl() ? 'Endereço salvo neste projeto.' : 'Salve o endereço local do projeto para abrir o preview.');
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
  const previewButton = event.target.closest('#previews button');
  if (previewButton) {
    const url = savedPreviewUrl();
    if (previewButton.matches('[data-preview-save]')) {
      const projectId = byId('preview-project').value;
      const input = byId('preview-url');
      if (!projectId || !input.value || !input.checkValidity()) {
        setText('preview-feedback', 'Informe um projeto e uma URL HTTP local válida.');
        return;
      }
      previewButton.disabled = true;
      const saved = await mutate('preview.save', { projectId, url: input.value });
      if (saved && byId('preview-project').value === projectId) input.value = savedPreviewUrl();
      previewButton.disabled = false;
    } else if (previewButton.matches('[data-preview-start], [data-preview-open]')) {
      if (!url || url !== byId('preview-url').value) {
        setText('preview-feedback', 'Salve o endereço do projeto antes de abrir.');
        return;
      }
      if (previewButton.matches('[data-preview-open]')) window.open(url, '_blank', 'noopener,noreferrer');
      else {
        showPreview(url);
        setText('preview-feedback', 'Endereço aberto no quadro.');
      }
    } else if (previewButton.matches('[data-preview-stop]')) {
      showPreview();
      setText('preview-feedback', 'Preview parado.');
    } else if (previewButton.matches('[data-preview-reload]') && activePreviewUrl) {
      byId('preview-frame').src = activePreviewUrl;
    } else if (previewButton.matches('[data-preview-rotate]')) {
      const width = byId('preview-width'), height = byId('preview-height');
      [width.value, height.value] = [height.value, width.value];
      byId('preview-viewport').value = 'custom';
      applyPreviewSize();
    }
    return;
  }
  const indexButton = event.target.closest('[data-git-index-action]');
  if (indexButton) {
    const action = 'git.' + indexButton.dataset.gitIndexAction;
    const group = indexButton.closest('section');
    const controls = [...group.querySelectorAll('[data-git-index-action]')];
    controls.forEach(button => { button.disabled = true; });
    try {
      const result = await request('', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, data: { projectId: indexButton.dataset.gitProject, path: indexButton.dataset.gitPath } }),
      });
      renderGitFiles(group, indexButton.dataset.gitProject, result.files);
      setText('git-index-feedback', actionLabels[action] + '.');
      void refresh();
    } catch (error) {
      setText('git-index-feedback', error.message);
    } finally {
      controls.forEach(button => { button.disabled = false; });
    }
    return;
  }
  const approvalButton = event.target.closest('[data-approval-action], [data-approval-diff]');
  if (approvalButton) {
    if (approvalButton.dataset.approvalDiff) {
      const output = approvalButton.parentElement.querySelector(`[data-approval-diff-output="${approvalButton.dataset.approvalDiff}"]`);
      approvalButton.disabled = true;
      try {
        const query = new URLSearchParams({ view: 'approval-diff', approval: approvalButton.dataset.approvalDiff });
        const result = await request('?' + query);
        output.hidden = false;
        output.textContent = result.output || 'Nenhuma diferença disponível.';
      } catch (error) { output.hidden = false; output.textContent = error.message; }
      finally { approvalButton.disabled = false; }
      return;
    }
    const id = approvalButton.dataset.approvalId;
    const revision = approvalButton.dataset.approvalRevision;
    let action = 'approval.' + approvalButton.dataset.approvalAction;
    let data = { id, revision };
    if (action === 'approval.edit') {
      const card = approvalButton.closest('.approval-card');
      const message = card.querySelector(`[data-approval-message="${id}"]`);
      if (message) data.message = message.value;
      data.reason = card.querySelector(`[data-approval-reason="${id}"]`).value;
    }
    approvalButton.disabled = true;
    await mutate(action, data);
    approvalButton.disabled = false;
    return;
  }
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

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-plan], [data-accept-plan]');
  if (!button) return;
  button.disabled = true;
  try {
    if (button.dataset.acceptPlan) {
      await mutate('objective.plan', { id: button.dataset.acceptPlan });
      return;
    }
    const query = new URLSearchParams({ view: 'plan', objective: button.dataset.plan });
    const { steps } = await request('?' + query);
    const preview = element('div');
    preview.setAttribute('aria-live', 'polite');
    if (!steps.length) {
      preview.textContent = 'Nenhuma etapa explícita foi identificada. Cadastre as tarefas manualmente.';
    } else {
      const list = element('ol');
      for (const step of steps) {
        const dependencies = step.dependencies.map(index => index + 1).join(', ');
        list.append(element('li', [step.title, planRoles[step.role], 'perfil ' + modelTiers[step.modelTier], dependencies && 'depende de ' + dependencies].filter(Boolean).join(' · ')));
      }
      const accept = element('button', 'Registrar tarefas do rascunho', 'button');
      accept.type = 'button';
      accept.dataset.acceptPlan = button.dataset.plan;
      preview.append(list, accept);
    }
    button.replaceWith(preview);
  } catch (error) {
    setText('form-feedback', error.message);
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
checksProject.addEventListener('change', () => {
  checksScript.disabled = true;
  updateCheckControls();
  byId('checks-runs').replaceChildren();
  setText('checks-status', 'Localizando scripts…');
  refreshChecks();
});
checksScript.addEventListener('change', updateCheckControls);
checksStart.addEventListener('click', () => submitCheck('check.start', { script: checksScript.value }));
byId('checks-runs').addEventListener('click', event => {
  const button = event.target.closest('[data-cancel-check]');
  if (button) submitCheck('check.cancel', { id: button.dataset.cancelCheck });
});
setInterval(() => {
  if (!document.hidden && checksProject.value && !checksPending) refreshChecks();
}, 3000);
window.addEventListener('hashchange', highlightSection);
highlightSection();
for (const key of ['theme', 'density']) {
  const control = byId(key);
  try {
    const saved = localStorage.getItem('projeto-all.' + key);
    if (Array.from(control.options).some(option => option.value === saved)) control.value = saved;
  } catch {}
  const apply = () => { document.documentElement.dataset[key] = control.value; };
  control.addEventListener('change', () => {
    apply();
    try { localStorage.setItem('projeto-all.' + key, control.value); } catch {}
  });
  apply();
}
try {
  if (localStorage.getItem('projeto-all.task-view') === 'board') byId('task-view').value = 'board';
} catch {}
await refresh();
setInterval(refresh, 5000);
document.addEventListener('visibilitychange', refresh);
window.addEventListener('online', refresh);
window.addEventListener('pagehide', () => clearInterval(previewReloadTimer));
