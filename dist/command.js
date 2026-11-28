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
const checkLabels = { running: 'Em execução', passed: 'Aprovada', failed: 'Falhou', cancelled: 'Cancelada', timed_out: 'Tempo limite', interrupted: 'Interrompida' };
const executorLabels = {
  cancelled: 'Cancelada',
  dispatching: 'Enviando', queued: 'Na fila', running: 'Em execução', done: 'Concluída',
  failed: 'Falhou', waiting_remote: 'Aguardando executor', dispatch_unknown: 'Envio não confirmado. Confira a fila local.',
};
const actionLabels = {
  'project.create': 'Projeto cadastrado', 'objective.create': 'Objetivo criado',
  'objective.pause': 'Objetivo pausado', 'objective.resume': 'Objetivo retomado', 'objective.cancel': 'Objetivo cancelado',
  'task.create': 'Tarefa criada', 'task.state': 'Estado da tarefa atualizado', 'task.schedule': 'Agendamento atualizado', 'objective.control': 'Controle do objetivo atualizado', 'project.executorPolicy': 'Política do executor atualizada',
  'objective.plan': 'Tarefas do plano registradas', 'approval.request': 'Aprovação solicitada', 'approval.requestPush': 'Aprovação de push solicitada',
  'approval.approve': 'Aprovação encaminhada', 'approval.reject': 'Aprovação rejeitada',
  'approval.edit': 'Aprovação editada', 'git.stage': 'Caminho preparado', 'git.unstage': 'Caminho retirado do índice',
  'approval.completed': 'Operação aprovada concluída',
  'approval.failed': 'Falha na operação aprovada',
  'approval.interrupted': 'Execução interrompida',
  'notification.read': 'Leitura registrada',
  'preview.save': 'Preview salvo',
  'check.passed': 'Verificação aprovada', 'check.failed': 'Verificação falhou',
  'check.cancelled': 'Verificação cancelada', 'check.timed_out': 'Verificação excedeu o tempo limite',
  'task.dispatch': 'Envio ao Codex solicitado', 'task.executor.queued': 'Tarefa na fila Codex',
  'task.executor.running': 'Tarefa em execução no Codex', 'task.executor.done': 'Tarefa Codex pronta para revisão',
  'task.executor.failed': 'Execução Codex falhou', 'task.executor.dispatch_unknown': 'Envio ao Codex não confirmado',
  'task.dispatch.interrupted': 'Envio ao Codex interrompido',
  'task.executor.cancel': 'Execução Codex cancelada',
  'task.executor.cancelled': 'Envio retirado da fila Codex',
  'task.check': 'Verificação da tarefa iniciada', 'task.check.passed': 'Verificação da tarefa aprovada',
  'task.check.failed': 'Verificação da tarefa falhou', 'task.check.cancelled': 'Verificação da tarefa cancelada',
  'task.check.timed_out': 'Verificação excedeu o tempo limite', 'task.check.interrupted': 'Verificação da tarefa interrompida',
};
let state = { projects: [], objectives: [], tasks: [], audit: [], approvals: [], previews: [], notifications: [] };
let revision;
let loading = false;
let approvalsSignature;
let notificationsSignature;
let auditRequest = 0;
let auditOffset = 0;
let auditQuery = "";
let auditKind = "all";
let previewReloadTimer;
const reviewStates = new Map();
let graphRequest = 0;
let graphObjective = '';
let graphRevision;
let coordinatorJobs = { available: false, jobs: [] };
let coordinatorJobsLoading = false;
let coordinatorJobsVisible = false;
let coordinatorJobsRequest = 0;
let coordinatorJobsObserver;
let coordinatorJobsTimer;

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

function renderCoordinatorJobs() {
  const list = byId('coordinator-jobs-list');
  const meta = byId('coordinator-jobs-meta');
  const status = byId('coordinator-jobs-status');
  if (!list || !meta || !status) return;
  if (!coordinatorJobs.available) {
    meta.textContent = 'indisponível';
    status.textContent = 'Fila do executor local indisponível.';
    list.replaceChildren();
    return;
  }
  const jobs = Array.isArray(coordinatorJobs.jobs) ? coordinatorJobs.jobs : [];
  meta.textContent = jobs.length + (jobs.length === 1 ? ' execução' : ' execuções');
  status.textContent = jobs.length ? '' : 'A fila local está vazia.';
  fill('coordinator-jobs-list', jobs, job => {
    const item = element('article', undefined, 'executor-job-row');
    const title = element('div', undefined, 'executor-job-title');
    title.append(element('strong', job.project), element('span', executorLabels[job.status] || 'Estado indisponível', 'job-status'));
    const detail = [job.id, job.slot && 'vaga ' + String(job.slot).toUpperCase(),
      job.submitted && 'enviado ' + new Date(job.submitted).toLocaleString('pt-BR'),
      job.updated && 'atualizado ' + new Date(job.updated).toLocaleString('pt-BR'),
      job.files != null && job.files + ' arquivo(s) observado(s)'].filter(Boolean);
    item.append(title, element('p', detail.join(' · ')));
    return item;
  }, 'Nenhuma execução registrada.');
}

async function refreshCoordinatorJobs(explicit = false) {
  if ((!explicit && (!coordinatorJobsVisible || document.hidden)) || coordinatorJobsLoading) return;
  coordinatorJobsLoading = true;
  const requestId = ++coordinatorJobsRequest;
  try {
    const result = await request('?view=coordinator-jobs');
    if (requestId !== coordinatorJobsRequest) return;
    coordinatorJobs = { available: result?.available === true, jobs: Array.isArray(result?.jobs) ? result.jobs : [] };
  } catch {
    if (requestId !== coordinatorJobsRequest) return;
    coordinatorJobs = { available: false, jobs: [] };
  } finally {
    coordinatorJobsLoading = false;
    renderCoordinatorJobs();
  }
}

