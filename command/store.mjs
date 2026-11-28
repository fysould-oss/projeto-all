import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

const STATES = new Set(['pending', 'running', 'blocked', 'review', 'done', 'failed', 'cancelled']);
const ACTIONS = new Set(['project.create', 'objective.create', 'task.create', 'task.state']);

const now = () => new Date().toISOString();
const clone = value => structuredClone(value);
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
};
const id = value => typeof value === 'string' && value.length > 0 ? value : null;

function emptySnapshot() {
  return { version: 1, projects: [], objectives: [], tasks: [], audit: [] };
}

async function projectDirectory(value) {
  const projectPath = text(value, 'path');
  if (!isAbsolute(projectPath)) throw new TypeError('Informe o caminho absoluto da pasta.');
  const resolved = resolve(projectPath);
  try {
    const details = await stat(resolved);
    if (!details.isDirectory()) throw new TypeError('Informe uma pasta existente e acess?vel.');
    await access(resolved, constants.R_OK);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError('Informe uma pasta existente e acess?vel.');
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

  let queue = Promise.resolve();

  async function mutate(action, data = {}) {
    if (!ACTIONS.has(action)) throw new TypeError('A??o desconhecida.');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('Dados da a??o inv?lidos.');
    const next = clone(state);
    const timestamp = now();
    let result;
    if (action === 'project.create') {
      const name = text(data.name, 'name');
      const path = await projectDirectory(data.path);
      result = { id: randomUUID(), name, path, createdAt: timestamp };
      next.projects.push(result);
    } else if (action === 'objective.create') {
      const projectId = id(data.projectId);
      if (!projectId || !next.projects.some(item => item.id === projectId)) throw new Error('Projeto n?o encontrado.');
      result = { id: randomUUID(), projectId, title: text(data.title, 'title'), createdAt: timestamp };
      next.objectives.push(result);
    } else if (action === 'task.create') {
      const objectiveId = id(data.objectiveId);
      if (!objectiveId || !next.objectives.some(item => item.id === objectiveId)) throw new Error('Objetivo n?o encontrado.');
      const dependencies = data.dependencies === undefined ? [] : data.dependencies;
      if (!Array.isArray(dependencies) || dependencies.some(dep => !id(dep))) throw new TypeError('Selecione tarefas v?lidas como depend?ncias.');
      if (new Set(dependencies).size !== dependencies.length) throw new TypeError('Selecione cada depend?ncia uma ?nica vez.');
      if (dependencies.some(dep => !next.tasks.some(item => item.id === dep))) throw new Error('Depend?ncia n?o encontrada.');
      result = { id: randomUUID(), objectiveId, title: text(data.title, 'title'), dependencies: [...dependencies], state: 'pending', createdAt: timestamp, updatedAt: timestamp };
      next.tasks.push(result);
    } else {
      const taskId = id(data.id);
      const task = next.tasks.find(item => item.id === taskId);
      if (!task) throw new Error('Tarefa n?o encontrada.');
      if (!STATES.has(data.state)) throw new TypeError('Estado de tarefa inv?lido.');
      if (data.state === 'running') {
        const deps = next.tasks.filter(item => task.dependencies.includes(item.id));
        if (deps.some(item => item.state !== 'done')) throw new Error('Conclua as depend?ncias antes de iniciar esta tarefa.');
      }
      task.state = data.state;
      task.updatedAt = timestamp;
      result = task;
    }
    audit(next, action, data, result.id);
    await persist(next);
    state = next;
    return clone(result);
  }

  return {
    snapshot() { return clone(state); },
    mutate(action, data) {
      const result = queue.then(() => mutate(action, data));
      queue = result.catch(() => {});
      return result;
    },
  };
}
