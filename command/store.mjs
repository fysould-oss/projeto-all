import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { draftPlan } from './plan.mjs';
import { prepareCommit, executeCommit } from './commit.mjs';
import { changeIndex } from './index.mjs';
import { preparePush, executePush } from './push.mjs';
import { normalizePreviewUrl } from './previews.mjs';

const STATES = new Set(['pending', 'running', 'blocked', 'review', 'done', 'failed', 'cancelled']);
const ACTIONS = new Set(['project.create', 'objective.create', 'objective.plan', 'task.create', 'task.state', 'preview.save']);
const APPROVAL_ACTIONS = new Set(['approval.request', 'approval.requestPush', 'approval.edit', 'approval.approve', 'approval.reject']);
const INDEX_ACTIONS = new Set(['git.stage', 'git.unstage']);
const APPROVAL_TTL_MS = 15 * 60 * 1000;

const now = () => new Date().toISOString();
const clone = value => structuredClone(value);
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
};
const id = value => typeof value === 'string' && value.length > 0 ? value : null;

function emptySnapshot() {
  return { version: 1, projects: [], objectives: [], tasks: [], approvals: [], previews: [], audit: [] };
}

function expired(approval) {
  return approval.state === 'pending' && Date.parse(approval.expiresAt) <= Date.now();
}

async function projectDirectory(value) {
  const projectPath = text(value, 'path');
  if (!isAbsolute(projectPath)) throw new TypeError('Informe o caminho absoluto da pasta.');
  const resolved = resolve(projectPath);
  try {
    const details = await stat(resolved);
    if (!details.isDirectory()) throw new TypeError('Informe uma pasta existente e acessível.');
    await access(resolved, constants.R_OK);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError('Informe uma pasta existente e acessível.');
  }
  return resolved;
}