function configureCoordinatorJobsPolling() {
  const panel = byId('coordinator-jobs');
  byId('coordinator-jobs-refresh').addEventListener('click', () => void refreshCoordinatorJobs(true));
  if (!panel || !('IntersectionObserver' in window)) return;
  coordinatorJobsObserver = new IntersectionObserver(entries => {
    const visible = entries.some(entry => entry.isIntersecting);
    coordinatorJobsVisible = visible;
    if (visible) {
      void refreshCoordinatorJobs();
      if (!coordinatorJobsTimer) coordinatorJobsTimer = setInterval(refreshCoordinatorJobs, 5000);
    } else if (coordinatorJobsTimer) {
      clearInterval(coordinatorJobsTimer);
      coordinatorJobsTimer = undefined;
    }
  }, { threshold: 0.1 });
  coordinatorJobsObserver.observe(panel);
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

function renderProjectPolicies(usage) {
  const table = byId('projects-table');
  if (!state.projects.length) return;
  const rows = new Map([...table.querySelectorAll('[data-project-row]')].map(row => [row.dataset.projectRow, row]));
  for (const project of state.projects) {
    let row = rows.get(project.id);
    if (!row) {
      row = element('tr');
      row.dataset.projectRow = project.id;
      row.id = 'project-' + project.id;
      const cell = element('td');
      const details = element('details');
      const form = element('form', undefined, 'executor-policy-form');
      form.dataset.executorPolicy = project.id;
      const enabled = element('input');
      enabled.type = 'checkbox';
      enabled.dataset.policyEnabled = '';
      const enabledLabel = element('label', 'Habilitar envio');
      enabledLabel.prepend(enabled);
      const max = element('input');
      max.type = 'number';
      max.min = '1';
      max.max = '10';
      max.required = true;
      max.dataset.policyMax = '';
      const maxLabel = element('label', 'Limite por projeto');
      maxLabel.append(max);
      const save = element('button', 'Salvar política', 'button button-quiet');
      save.type = 'submit';
      form.append(enabledLabel, maxLabel, save);
      details.append(element('summary'), form);
      cell.append(details);
      row.append(element('td', project.name), element('td', project.path), cell);
      table.querySelector('[data-project-placeholder]')?.remove();
      table.append(row);
    }
    const policy = project.executorPolicy || { enabled: true, maxActive: 2 };
    const summary = (policy.enabled ? 'Envio habilitado' : 'Envio desabilitado') + ' · ' + (usage.get(project.id) || 0) + '/' + policy.maxActive + ' ativos';
    if (row.querySelector('summary').textContent !== summary) row.querySelector('summary').textContent = summary;
    const revision = JSON.stringify(policy);
    if (row.dataset.policyRevision === revision) continue;
    row.dataset.policyRevision = revision;
    row.querySelector('[data-policy-enabled]').checked = policy.enabled;
    row.querySelector('[data-policy-max]').value = policy.maxActive;
  }
}

function executorUsage() {
  const projectsByObjective = new Map(state.objectives.map(objective => [objective.id, objective.projectId]));
  const usage = new Map();
  for (const task of state.tasks) {
    if (!['dispatching', 'queued', 'running', 'dispatch_unknown'].includes(task.executor?.status)) continue;
    const project = projectsByObjective.get(task.objectiveId);
    if (project) usage.set(project, (usage.get(project) || 0) + 1);
  }
  return usage;
}

function render() {
  const getProject = id => state.projects.find(entry => entry.id === id)?.name;
  const usage = executorUsage();
  renderProjectPolicies(usage);
  setText('projects-count', state.projects.length + ' cadastrados');
  setText('tasks-count', state.tasks.filter(task => !['done', 'cancelled'].includes(task.state)).length + ' abertas');
  setText('coordinator-status', 'Rascunhos de plano e acompanhamento');
  prepareGit('git-list', [['status', 'Consultar status'], ['diff', 'Ver diff completo'], ['staged', 'Ver diff preparado'],
    ['branches', 'Listar branches'], ['saved-refs', 'Listar tags e stashes'], ['github-pulls', 'Consultar PRs no GitHub']]);
  renderApprovals();
  renderPreviewPanel();
  renderGraphPanel();
  renderNotifications();

  prepareGit('quality-list', [['check', 'Verificar alterações']]);
  fill('coordinator-detail', state.objectives, objective => {
    const tasks = state.tasks.filter(task => task.objectiveId === objective.id);
    const card = row(objective.title, [getProject(objective.projectId), tasks.filter(task => task.state === 'done').length + '/' + tasks.length + ' concluídas'].join(' · '));
    card.id = 'objective-' + objective.id;
    const status = objective.status || 'active';
    card.append(element('p', status === 'active' ? 'Ativo' : status === 'paused' ? 'Pausado' : 'Cancelado', 'objective-status'));
    const controls = element('div', undefined, 'objective-controls');
    for (const [action, label, visible] of [
      ['pause', 'Pausar novas execuções', status === 'active'],
      ['resume', 'Retomar', status === 'paused'],
      ['cancel', 'Cancelar objetivo', status !== 'cancelled'],
    ]) {
      if (!visible) continue;
      const button = element('button', label, 'button button-quiet');
      button.type = 'button';
      button.dataset.objectiveControl = action;
      button.dataset.objectiveId = objective.id;
      controls.append(button);
    }
    card.append(controls);
    if (!tasks.length && status !== 'cancelled') {
      const button = element('button', 'Gerar rascunho', 'button button-quiet');
      button.type = 'button';
      button.dataset.plan = objective.id;
      card.append(button);
    }
    return card;
  }, 'Crie um objetivo depois de cadastrar um projeto.');
  renderTasks(usage);
  void loadAudit();
  for (const select of document.querySelectorAll('select[name=projectId], select[data-project-select]')) {
    options(select, state.projects, project => project.name, 'Selecione um projeto');
  }
  for (const select of document.querySelectorAll('select[name=objectiveId]')) {
    options(select, state.objectives.filter(objective => objective.status !== 'cancelled'), objective => objective.title, 'Selecione um objetivo');
  }
  activeDependencies();
}

function renderTasks(usage = executorUsage()) {
  const getObjective = id => state.objectives.find(entry => entry.id === id)?.title;
  function taskRow(task) {
    const objective = state.objectives.find(item => item.id === task.objectiveId);
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
    const check = task.check;
    select.disabled = check?.status === 'running' || objective?.status === 'cancelled'
      || ['dispatching', 'queued', 'running', 'dispatch_unknown'].includes(task.executor?.status);
    if (objective?.status === 'paused' && task.state !== 'running') {
      select.querySelector('option[value="running"]').disabled = true;
    }
    item.append(select);
    if (check) item.append(checkInfo(check));
    if (task.executor) {
      item.append(executorInfo(task.executor));
      if (task.executor.status === 'queued') {
        const cancelExecutor = element('button', 'Retirar da fila Codex', 'button button-quiet');
        cancelExecutor.type = 'button';
        cancelExecutor.dataset.executorCancel = task.id;
        item.append(cancelExecutor);
      }
    }
    if (task.state === 'review' && task.executor?.status === 'done') {
      const review = element('button', 'Revisar alterações', 'button button-quiet');
      review.type = 'button';
      review.dataset.taskReview = task.id;
      item.append(review);
      const reviewed = reviewStates.get(task.id);
      if (reviewed) appendReview(item, task, reviewed);
    } else reviewStates.delete(task.id);
    const canSchedule = ['pending', 'failed'].includes(task.state);
    if (!canSchedule) return item;
    const checkControls = element('div', undefined, 'task-check-controls');
    const script = element('select'); script.dataset.taskCheckScript = task.id; script.setAttribute('aria-label', 'Verificação de ' + task.title);
    script.append(new Option('Verificar…', ''), ...['lint', 'test', 'build', 'typecheck'].map(name => new Option(name, name)));
    const run = element('button', 'Executar verificação', 'button button-quiet'); run.type = 'button'; run.dataset.taskCheck = task.id; run.disabled = true;
    const runnable = objective?.status !== 'paused' && task.dependencies.every(id => state.tasks.find(item => item.id === id)?.state === 'done');
    const schedule = element('button', task.scheduledScript ? 'Limpar agendamento' : 'Agendar', 'button button-quiet'); schedule.type = 'button'; schedule.dataset.taskSchedule = task.id; schedule.dataset.taskScheduled = task.scheduledScript || '';
    schedule.disabled = !task.scheduledScript;
    script.addEventListener('change', () => { run.disabled = !script.value || !runnable; schedule.disabled = !task.scheduledScript && !script.value; });
    checkControls.append(script, run, schedule); item.append(checkControls);
    if (task.scheduledScript) item.append(element('p', 'Agendado: ' + task.scheduledScript, 'task-schedule-info'));
    const projectPolicy = state.projects.find(project => project.id === objective?.projectId)?.executorPolicy || { enabled: true, maxActive: 2 };
    const projectUsage = usage.get(objective?.projectId) || 0;
    if (state.dispatchEnabled && projectPolicy.enabled !== false && projectUsage < (projectPolicy.maxActive || 2) && runnable && !task.scheduledScript && task.executor?.status !== 'dispatch_unknown') {
      const dispatch = element('button', 'Enviar ao Codex', 'button button-quiet');
      dispatch.type = 'button';
      dispatch.dataset.taskDispatch = task.id;
      checkControls.append(dispatch);
    }
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
    prepareCommittedPaths(target, select);
  }
}

function prepareCommittedPaths(target, projectSelect) {
  const panel = element('details', undefined, 'panel display-settings');
  const form = element('form', undefined, 'inspection-controls');
  const label = element('label', 'Filtrar por caminho ');
  const input = element('input');
  input.type = 'search';
  input.maxLength = 120;
  label.append(input);
  const search = element('button', 'Consultar HEAD', 'button button-quiet');
  search.type = 'submit';
  const next = element('button', 'Próxima página', 'button button-quiet');
  next.type = 'button';
  next.hidden = true;
  form.append(label, search, next);
  const status = element('p', 'Selecione um projeto e consulte os arquivos do último commit.');
  status.setAttribute('role', 'status');
  const output = element('pre');
  output.dataset.gitOutput = '';
  panel.append(element('summary', 'Arquivos no commit atual'), form, status, output);
  target.append(panel);

  let sequence = 0;
  let query = '';
  let page;
  projectSelect.addEventListener('change', () => {
    sequence += 1;
    page = undefined;
    next.hidden = true;
    output.textContent = '';
    status.textContent = 'Consulte os arquivos do projeto selecionado.';
  });
  async function loadPaths(useNext) {
    const project = projectSelect.value;
    if (!project) {
      status.textContent = 'Selecione um projeto cadastrado.';
      return;
    }
    const id = ++sequence;
    const params = new URLSearchParams({ view: 'committed-paths', project, q: query });
    const offset = useNext ? page.next : 0;
    if (useNext) {
      params.set('offset', offset);
      params.set('revision', page.revision);
    }
    next.hidden = true;
    status.textContent = 'Consultando arquivos…';
    try {
      const result = await request('?' + params);
      if (sequence !== id) return;
      page = result;
      status.textContent = result.paths.length
        ? (offset + 1) + '–' + (offset + result.paths.length) + ' de ' + result.total + ' caminhos'
        : 'Nenhum caminho encontrado.';
      output.textContent = result.paths.map(path => /[\u0000-\u001f\u007f]/.test(path) ? JSON.stringify(path) : path).join('\n');
      next.hidden = result.next == null;
    } catch (error) {
      if (sequence !== id) return;
      output.textContent = '';
      status.textContent = error.message;
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    query = input.value;
    void loadPaths(false);
  });
  next.addEventListener('click', () => {
    if (!next.hidden && page?.next != null) void loadPaths(true);
  });
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
    item.id = 'approval-' + approval.id;
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

function renderNotifications() {
  const notifications = state.notifications;
  const unread = notifications.filter(notification => !notification.read).length;
  const count = unread + (unread === 1 ? ' não lida' : ' não lidas');
  setText('notifications-count', count);
  const nav = document.querySelector('[data-section="notifications"]');
  nav.dataset.unread = unread;
  nav.setAttribute('aria-label', 'Notificações, ' + count);
  document.querySelector('[data-notification-read-all]').disabled = !unread;
  fill('notifications-list', notifications, notification => {
    const item = element('article', undefined, 'notification-row ' + (notification.read ? 'is-read' : 'is-unread'));
    item.append(element('strong', actionLabels[notification.action] || 'Notificação local'));
    if (notification.at) item.append(element('small', new Date(notification.at).toLocaleString('pt-BR')));
    const task = notification.action.startsWith('task.') && state.tasks.find(entry => entry.id === notification.result);
    const approval = notification.action.startsWith('approval.') && state.approvals.some(entry => entry.id === notification.result);
    const link = element('a', task ? 'Abrir tarefa' : approval ? 'Abrir aprovação' : 'Abrir Qualidade');
    if (task) link.href = '#task-' + task.id;
    else if (approval) link.href = '#approval-' + notification.result;
    else if (notification.action.startsWith('check.')) link.href = '#qualidade';
    if (link.hasAttribute('href')) item.append(link);
    if (!notification.read) {
      const button = element('button', 'Marcar como lida', 'button button-quiet');
      button.type = 'button';
      button.dataset.notificationRead = notification.id;
      item.append(button);
    }
    return item;
  }, 'Nenhuma notificação local.');
}

function auditTarget(entry) {
  const category = entry.action.split('.')[0];
  const id = entry.result;
  if (category === 'task' && state.tasks.some(item => item.id === id)) return '#task-' + id;
  if (category === 'approval' && state.approvals.some(item => item.id === id)) return '#approval-' + id;
  if (category === 'objective' && state.objectives.some(item => item.id === id)) return '#objective-' + id;
  if (['project', 'git'].includes(category) && state.projects.some(item => item.id === id)) return '#project-' + id;
  if (category === 'check') return '#qualidade';
  if (category === 'preview') return '#previews';
  return '';
}

async function loadAudit() {
  const sequence = ++auditRequest;
  const query = new URLSearchParams({ view: 'audit', q: auditQuery, kind: auditKind, limit: '25', offset: String(auditOffset) });
  try {
    const { entries, total, offset, limit } = await request('?' + query);
    if (sequence !== auditRequest) return;
    fill('history-list', entries, entry => {
      const date = entry.at ? new Date(entry.at).toLocaleString('pt-BR') : '';
      const item = row(actionLabels[entry.action] || entry.action, date);
      const target = auditTarget(entry);
      if (target) {
        const link = element('a', 'Abrir contexto', 'audit-context');
        link.href = target;
        item.append(link);
      }
      return item;
    }, 'Nenhum evento encontrado.');
    const pager = byId('audit-pagination');
    pager.replaceChildren();
    for (const [label, page, visible] of [
      ['Anterior', Math.max(0, offset - limit), offset > 0],
      ['Próxima', offset + limit, offset + limit < total],
    ]) {
      if (!visible) continue;
      const button = element('button', label, 'button button-quiet');
      button.type = 'button';
      button.dataset.auditPage = String(page);
      pager.append(button);
    }
    pager.append(element('span', total ? (offset + 1) + '–' + Math.min(offset + limit, total) + ' de ' + total : '0 eventos'));
  } catch (error) {
    if (sequence !== auditRequest) return;
    setText('history-list', error.message);
    byId('audit-pagination').replaceChildren();
  }
}

function applyPreviewSize() {
  const frame = byId('preview-frame');
  for (const side of ['width', 'height']) {
    const input = byId('preview-' + side);
    input.value = Math.min(2400, Math.max(240, Math.round(input.valueAsNumber) || 240));
    frame.style[side] = input.value + 'px';
  }
}

let graphNodes = new Map();
let selectedGraphNode;

function renderGraphPanel() {
  const select = byId('graph-objective');
  options(select, state.objectives, objective => objective.title, 'Selecione um objetivo');
  if (select.value && (select.value !== graphObjective || graphRevision !== revision)) {
    graphObjective = select.value;
    graphRevision = revision;
    void loadGraph(select.value);
  }
}

function resetGraph() {
  graphNodes.clear();
  selectedGraphNode = undefined;
  const canvas = byId('graph-canvas');
  canvas.replaceChildren();
  canvas.hidden = true;
  byId('graph-details').replaceChildren();
  setText('graph-counts', '');
}

async function loadGraph(objective) {
  const sequence = ++graphRequest;
  setText('graph-status', 'Carregando dependências…');
  try {
    const query = new URLSearchParams({ view: 'graph', objective });
    const graph = await request('?' + query);
    if (sequence !== graphRequest || byId('graph-objective').value !== objective) return;
    renderGraph(graph);
  } catch (error) {
    if (sequence !== graphRequest || byId('graph-objective').value !== objective) return;
    resetGraph();
    setText('graph-status', error.message);
    graphRevision = undefined;
  }
}

function graphStatus(node) {
  if (node.ready) return 'Pronta';
  if (node.executor?.status === 'queued') return 'Na fila do Codex';
  if (node.state === 'pending' && node.paused) return 'Objetivo pausado';
  if (node.state === 'pending' && node.layer === null) return 'Dependência não resolvida';
  if (node.state === 'pending' && node.waitingOn.length) return 'Aguardando dependência';
  return labels[node.state] || 'Pendente';
}

function renderGraph({ nodes, edges, counts, truncated }) {
  const canvas = byId('graph-canvas');
  const warning = [
    counts.unresolved && counts.unresolved + ' tarefa(s) com dependências não resolvidas',
    truncated && 'Parte do grafo foi omitida pelo limite de exibição',
  ].filter(Boolean).join(' · ');
  setText('graph-status', warning || (nodes.length ? 'Selecione uma tarefa para abrir os detalhes.' : 'Nenhuma tarefa neste objetivo.'));
  setText('graph-counts', counts.total + ' tarefas · ' + counts.ready + ' prontas · ' + counts.waiting + ' aguardando · ' + counts.done + ' concluídas');
  graphNodes = new Map(nodes.map(node => [node.id, node]));
  canvas.hidden = !nodes.length;
  if (!nodes.length) {
    canvas.replaceChildren();
    showGraphNode();
    return;
  }

  const layers = new Map();
  for (const node of nodes) {
    const layer = node.layer ?? Infinity;
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer).push(node);
  }
  const ordered = [...layers.entries()].sort((a, b) => a[0] - b[0]);
  const width = ordered.length * 220;
  const height = Math.max(...ordered.map(([, entries]) => entries.length * 88 + 24));
  const positions = new Map();
  const board = element('div', undefined, 'graph-board');
  board.style.width = width + 'px';
  board.style.height = height + 'px';
  for (const [column, [, entries]] of ordered.entries()) {
    entries.forEach((node, index) => {
      const x = column * 220 + 20;
      const y = index * 88 + 20;
      positions.set(node.id, { x, y });
      const button = element('button', undefined, 'graph-node');
      button.type = 'button';
      button.dataset.graphNode = node.id;
      button.dataset.state = node.state;
      button.dataset.ready = String(node.ready);
      button.style.left = x + 'px';
      button.style.top = y + 'px';
      button.append(element('strong', node.title), element('small', graphStatus(node) + (node.external ? ' · outro objetivo' : '')));
      board.append(button);
    });
  }

  const svgNS = 'http://www.w3.org/2000/svg';
  const connections = document.createElementNS(svgNS, 'svg');
  connections.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  connections.setAttribute('aria-hidden', 'true');
  for (const { from, to } of edges) {
    const start = positions.get(from);
    const end = positions.get(to);
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', start.x + 174);
    line.setAttribute('y1', start.y + 32);
    line.setAttribute('x2', end.x);
    line.setAttribute('y2', end.y + 32);
    connections.append(line);
  }
  board.prepend(connections);
  canvas.replaceChildren(board);
  showGraphNode(selectedGraphNode);
}

function checkInfo(check) {
  return element('p', [
    'Verificação: ' + check.script, checkLabels[check.status],
    check.durationMs != null && (check.durationMs / 1000).toFixed(1) + ' s',
  ].filter(Boolean).join(' · '), 'task-check-info');
}

function executorInfo(executor) {
  return element('p', [
    'Executor Codex: ' + (executorLabels[executor.status] || 'Estado indisponível'),
    executor.id, executor.files != null && executor.files + ' arquivo(s) observado(s)',
  ].filter(Boolean).join(' · '), 'task-executor-info');
}

function appendReview(item, task, review) {
  const output = element('pre', review.output || 'Nenhuma diferença rastreada.', 'task-review-output');
  item.append(output);
  if (review.files?.length) item.append(element('p', 'Arquivos: ' + review.files.join(', '), 'task-review-files'));
  const done = element('button', 'Marcar concluída', 'button button-quiet');
  done.type = 'button';
  done.dataset.reviewDone = task.id;
  done.dataset.reviewRevision = review.revision || '';
  if (review.untracked?.length) {
    const label = element('label', 'Confirmei os arquivos não rastreados na worktree.');
    const confirm = element('input');
    confirm.type = 'checkbox';
    confirm.dataset.reviewUntracked = '';
    done.disabled = true;
    confirm.addEventListener('change', () => { done.disabled = !confirm.checked; });
    label.prepend(confirm);
    item.append(element('p', 'Não rastreados: ' + review.untracked.join(', '), 'task-review-files'), label);
  }
  item.append(done);
}

function showGraphNode(id) {
  const node = graphNodes.get(id);
  selectedGraphNode = node?.id;
  const detail = byId('graph-details');
  detail.replaceChildren();
  for (const button of byId('graph-canvas').querySelectorAll('[data-graph-node]')) {
    button.setAttribute('aria-pressed', String(button.dataset.graphNode === selectedGraphNode));
  }
  if (!node) return;
  detail.append(element('strong', node.title), element('p', [
    graphStatus(node), planRoles[node.role], node.external && 'Outro objetivo',
  ].filter(Boolean).join(' · ')));
  const check = node.check || state.tasks.find(task => task.id === node.id)?.check;
  if (check) detail.append(checkInfo(check));
  if (node.scheduledScript) detail.append(element('p', 'Agendado: ' + node.scheduledScript, 'task-schedule-info'));
  const executor = node.executor || state.tasks.find(task => task.id === node.id)?.executor;
  if (executor) detail.append(executorInfo(executor));
  if (node.dependencies.length) {
    const list = element('ul');
    for (const dependency of node.dependencies) {
      const task = graphNodes.get(dependency);
      list.append(element('li', (task?.title || 'Dependência indisponível no grafo') + (node.waitingOn.includes(dependency) ? ' · pendente' : ' · concluída')));
    }
    detail.append(element('p', 'Dependências'), list);
  }
  const link = element('a', 'Abrir tarefa na lista');
  link.href = '#task-' + id;
  detail.append(link);
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
    const values = {
      projects: state.projects.length,
      objectives: state.objectives.length,
      running: state.tasks.filter(task => task.state === 'running').length,
      sessions: observed.sessions,
      checks: resources?.activeChecks ?? '—',
      cpu: Number.isFinite(resources?.cpuPercent) ? resources.cpuPercent.toFixed(1) + '%' : '—',
    };
    const stats = displayWidgets.filter(widget => widget.visible).map(({ id, wide }) => [id, values[id], wide]);
    const signature = JSON.stringify(stats);
    const overview = byId('overview-stats');
    if (overview.dataset.signature !== signature) {
      overview.dataset.signature = signature;
      overview.replaceChildren(...stats.map(([id, value, wide]) => {
        const card = element('article', undefined, 'stat-card');
        card.dataset.widget = id;
        card.classList.toggle('is-wide', wide);
        card.append(element('span', widgetTitles[id]), element('strong', value));
        return card;
      }));
    }
    setText('activity-chart', observed.sessions + ' sessões em ' + observed.projects + ' projetos observados.');
  }
  if (!resources) return;
  renderObservability(resources);
  const gib = bytes => (bytes / 2 ** 30).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' GiB';
  const used = Math.round(100 * (1 - resources.free / resources.total));
  setText('resource-percent', used + '% RAM');
  byId('resource-meter').style.width = used + '%';
  setText('resource-summary', gib(resources.total - resources.free) + ' em uso · ' + resources.cores + ' núcleos lógicos');
}