export async function createStore(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new TypeError('store path must be absolute');
  const filename = resolve(path);
  await mkdir(dirname(filename), { recursive: true });
  let state = emptySnapshot();
  try {
    state = JSON.parse(await readFile(filename, 'utf8'));
    if (!state || typeof state !== 'object' || !Array.isArray(state.projects)
      || !Array.isArray(state.objectives) || !Array.isArray(state.tasks) || !Array.isArray(state.audit)) {
      throw new TypeError('invalid store snapshot');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await persist(state);
  }

  async function persist(next) {
    const temporary = `${filename}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    try { await rename(temporary, filename); } catch (error) {
      try { await import('node:fs/promises').then(fs => fs.rm(temporary, { force: true })); } catch { /* best effort */ }
      throw error;
    }
  }

  function audit(next, action, data, result) {
    next.audit.push({ id: randomUUID(), at: now(), action, result,
      fields: ['name', 'path', 'projectId', 'title', 'objectiveId', 'dependencies', 'id', 'state']
        .filter(field => Object.hasOwn(data, field)) });
  }

  state.approvals ??= [];
  state.previews ??= [];
  if (!Array.isArray(state.previews)) throw new TypeError('invalid previews snapshot');
  state.previews = state.previews.flatMap(preview => {
    if (!state.projects.some(project => project.id === preview?.projectId)) return [];
    try {
      return [{ ...preview, url: normalizePreviewUrl(preview.url) }];
    } catch {
      return [];
    }
  });
  if (!Array.isArray(state.approvals)) throw new TypeError('invalid approvals snapshot');
  const interrupted = state.approvals.filter(approval => approval.state === 'executing');
  for (const approval of interrupted) {
    approval.state = 'failed';
    approval.error = 'Execução interrompida. Confira o histórico Git e a branch de destino antes de repetir.';
    audit(state, 'approval.interrupted', {}, approval.id);
  }
  const interruptedChecks = state.tasks.filter(task => task.check?.status === 'running');
  for (const task of interruptedChecks) {
    task.state = 'failed';
    task.updatedAt = now();
    task.check.status = 'interrupted';
    audit(state, 'task.check.interrupted', {}, task.id);
  }
  if (interrupted.length || interruptedChecks.length) await persist(state);

  async function save(next, action, data, result) {
    audit(next, action, data, result.id);
    await persist(next);
    state = next;
    return clone(result);
  }

  async function mutateApproval(action, data, next) {
    let approval;
    const request = action === 'approval.request' || action === 'approval.requestPush';
    if (!request) {
      approval = next.approvals.find(item => item.id === data.id);
      if (!approval) throw new Error('Aprovação não encontrada.');
      if (approval.state !== 'pending' || expired(approval)) throw new Error('A aprovação já foi decidida ou expirou.');
      if (approval.revision !== data.revision) throw new Error('A solicitação mudou. Atualize e revise a nova versão.');
    }
    const project = next.projects.find(item => item.id === (approval?.projectId ?? data.projectId));
    if (!project) throw new Error('Projeto não encontrado.');

    if (request || action === 'approval.edit') {
      const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
      if (!reason || reason.length > 500) throw new Error('Informe um motivo de até 500 caracteres.');
      const push = action === 'approval.requestPush' || approval?.kind === 'git.push';
      const prepared = push
        ? (approval?.prepared ?? await preparePush(project, data.remote))
        : await prepareCommit(project, data.message);
      if (!approval) {
        approval = { id: randomUUID(), projectId: project.id, kind: push ? 'git.push' : 'git.commit', createdAt: now() };
        next.approvals.push(approval);
      }
      Object.assign(approval, {
        message: prepared.message, reason, paths: prepared.paths, branch: prepared.branch, base: prepared.head,
        prepared, state: 'pending', revision: randomUUID(),
        expiresAt: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
      });
      if (push) Object.assign(approval, {
        message: 'Push de branch', remote: prepared.remote, destination: prepared.destination,
        head: prepared.head, base: prepared.remoteHead ?? null,
      });
      return save(next, action, data, approval);
    }
    if (action === 'approval.reject') {
      approval.state = 'rejected';
      return save(next, action, data, approval);
    }

    approval.state = 'executing';
    await save(next, action, data, approval);
    const final = clone(state);
    const outcome = final.approvals.find(item => item.id === approval.id);
    try {
      outcome.commit = approval.kind === 'git.push'
        ? await executePush(project, approval.prepared)
        : await executeCommit(project, approval.prepared);
      outcome.state = 'completed';
    } catch (error) {
      outcome.state = 'failed';
      outcome.error = error.code ? 'Falha na execução Git. Confira o estado do repositório.' : error.message;
    }
    return save(final, 'approval.' + outcome.state, {}, outcome);
  }

  let queue = Promise.resolve();
  function serialize(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  async function beginTaskCheck(data, checks, scheduled) {
    const next = clone(state);
    const task = next.tasks.find(item => item.id === data?.id);
    if (!task) throw new Error('Tarefa não encontrada.');
    if (scheduled && task.scheduledScript !== data.script) return null;
    if (!['pending', 'failed'].includes(task.state)) throw new Error('A tarefa precisa estar pendente ou com falha.');
    if (task.dependencies.some(id => next.tasks.find(item => item.id === id)?.state !== 'done')) {
      throw new Error('Conclua as dependências antes de iniciar esta tarefa.');
    }
    const objective = next.objectives.find(item => item.id === task.objectiveId);
    const project = next.projects.find(item => item.id === objective?.projectId);
    if (!project) throw new Error('Projeto não encontrado.');
    const run = await checks.start(project, data.script);
    delete task.scheduledScript;
    task.state = 'running';
    task.updatedAt = now();
    task.check = { id: run.id, script: run.script, status: run.status, durationMs: run.durationMs };
    try {
      await save(next, 'task.check', data, task);
    } catch (error) {
      await checks.cancel(project, run.id);
      throw error;
    }
    return { project, run };
  }

  async function scheduleTask(data, checks) {
    const next = clone(state);
    const task = next.tasks.find(item => item.id === data?.id);
    if (!task || !['pending', 'failed'].includes(task.state)) throw new Error('Selecione uma tarefa pendente ou com falha.');
    if (data.script === null) {
      delete task.scheduledScript;
    } else {
      const objective = next.objectives.find(item => item.id === task.objectiveId);
      const project = next.projects.find(item => item.id === objective?.projectId);
      if (!project || !(await checks.available(project)).includes(data.script)) {
        throw new Error('O script não está configurado no projeto.');
      }
      task.scheduledScript = data.script;
    }
    task.updatedAt = now();
    return save(next, 'task.schedule', data, task);
  }

  async function failScheduledTask(id, script) {
    const next = clone(state);
    const task = next.tasks.find(item => item.id === id);
    if (task?.scheduledScript !== script || !['pending', 'failed'].includes(task.state)) return;
    if (task.dependencies.some(dependency => next.tasks.find(item => item.id === dependency)?.state !== 'done')) return;
    delete task.scheduledScript;
    task.state = 'failed';
    task.check = { script, status: 'failed', durationMs: null };
    task.updatedAt = now();
    await save(next, 'task.check.failed', {}, task);
  }

  async function finishTaskCheck(taskId, run) {
    if (!run) return;
    const next = clone(state);
    const task = next.tasks.find(item => item.id === taskId);
    if (task?.check?.id !== run.id || task.check.status !== 'running') return;
    task.check.status = run.status;
    task.check.durationMs = run.durationMs;
    task.state = run.status === 'passed' ? 'done' : run.status === 'cancelled' ? 'cancelled' : 'failed';
    task.updatedAt = now();
    await save(next, 'task.check.' + run.status, {}, task);
  }

  async function mutate(action, data = {}) {
    if (!ACTIONS.has(action) && !APPROVAL_ACTIONS.has(action) && !INDEX_ACTIONS.has(action)) throw new TypeError('Ação desconhecida.');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('Dados da ação inválidos.');
    const next = clone(state);
    if (APPROVAL_ACTIONS.has(action)) return mutateApproval(action, data, next);
    if (INDEX_ACTIONS.has(action)) {
      const project = next.projects.find(item => item.id === data.projectId);
      if (!project) throw new Error('Projeto não encontrado.');
      const files = await changeIndex(project, action, data.path);
      await save(next, action, data, project);
      return { files };
    }
    const timestamp = now();
    let result;
    if (action === 'project.create') {
      const name = text(data.name, 'name');
      const path = await projectDirectory(data.path);
      result = { id: randomUUID(), name, path, createdAt: timestamp };
      next.projects.push(result);
    } else if (action === 'preview.save') {
      const project = next.projects.find(item => item.id === data.projectId);
      if (!project) throw new Error('Projeto não encontrado.');
      result = { id: project.id, projectId: project.id, url: normalizePreviewUrl(data.url), updatedAt: timestamp };
      next.previews = next.previews.filter(item => item.projectId !== project.id);
      next.previews.push(result);
    } else if (action === 'objective.create') {
      const projectId = id(data.projectId);
      if (!projectId || !next.projects.some(item => item.id === projectId)) throw new Error('Projeto não encontrado.');
      result = { id: randomUUID(), projectId, title: text(data.title, 'title'), createdAt: timestamp };
      next.objectives.push(result);
    } else if (action === 'objective.plan') {
      const objective = next.objectives.find(item => item.id === data.id);
      if (!objective) throw new Error('Objetivo não encontrado.');
      if (next.tasks.some(task => task.objectiveId === objective.id)) {
        throw new Error('Este objetivo já tem tarefas.');
      }
      const plan = draftPlan(objective.title);
      if (!plan.length) throw new Error('Descreva as etapas pretendidas no objetivo.');
      const ids = plan.map(() => randomUUID());
      next.tasks.push(...plan.map((step, index) => ({
        id: ids[index], objectiveId: objective.id, title: step.title, role: step.role,
        modelTier: step.modelTier, dependencies: step.dependencies.map(dependency => ids[dependency]),
        state: 'pending', createdAt: timestamp, updatedAt: timestamp,
      })));
      result = objective;
    } else if (action === 'task.create') {
      const objectiveId = id(data.objectiveId);
      if (!objectiveId || !next.objectives.some(item => item.id === objectiveId)) throw new Error('Objetivo não encontrado.');
      const dependencies = data.dependencies === undefined ? [] : data.dependencies;
      if (!Array.isArray(dependencies) || dependencies.some(dep => !id(dep))) throw new TypeError('Selecione tarefas válidas como dependências.');
      if (new Set(dependencies).size !== dependencies.length) throw new TypeError('Selecione cada dependência uma única vez.');
      if (dependencies.some(dep => !next.tasks.some(item => item.id === dep))) throw new Error('Dependência não encontrada.');
      result = { id: randomUUID(), objectiveId, title: text(data.title, 'title'), dependencies: [...dependencies], state: 'pending', createdAt: timestamp, updatedAt: timestamp };
      next.tasks.push(result);
    } else {
      const taskId = id(data.id);
      const task = next.tasks.find(item => item.id === taskId);
      if (!task) throw new Error('Tarefa não encontrada.');
      if (task.check?.status === 'running') throw new Error('Interrompa a execução na seção Qualidade antes de alterar o estado.');
      if (!STATES.has(data.state)) throw new TypeError('Estado de tarefa inválido.');
      if (data.state === 'running') {
        if (task.dependencies.some(dependency => next.tasks.find(item => item.id === dependency)?.state !== 'done')) {
          throw new Error('Conclua as dependências antes de iniciar esta tarefa.');
        }
      }
      task.state = data.state;
      if (!['pending', 'failed'].includes(task.state)) delete task.scheduledScript;
      task.updatedAt = timestamp;
      result = task;
    }
    return save(next, action, data, result);
  }

  return {
    snapshot() {
      const snapshot = clone(state);
      snapshot.approvals = snapshot.approvals.map(({ prepared, ...approval }) => ({
        ...approval, state: expired(approval) ? 'expired' : approval.state,
      }));
      return snapshot;
    },
    approvalDiffContext(approvalId) {
      const approval = state.approvals.find(item => item.id === approvalId && item.kind === 'git.commit');
      const project = state.projects.find(item => item.id === approval?.projectId);
      return project && clone({ project, prepared: approval.prepared });
    },
    mutate(action, data) {
      return serialize(() => mutate(action, data));
    },
    beginTaskCheck(data, checks, scheduled = false) { return serialize(() => beginTaskCheck(data, checks, scheduled)); },
    finishTaskCheck(taskId, run) { return serialize(() => finishTaskCheck(taskId, run)); },
    scheduleTask(data, checks) { return serialize(() => scheduleTask(data, checks)); },
    failScheduledTask(id, script) { return serialize(() => failScheduledTask(id, script)); },
  };
}