function renderObservability(resources) {
  let panel = byId('observabilidade');
  if (!panel) {
    panel = element('section', undefined, 'panel observability-panel'); panel.id = 'observabilidade'; panel.dataset.panel = 'observabilidade';
    panel.innerHTML = '<header class="panel-header"><div><p class="eyebrow">TELEMETRIA</p><h2>Observabilidade</h2></div><span class="panel-meta">snapshot local</span></header><div class="observability-grid"><div class="observation-metric"><div><span>CPU</span><strong id="obs-cpu-label">Indisponível</strong></div><div class="observation-bar" role="progressbar" aria-label="Uso de CPU"><i id="obs-cpu-bar"></i></div></div><div class="observation-metric"><div><span>Memória</span><strong id="obs-memory-label">Indisponível</strong></div><div class="observation-bar" role="progressbar" aria-label="Uso de memória"><i id="obs-memory-bar"></i></div></div><dl class="observation-details"><div><dt>Checks ativos</dt><dd id="obs-checks">Indisponível</dd></div><div><dt>Núcleos</dt><dd id="obs-cores">Indisponível</dd></div><div><dt>RSS do servidor</dt><dd id="obs-rss">Indisponível</dd></div><div><dt>Uptime</dt><dd id="obs-uptime">Indisponível</dd></div></dl></div>';
    byId('visao')?.after(panel);
    const nav = document.querySelector('.main-nav');
    if (nav && !nav.querySelector('[data-section="observabilidade"]')) {
      const link = element('a', undefined, 'nav-item');
      link.href = '#observabilidade';
      link.dataset.section = 'observabilidade';
      const icon = element('span', '⌁', 'nav-icon');
      link.append(icon, 'Observabilidade');
      prepareNavLink(link);
      nav.append(link);
      highlightSection();
    }
  }
  const formatBytes = bytes => Number.isFinite(bytes) ? (bytes / 2 ** 30).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' GiB' : 'Indisponível';
  const formatUptime = seconds => Number.isFinite(seconds) ? Math.floor(seconds / 3600) + 'h ' + Math.floor(seconds / 60) % 60 + 'min' : 'Indisponível';
  const cpu = Number.isFinite(resources.cpuPercent) ? Math.max(0, Math.min(100, resources.cpuPercent)) : null;
  const used = Number.isFinite(resources.total) && resources.total > 0 && Number.isFinite(resources.free) ? Math.max(0, Math.min(100, 100 * (1 - resources.free / resources.total))) : null;
  setText('obs-cpu-label', cpu == null ? 'Indisponível' : cpu.toFixed(1) + '%'); setText('obs-memory-label', used == null ? 'Indisponível' : used.toFixed(1) + '%');
  setText('obs-checks', Number.isFinite(resources.activeChecks) ? String(resources.activeChecks) : 'Indisponível'); setText('obs-cores', Number.isFinite(resources.cores) ? String(resources.cores) : 'Indisponível'); setText('obs-rss', formatBytes(resources.serverRss)); setText('obs-uptime', formatUptime(resources.uptime));
  for (const [id, value] of [['obs-cpu-bar', cpu], ['obs-memory-bar', used]]) { const bar = byId(id); bar.style.width = (value == null ? 0 : value) + '%'; bar.parentElement.setAttribute('aria-valuenow', value == null ? '0' : String(value)); bar.parentElement.setAttribute('aria-valuetext', value == null ? 'Indisponível' : value.toFixed(1) + '%'); }
}

async function request(query = '', init) {
  let action;
  try { action = init?.body && JSON.parse(init.body).action; } catch {}
  const timeout = ['approval.requestPush', 'approval.approve'].includes(action) ? 70000
    : query.includes('view=github-pulls') ? 15000 : 8000;
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
  if ((snapshot.auditVersion ?? snapshot.audit.length) < (state.auditVersion ?? state.audit.length)) return;
  const readNotifications = new Set((state.notifications || []).filter(item => item.read).map(item => item.id));
  const notifications = Array.isArray(snapshot.notifications) ? snapshot.notifications.map(item => readNotifications.has(item.id) ? { ...item, read: true } : item) : state.notifications;
  state = { ...state, ...snapshot, notifications };
  const nextApprovals = JSON.stringify(state.approvals || []);
  if (approvalsSignature !== nextApprovals) {
    approvalsSignature = nextApprovals;
    renderApprovals();
  }
  const nextNotifications = JSON.stringify(state.notifications || []);
  if (notificationsSignature !== nextNotifications) { notificationsSignature = nextNotifications; renderNotifications(); }
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
  if (form.id === 'audit-filters') {
    event.preventDefault();
    auditOffset = 0;
    auditQuery = byId('audit-search').value;
    auditKind = byId('audit-kind').value;
    void loadAudit();
    return;
  }
  if (form.matches('[data-executor-policy]')) {
    event.preventDefault();
    const maxActive = form.querySelector('[data-policy-max]').valueAsNumber;
    const button = form.querySelector('button[type=submit]'); button.disabled = true;
    await mutate('project.executorPolicy', { id: form.dataset.executorPolicy, enabled: form.querySelector('[data-policy-enabled]').checked, maxActive });
    button.disabled = false;
    return;
  }
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
    input.closest('#git-list').querySelector('[data-git-output]').textContent = 'Selecione uma consulta Git.';
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
  if (input.id === 'graph-objective') {
    resetGraph();
    graphObjective = input.value;
    graphRevision = revision;
    byId('graph-refresh').disabled = !input.value;
    if (input.value) void loadGraph(input.value);
    else setText('graph-status', 'Selecione um objetivo para carregar o grafo.');
  }

  if (input.name === 'objectiveId') activeDependencies();
  if (!input.dataset.task) return;
  input.disabled = true;
  if (!await mutate('task.state', { id: input.dataset.task, state: input.value })) {
    input.value = state.tasks.find(task => task.id === input.dataset.task)?.state;
    input.disabled = false;
  }
});

document.addEventListener('click', event => {
  const auditPage = event.target.closest('[data-audit-page]');
  if (auditPage) { auditOffset = Number(auditPage.dataset.auditPage) || 0; loadAudit(); return; }
  const graphNode = event.target.closest('[data-graph-node]');
  if (graphNode) showGraphNode(graphNode.dataset.graphNode);
});

document.addEventListener('click', async event => {
  const notificationButton = event.target.closest('[data-notification-read], [data-notification-read-all]');
  if (notificationButton) {
    notificationButton.disabled = true;
    await mutate('notification.read', notificationButton.dataset.notificationRead ? { id: notificationButton.dataset.notificationRead } : { all: true });
    notificationButton.disabled = notificationButton.hasAttribute('data-notification-read-all') && state.notifications.every(item => item.read);
    return;
  }
  const cancelExecutor = event.target.closest('[data-executor-cancel]');
  if (cancelExecutor) {
    if (!window.confirm('Cancelar a execução Codex desta tarefa?')) return;
    cancelExecutor.disabled = true;
    await mutate('task.executor.cancel', { id: cancelExecutor.dataset.executorCancel });
    cancelExecutor.disabled = false;
    return;
  }
  const reviewButton = event.target.closest('[data-task-review]');
  if (reviewButton) {
    reviewButton.disabled = true;
    try {
      const query = new URLSearchParams({ view: 'executor-review', task: reviewButton.dataset.taskReview });
      const result = await request('?' + query);
      reviewStates.set(reviewButton.dataset.taskReview, result);
      renderTasks();
    } catch (error) { reviewButton.replaceWith(element('p', error.message, 'task-review-error')); }
    return;
  }
  const doneButton = event.target.closest('[data-review-done]');
  if (doneButton) {
    doneButton.disabled = true;
    const row = doneButton.closest('.record-row');
    await mutate('task.state', {
      id: doneButton.dataset.reviewDone, state: 'done', reviewRevision: doneButton.dataset.reviewRevision,
      confirmUntracked: row?.querySelector('[data-review-untracked]')?.checked === true,
    });
    doneButton.disabled = false;
    return;
  }
  const dispatch = event.target.closest('[data-task-dispatch]');
  if (dispatch) {
    const task = state.tasks.find(item => item.id === dispatch.dataset.taskDispatch);
    if (!task || !window.confirm('Enviar ao Codex a tarefa: ' + task.title + '?')) return;
    dispatch.disabled = true;
    await mutate('task.dispatch', { id: task.id });
    dispatch.disabled = false;
    return;
  }
  const control = event.target.closest('[data-objective-control]');
  if (control) {
    const action = control.dataset.objectiveControl;
    if (action === 'cancel' && !window.confirm('Cancelar este objetivo e suas tarefas inacabadas?')) return;
    control.disabled = true;
    await mutate('objective.control', { id: control.dataset.objectiveId, control: action });
    control.disabled = false;
    return;
  }
  const button = event.target.closest('[data-task-check]');
  const schedule = event.target.closest('[data-task-schedule]');
  if (schedule) {
    const script = schedule.dataset.taskScheduled || schedule.closest('.task-check-controls')?.querySelector('[data-task-check-script]')?.value;
    if (!script && !schedule.dataset.taskScheduled) return;
    schedule.disabled = true;
    await mutate('task.schedule', { id: schedule.dataset.taskSchedule, script: schedule.dataset.taskScheduled ? null : script });
    schedule.disabled = false;
    return;
  }
  if (!button) return;
  const script = button.closest('.task-check-controls')?.querySelector('[data-task-check-script]')?.value;
  if (!script) return;
  button.disabled = true;
  await mutate('task.check', { id: button.dataset.taskCheck, script });
  button.disabled = false;
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
  const projectSelect = group.querySelector('[data-project-select], select[name=projectId]');
  const project = projectSelect?.value;
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
    if (projectSelect.value !== project) return;
    if (button.dataset.gitView === 'branches') {
      const trackingLabels = { '=': 'sincronizada', '>': 'à frente', '<': 'atrás', '<>': 'divergente' };
      const heading = result.current ? 'Branch ativa: ' + result.current : 'HEAD destacado: ' + result.detachedSha;
      const branches = result.branches.map(branch => {
        const tracking = branch.upstream ? ' · ' + branch.upstream + ' (' + (trackingLabels[branch.tracking] || 'referência indisponível') + ')' : ' · sem upstream';
        return (branch.name === result.current ? '* ' : '  ') + branch.name + ' · ' + branch.sha + tracking;
      });
      output.textContent = [heading, ...(branches.length ? branches : ['Nenhuma branch com commit local.']),
        ...(result.truncated ? ['Mostrando as primeiras 100 branches.'] : [])].join('\n');
    } else if (button.dataset.gitView === 'saved-refs') {
      const tags = result.tags.map(({ name, type, sha, target }) =>
        name + ' · ' + sha + (type === 'tag' ? ' · anotada' : ' · ' + type)
          + (target ? ' · aponta para ' + target : ''));
      const stashes = result.stashes.map(({ ref, sha, created }) =>
        ref + ' · ' + sha + ' · ' + new Date(created).toLocaleString('pt-BR'));
      output.textContent = ['Tags locais', ...(tags.length ? tags : ['Nenhuma tag.']),
        ...(result.moreTags ? ['Mostrando as primeiras 100 tags.'] : []),
        '', 'Stashes locais', ...(stashes.length ? stashes : ['Nenhum stash.']),
        ...(result.moreStashes ? ['Mostrando os 100 stashes mais recentes.'] : [])].join('\n');
    } else if (button.dataset.gitView === 'github-pulls') {
      const [repository] = result.repositories;
      if (!repository) {
        output.textContent = result.branch ? 'Nenhum remoto GitHub compatível selecionado pelo Git.' : 'Nenhuma branch local ativa.';
        return;
      }
      const linkTo = (label, url) => {
        const link = element('a', label);
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        return link;
      };
      const summary = repository.available
        ? (repository.pulls.length ? '' : '\nNenhum PR aberto encontrado na API pública.')
        : '\nConsulta pública indisponível. Abra a busca no GitHub para consultar com sua sessão.';
      output.replaceChildren(repository.name + ' · ' + result.branch + ' · ' + repository.remote + '\n',
        linkTo('Buscar PRs da branch no GitHub', repository.url), summary);
      for (const pull of repository.pulls) {
        output.append('\n', linkTo('PR #' + pull.number + (pull.draft ? ' · Rascunho' : ''), pull.url));
        const checks = pull.checks;
        if (pull.sha) output.append(' · ' + pull.sha.slice(0, 7));
        if (!checks) output.append(' · Checks indisponíveis');
        else if (!checks.total) output.append(' · Sem checks reportados');
        else {
          const statuses = [[checks.passed, 'aprovados'], [checks.pending, 'pendentes'], [checks.failed, 'com falha'],
            [checks.skipped, 'neutros ou ignorados'], [checks.other, 'outros resultados']];
          const summary = statuses.filter(([count]) => count).map(([count, label]) => count + ' ' + label).join(', ');
          output.append(' · ' + checks.total + ' checks' + (checks.partial ? ' (parcial)' : '') + (summary ? ' · ' + summary : ''));
        }
        output.append(' · ', linkTo('Ver checks', pull.url + '/checks'));
        output.append(' · ', linkTo('Ver arquivos alterados', pull.url + '/files'));
        const workflows = pull.workflows;
        const workflowStates = new Map([
          ['queued', 'na fila'], ['requested', 'solicitado'], ['pending', 'pendente'], ['waiting', 'aguardando'],
          ['in_progress', 'em execução'], ['success', 'aprovado'], ['failure', 'falhou'], ['cancelled', 'cancelado'],
          ['timed_out', 'tempo limite'], ['neutral', 'neutro'], ['skipped', 'ignorado'], ['action_required', 'requer ação'],
        ]);
        if (!workflows) output.append('\n  GitHub Actions indisponível.');
        else if (!workflows.total) output.append('\n  Sem workflows do GitHub Actions para este commit.');
        else {
          output.append('\n  GitHub Actions: ' + workflows.total + (workflows.partial ? ' · Lista parcial' : ''));
          for (const run of workflows.runs) {
            output.append('\n    ', linkTo(run.name, run.url),
              run.attempt > 1 ? ' · tentativa ' + run.attempt : '',
              ' · ' + (workflowStates.get(run.state) ?? 'estado desconhecido'));
          }
        }
        const statuses = pull.statuses;
        const statusLabels = { success: 'aprovado', pending: 'pendente', failure: 'falhou', error: 'erro', unknown: 'desconhecido' };
        if (!statuses) output.append('\n  CI externo indisponível.');
        else if (!statuses.total) output.append('\n  Sem status de CI externo reportado.');
        else {
          const contexts = statuses.contexts.map(context => context.name + ' (' + statusLabels[context.state] + ')');
          output.append('\n  CI externo: ' + statusLabels[statuses.state] + ' (' + statuses.total + ')');
          if (contexts.length) output.append(' · ' + contexts.join(', '));
          if (contexts.length < statuses.total) output.append(' · Lista parcial');
        }
        const reviews = pull.reviews;
        if (!reviews) output.append('\n  Resumo de revisões indisponível.');
        else {
          const items = [[reviews.approved, 'aprovações neste commit'], [reviews.changesRequested, 'pedidos de alterações neste commit'],
            [reviews.earlier, 'decisões em commits anteriores'], [reviews.comments, 'revisões com comentários']];
          const summary = items.filter(([count]) => count).map(([count, label]) => count + ' ' + label).join(', ');
          output.append('\n  Revisões: ' + (summary || 'nenhuma decisão ou comentário reportado')
            + (reviews.partial ? ' · Consulta parcial' : '') + '.');
        }
      }
    } else {
      output.textContent = result.output || (result.passed ? 'Nenhum problema de espaço em branco nas alterações rastreadas.' : 'Nenhuma alteração rastreada.');
    }
  } catch (error) {
    if (projectSelect.value === project) output.textContent = error.message;
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
  const container = byId(hash.slice(1))?.closest('[data-panel]');
  for (const link of document.querySelectorAll('[data-section]')) {
    const current = link.hash === hash || (container && link.dataset.section === container.id);
    link.classList.toggle('is-active', current);
    if (current) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}
const searchDialog = byId('global-search');
const searchQuery = byId('global-search-query');
const searchResults = byId('global-search-results');
const normalizeSearch = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
function renderPalette(query) {
  const links = [...document.querySelectorAll('#command-navigation [data-section]')]
    .map(link => ({ label: 'Abrir ' + link.title, href: link.hash }));
  const commands = [{ label: 'Atualizar dados locais', action: 'refresh' }, ...links];
  const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  const matches = commands.filter(command => terms.every(term => normalizeSearch(command.label).includes(term)));
  for (const command of matches) {
    const item = element('li');
    const control = element(command.href ? 'a' : 'button', command.label);
    if (command.href) control.href = command.href;
    else {
      control.type = 'button';
      control.dataset.command = command.action;
    }
    item.append(control);
    searchResults.append(item);
  }
  setText('global-search-status', matches.length
    ? matches.length + (matches.length === 1 ? ' comando' : ' comandos')
    : 'Nenhum comando encontrado.');
}
function renderGlobalSearch() {
  searchResults.replaceChildren();
  const query = searchQuery.value.trim();
  if (query.startsWith('>')) return renderPalette(query.slice(1));
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return setText('global-search-status', 'Digite um nome, título ou ID.');
  const projects = new Map(state.projects.map(project => [project.id, project.name]));
  const objectives = new Map(state.objectives.map(objective => [objective.id, objective]));
  const groups = [
    ['project', 'Projeto', state.projects, entry => [entry.name]],
    ['objective', 'Objetivo', state.objectives, entry => [entry.title, projects.get(entry.projectId)]],
    ['task', 'Tarefa', state.tasks, entry => {
      const objective = objectives.get(entry.objectiveId);
      return [entry.title, objective?.title, projects.get(objective?.projectId)];
    }],
  ];
  let count = 0;
  for (const [prefix, label, entries, describe] of groups) {
    for (const entry of entries) {
      const parts = describe(entry).filter(Boolean);
      const haystack = normalizeSearch([...parts, entry.id].join(' '));
      if (!terms.every(term => haystack.includes(term))) continue;
      count += 1;
      if (count > 20) continue;
      const item = element('li');
      const link = element('a', label + ' · ' + parts.join(' / '));
      link.href = '#' + prefix + '-' + entry.id;
      item.append(link);
      searchResults.append(item);
    }
  }
  setText('global-search-status', count ? (count > 20 ? '20 de ' + count + ' resultados' : count + (count === 1 ? ' resultado' : ' resultados')) : 'Nenhum resultado.');
}
function openGlobalSearch() {
  if (!searchDialog.open) searchDialog.showModal();
  renderGlobalSearch();
  searchQuery.select();
}
byId('global-search-open').addEventListener('click', openGlobalSearch);
byId('global-search-close').addEventListener('click', () => searchDialog.close());
searchQuery.addEventListener('input', renderGlobalSearch);
searchQuery.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== 'ArrowDown') return;
  const first = searchResults.querySelector('a, button');
  if (!first) return;
  event.preventDefault();
  if (event.key === 'Enter') first.click();
  else first.focus();
});
searchResults.addEventListener('click', event => {
  if (event.target.closest('button[data-command="refresh"]')) {
    searchDialog.close();
    void refresh();
    return;
  }
  const link = event.target.closest('a');
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  searchDialog.close();
  const target = byId(link.hash.slice(1));
  if (target) {
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
});
searchResults.addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  const controls = [...searchResults.querySelectorAll('a, button')];
  const index = controls.indexOf(event.target);
  if (index < 0) return;
  event.preventDefault();
  if (index === 0 && event.key === 'ArrowUp') searchQuery.focus();
  else controls[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
});
window.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
  event.preventDefault();
  openGlobalSearch();
});
byId('refresh-command').addEventListener('click', refresh);
byId('graph-refresh').addEventListener('click', () => {
  const objective = byId('graph-objective').value;
  if (objective) void loadGraph(objective);
});
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
function prepareNavLink(link) {
  const icon = link.querySelector('.nav-icon');
  icon.setAttribute('aria-hidden', 'true');
  const title = [...link.childNodes].filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent.trim()).join(' ').trim();
  link.title = title;
  link.replaceChildren(icon, element('span', title, 'nav-label'));
}
document.querySelectorAll('#command-navigation .nav-item').forEach(prepareNavLink);
const sidebarToggle = byId('sidebar-toggle');
function applySidebarCompact(compact) {
  document.documentElement.dataset.sidebarCompact = String(compact);
  sidebarToggle.setAttribute('aria-pressed', String(compact));
  sidebarToggle.title = compact ? 'Expandir barra lateral' : 'Recolher barra lateral';
  sidebarToggle.textContent = compact ? '»' : '«';
}
try { applySidebarCompact(localStorage.getItem('projeto-all.sidebar-compact') === 'true'); } catch {}
sidebarToggle.addEventListener('click', () => {
  const compact = sidebarToggle.getAttribute('aria-pressed') !== 'true';
  applySidebarCompact(compact);
  try { localStorage.setItem('projeto-all.sidebar-compact', String(compact)); } catch {}
});
highlightSection();
configureCoordinatorJobsPolling();
const displayKey = 'projeto-all.display';
const widgetTitles = {
  projects: 'Projetos', objectives: 'Objetivos', running: 'Tarefas em execução',
  sessions: 'Sessões observadas', checks: 'Verificações ativas', cpu: 'CPU do host',
};
const defaultWidgets = Object.keys(widgetTitles).map((id, index) => ({ id, visible: index < 4, wide: false }));
let displayWidgets = [];
function normalizeWidgets(widgets) {
  if (!Array.isArray(widgets)) return null;
  const seen = new Set();
  for (const widget of widgets) {
    if (typeof widget?.id !== 'string' || !Object.hasOwn(widgetTitles, widget.id) || seen.has(widget.id)
      || typeof widget.visible !== 'boolean' || typeof widget.wide !== 'boolean') return null;
    seen.add(widget.id);
  }
  return [...widgets, ...defaultWidgets.filter(widget => !seen.has(widget.id))];
}
function renderWidgetSettings() {
  const settings = byId('widget-settings-list');
  settings.replaceChildren(...displayWidgets.map((widget, index) => {
    const title = widgetTitles[widget.id];
    const row = element('div', undefined, 'widget-setting');
    const checkbox = (field, labelText) => {
      const label = element('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = widget[field];
      if (field === 'wide') input.setAttribute('aria-label', 'Aumentar largura de ' + title);
      input.addEventListener('change', () => {
        widget[field] = input.checked;
        saveDisplay();
        renderMetrics();
      });
      label.append(input, ' ' + labelText);
      return label;
    };
    row.append(checkbox('visible', title), checkbox('wide', 'Largo'));
    for (const [direction, symbol, label] of [[-1, '↑', 'Subir'], [1, '↓', 'Descer']]) {
      const button = element('button', symbol, 'button button-quiet');
      button.type = 'button';
      button.setAttribute('aria-label', label + ' ' + title);
      const target = index + direction;
      button.disabled = target < 0 || target >= displayWidgets.length;
      button.addEventListener('click', () => {
        [displayWidgets[index], displayWidgets[target]] = [displayWidgets[target], widget];
        saveDisplay();
        renderWidgetSettings();
        renderMetrics();
        const buttons = settings.children[target].querySelectorAll('button');
        const sameDirection = buttons[direction === -1 ? 0 : 1];
        (sameDirection.disabled ? buttons[direction === -1 ? 1 : 0] : sameDirection).focus();
      });
      row.append(button);
    }
    return row;
  }));
}
function applyWidgetSettings(values) {
  displayWidgets = (normalizeWidgets(values?.widgets) ?? defaultWidgets)
    .map(({ id, visible, wide }) => ({ id, visible, wide }));
  renderWidgetSettings();
}
const displayControls = ['theme', 'density', 'fontSize', 'sidebarWidth'].map(key => [key, byId(key)]);
const displayDefaults = Object.fromEntries(displayControls.map(([key, control]) => [key, control.value]));
const validDisplayValue = (control, value) => Array.from(control.options).some(option => option.value === value);
function applyDisplay(values) {
  for (const [key, control] of displayControls) {
    control.value = validDisplayValue(control, values?.[key]) ? values[key] : displayDefaults[key];
    document.documentElement.dataset[key] = control.value;
  }
}
function displaySnapshot() {
  return { ...Object.fromEntries(displayControls.map(([key, control]) => [key, control.value])), widgets: displayWidgets };
}
function validDisplaySnapshot(values) {
  return values && displayControls.every(([key, control]) =>
    (key === 'sidebarWidth' && !Object.hasOwn(values, key)) || validDisplayValue(control, values[key]))
    && (!Object.hasOwn(values, 'widgets') || normalizeWidgets(values.widgets));
}
function loadDisplaySnapshot(values, message) {
  applyDisplay(values);
  applyWidgetSettings(values);
  saveDisplay(message);
  renderMetrics();
}
function saveDisplay(message = 'Preferências salvas neste navegador.') {
  applyDisplay(displaySnapshot());
  try {
    localStorage.setItem(displayKey, JSON.stringify(displaySnapshot()));
    setText('display-feedback', message);
  } catch {
    setText('display-feedback', 'Preferências aplicadas nesta página. O navegador impediu o armazenamento.');
  }
}
try {
  const stored = localStorage.getItem(displayKey);
  const values = stored ? JSON.parse(stored) : {
    theme: localStorage.getItem('projeto-all.theme'),
    density: localStorage.getItem('projeto-all.density'),
  };
  applyDisplay(values);
  applyWidgetSettings(values);
} catch {
  applyDisplay(displayDefaults);
  applyWidgetSettings();
}
for (const [, control] of displayControls) control.addEventListener('change', () => saveDisplay());
byId('display-reset').addEventListener('click', () => {
  loadDisplaySnapshot(displayDefaults, 'Preferências padrão restauradas.');
});
byId('display-export').addEventListener('click', () => {
  const file = new Blob([JSON.stringify({ version: 1, ...displaySnapshot() }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'projeto-all-preferencias.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
byId('display-import').addEventListener('change', async event => {
  const input = event.currentTarget;
  const [file] = input.files;
  if (!file) return;
  input.value = '';
  try {
    if (file.size > 4096) throw new Error();
    const values = JSON.parse(await file.text());
    if (values?.version !== 1 || !validDisplaySnapshot(values)) throw new Error();
    loadDisplaySnapshot(values, 'Preferências importadas.');
  } catch {
    setText('display-feedback', 'Arquivo inválido. Selecione um JSON exportado pelas preferências.');
  }
});
const presetKey = 'projeto-all.display-presets';
const presetSelect = byId('display-preset');
let presets = [];
try {
  const stored = JSON.parse(localStorage.getItem(presetKey));
  if (Array.isArray(stored)) {
    presets = stored.filter(preset => typeof preset?.name === 'string' && preset.name.trim()
      && preset.name.length <= 60 && validDisplaySnapshot(preset.values)).slice(0, 20);
  }
} catch {}
function updatePresetControls() {
  const disabled = !presetSelect.value;
  byId('display-preset-apply').disabled = disabled;
  byId('display-preset-remove').disabled = disabled;
}
function renderPresets(selected = '') {
  presetSelect.replaceChildren(new Option(presets.length ? 'Selecione um preset' : 'Nenhum preset salvo', ''),
    ...presets.map(({ name }) => new Option(name, name)));
  presetSelect.value = selected;
  updatePresetControls();
}
function savePresets(next, message, selected) {
  try {
    localStorage.setItem(presetKey, JSON.stringify(next));
  } catch {
    setText('display-feedback', 'O navegador impediu o armazenamento do preset.');
    return false;
  }
  presets = next;
  renderPresets(selected);
  setText('display-feedback', message);
  return true;
}
renderPresets();
presetSelect.addEventListener('change', updatePresetControls);
byId('display-preset-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = byId('display-preset-name');
  const name = input.value.trim();
  if (!name || name.length > 60) return setText('display-feedback', 'Informe um nome de até 60 caracteres.');
  if (presets.some(preset => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    return setText('display-feedback', 'Já existe um preset com esse nome.');
  }
  if (presets.length >= 20) return setText('display-feedback', 'Exclua um preset antes de salvar outro. O limite é 20.');
  const values = structuredClone(displaySnapshot());
  if (savePresets([...presets, { name, values }], 'Preset salvo.', name)) input.value = '';
});
byId('display-preset-apply').addEventListener('click', () => {
  const preset = presets.find(item => item.name === presetSelect.value);
  if (preset) loadDisplaySnapshot(preset.values, 'Preset aplicado.');
});
byId('display-preset-remove').addEventListener('click', () => {
  if (presetSelect.value) savePresets(presets.filter(item => item.name !== presetSelect.value), 'Preset excluído.');
});
try {
  if (localStorage.getItem('projeto-all.task-view') === 'board') byId('task-view').value = 'board';
} catch {}
await refresh();
setInterval(refresh, 5000);
document.addEventListener('visibilitychange', refresh);
window.addEventListener('online', refresh);
window.addEventListener('pagehide', () => {
  clearInterval(previewReloadTimer);
  clearInterval(coordinatorJobsTimer);
  coordinatorJobsObserver?.disconnect();
});
