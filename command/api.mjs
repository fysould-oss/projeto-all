import { createStore } from './store.mjs';
import { inspectProject, resources } from './inspect.mjs';
import { draftPlan } from './plan.mjs';
import { createChecks } from './checks.mjs';
import { inspectChangedPath, listCommittedPaths, listFiles, readCommittedText } from './index.mjs';
import { githubPullRequests, listBranches, listRemotes, listTagsAndStashes } from './push.mjs';
import { objectiveGraph } from './graph.mjs';
import { readCoordinatorJobs } from './coordinator-status.mjs';
import { prepareCoordinatorDispatch } from './coordinator-dispatch.mjs';
import { readCoordinatorReview } from './coordinator-review.mjs';
import { cancelQueuedCoordinatorJob, cancelQueuedCoordinatorJobs } from './coordinator-cancel.mjs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

const json = { 'Content-Type': 'application/json; charset=utf-8' };

function send(response, headers, status, data) {
  response.writeHead(status, { ...headers, ...json }).end(JSON.stringify(data));
}

async function readAction(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new Error('Solicitação excede o tamanho permitido.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createCommandApi(file, getActivity, {
  coordinatorDirectory = process.env.PROJETO_ALL_COORDINATOR_HOME || join(homedir(), '.projeto-all', 'coordinator'),
  executorModule = process.env.PROJETO_ALL_EXECUTOR_MODULE,
} = {}) {
  const checks = createChecks();
  const taskChecks = new Set();
  let store;
  let draining;
  let pendingDrain = false;
  let closed = false;
  let executorTimer;
  let synchronizing;
  const dispatchEnabled = typeof executorModule === 'string' && isAbsolute(executorModule);
  const readReview = (id, project) => readCoordinatorReview(coordinatorDirectory, id, project);
  const open = () => store ??= createStore(file).catch(error => {
    store = undefined;
    throw error;
  });

  function synchronizeExecutor(database) {
    if (synchronizing) return synchronizing;
    const ids = database.snapshot().tasks.filter(task => ['queued', 'running'].includes(task.executor?.status))
      .map(task => task.executor.id);
    if (!ids.length) return Promise.resolve();
    synchronizing = readCoordinatorJobs(coordinatorDirectory, ids)
      .then(({ jobs }) => database.syncExecutorJobs(jobs))
      .catch(() => console.error('Não foi possível sincronizar os estados Codex.'))
      .finally(() => { synchronizing = undefined; });
    return synchronizing;
  }

  function followRun(project, run, complete) {
    const completion = checks.wait(project, run.id)
      .then(complete)
      .catch(() => console.error('Não foi possível registrar o resultado da tarefa.'))
      .finally(() => {
        taskChecks.delete(completion);
        scheduleDrain();
      });
    taskChecks.add(completion);
  }

  function scheduleDrain() {
    if (closed) return;
    pendingDrain = true;
    if (draining) return;
    draining = drain().catch(() => console.error('Não foi possível atualizar a fila de verificações.'))
      .finally(() => {
        draining = undefined;
        if (pendingDrain) scheduleDrain();
      });
  }

  async function drain() {
    pendingDrain = false;
    const database = await open();
    do {
      pendingDrain = false;
      while (!closed && checks.availableSlots()) {
        const { tasks, objectives } = database.snapshot();
        const byId = new Map(tasks.map(task => [task.id, task]));
        const active = new Set(objectives.filter(objective => !objective.status || objective.status === 'active').map(objective => objective.id));
        const task = tasks.find(item => item.scheduledScript && ['pending', 'failed'].includes(item.state)
          && active.has(item.objectiveId)
          && item.dependencies.every(id => byId.get(id)?.state === 'done'));
        if (!task) break;
        const script = task.scheduledScript;
        try {
          const result = await database.beginTaskCheck({ id: task.id, script }, checks, true);
          if (result) followRun(result.project, result.run, run => database.finishTaskCheck(task.id, run));
        } catch (error) {
          if (error.code === 'CHECK_CAPACITY') break;
          if (error.code) throw error;
          await database.failScheduledTask(task.id, script);
        }
      }
    } while (pendingDrain && !closed);
  }

  const handle = async (request, response, headers) => {
    const method = request.method;
    const origin = 'http://' + request.headers.host;
    if (['cross-site', 'same-site'].includes(request.headers['sec-fetch-site'])
      || (request.headers.origin && request.headers.origin !== origin)
      || (method === 'POST' && request.headers.origin !== origin)) {
      send(response, headers, 403, { error: 'Origem não autorizada.' });
      return;
    }
    if (!['GET', 'POST'].includes(method)) {
      send(response, { ...headers, Allow: 'GET, POST' }, 405, { error: 'Método indisponível.' });
      return;
    }
    let database;
    try {
      database = await open();
    } catch {
      send(response, headers, 503, { error: 'Armazenamento local indisponível.' });
      return;
    }
    const url = new URL(origin + request.url);
    if (method === 'POST') {
      if (request.headers['content-type'] !== 'application/json' || url.search) {
        send(response, headers, 415, { error: 'Envie uma ação em JSON.' });
        return;
      }
      try {
        const { action, data } = await readAction(request);
        if (action === 'task.executor.cancel') {
          await synchronizeExecutor(database);
          try {
            await database.cancelExecutorTask(data, id => cancelQueuedCoordinatorJob(coordinatorDirectory, id));
          } catch (error) {
            await synchronizeExecutor(database);
            throw error;
          }
          send(response, headers, 200, database.snapshot());
          return;
        }
        if (action === 'task.dispatch') {
          if (!dispatchEnabled) {
            send(response, headers, 503, { error: 'Configure o módulo do executor Codex no servidor.' });
            return;
          }
          await synchronizeExecutor(database);
          await database.dispatchTask(data, (project, instruction) =>
            prepareCoordinatorDispatch({ directory: coordinatorDirectory, executorModule, project, instruction }));
          send(response, headers, 200, database.snapshot());
          return;
        }
        if (action === 'objective.control') {
          if (data?.control === 'cancel') await synchronizeExecutor(database);
          const { project, runIds } = await database.controlObjective(data, ids => cancelQueuedCoordinatorJobs(coordinatorDirectory, ids));
          await Promise.all(runIds.map(id => checks.cancel(project, id)));
          send(response, headers, 200, database.snapshot());
          scheduleDrain();
          return;
        }
        if (action === 'task.schedule') {
          await database.scheduleTask(data, checks);
          send(response, headers, 200, database.snapshot());
          scheduleDrain();
          return;
        }
        if (action === 'task.check') {
          const { project, run } = await database.beginTaskCheck(data, checks);
          followRun(project, run, result => database.finishTaskCheck(data.id, result));
          send(response, headers, 200, database.snapshot());
          return;
        }
        if (['check.start', 'check.cancel'].includes(action)) {
          const project = database.snapshot().projects.find(entry => entry.id === data?.projectId);
          if (!project) {
            send(response, headers, 404, { error: 'Projeto não encontrado.' });
            return;
          }
          const run = action === 'check.start'
            ? await checks.start(project, data.script)
            : await checks.cancel(project, data.id);
          if (!run) {
            send(response, headers, 404, { error: 'Execução não encontrada.' });
            return;
          }
          if (action === 'check.start') followRun(project, run, result => database.recordCheck(project.id, result));
          send(response, headers, 200, { run });
          return;
        }
        const result = await database.mutate(action, data, readReview);
        send(response, headers, 200, ['git.stage', 'git.unstage'].includes(action) ? result : database.snapshot());
        if (action === 'task.state') scheduleDrain();
      } catch (error) {
        const message = error.code && error.code !== 'CHECK_CAPACITY' ? 'Não foi possível gravar a ação.' : error.message;
        send(response, headers, 400, { error: message });
      }
      return;
    }
    const kind = url.searchParams.get('view');
    if (kind === 'audit') {
      send(response, headers, 200, database.searchAudit(url.searchParams));
      return;
    }
    if (!kind || ['graph', 'coordinator-jobs', 'executor-review'].includes(kind)) await synchronizeExecutor(database);
    const snapshot = database.snapshot();
    if (kind === 'executor-review') {
      const context = database.executorReviewContext(url.searchParams.get('task'));
      if (!context) {
        send(response, headers, 404, { error: 'Nenhuma execução Codex disponível para revisão.' });
        return;
      }
      try {
        const review = await readReview(context.jobId, context.project);
        send(response, headers, 200, review);
      } catch {
        send(response, headers, 422, { error: 'A worktree de revisão está indisponível ou excede o limite de leitura.' });
      }
      return;
    }
    if (kind === 'coordinator-jobs') {
      const result = await readCoordinatorJobs(coordinatorDirectory);
      send(response, headers, 200, { ...result, dispatchEnabled });
      return;
    }
    if (kind === 'graph') {
      const graph = objectiveGraph(snapshot, url.searchParams.get('objective'));
      if (!graph) {
        send(response, headers, 404, { error: 'Objetivo não encontrado.' });
        return;
      }
      send(response, headers, 200, graph);
      return;
    }
    if (['files', 'file-diff', 'remotes', 'branches', 'saved-refs', 'committed-paths', 'committed-text', 'github-pulls'].includes(kind)) {
      const project = snapshot.projects.find(entry => entry.id === url.searchParams.get('project'));
      if (!project) {
        send(response, headers, 404, { error: 'Projeto não encontrado.' });
        return;
      }
      try {
        const result = kind === 'github-pulls' ? await githubPullRequests(project)
          : kind === 'branches' ? await listBranches(project)
          : kind === 'saved-refs' ? await listTagsAndStashes(project)
          : kind === 'file-diff' ? await inspectChangedPath(project, url.searchParams.get('path'), url.searchParams.get('mode'))
          : kind === 'committed-text' ? await readCommittedText(project, {
            path: url.searchParams.get('path'), revision: url.searchParams.get('revision'),
          })
          : kind === 'committed-paths' ? await listCommittedPaths(project, {
            query: url.searchParams.get('q') ?? '',
            offset: Number(url.searchParams.get('offset') ?? 0),
            revision: url.searchParams.get('revision') ?? '',
          })
          : kind === 'files' ? { files: await listFiles(project) } : { remotes: await listRemotes(project) };
        send(response, headers, 200, result);
      } catch (error) {
        send(response, headers, 422, { error: error.code ? 'Não foi possível consultar o projeto Git.' : error.message });
      }
      return;
    }
    if (kind === 'approval-diff') {
      const context = database.approvalDiffContext(url.searchParams.get('approval'));
      if (!context) {
        send(response, headers, 404, { error: 'Aprovação não encontrada.' });
        return;
      }
      try {
        send(response, headers, 200, await inspectProject(context.project, kind, context.prepared));
      } catch {
        send(response, headers, 422, { error: 'O diff aprovado está indisponível ou excede 256 KiB.' });
      }
      return;
    }
    if (kind === 'checks') {
      const project = snapshot.projects.find(entry => entry.id === url.searchParams.get('project'));
      if (!project) {
        send(response, headers, 404, { error: 'Projeto não encontrado.' });
        return;
      }
      try {
        const runs = new Map(database.checkHistory(project.id).map(run => [run.id, run]));
        for (const run of checks.list(project)) runs.set(run.id, run);
        const recent = [...runs.values()].sort((left, right) => (right.startedAt || '').localeCompare(left.startedAt || ''));
        send(response, headers, 200, { scripts: await checks.available(project), runs: recent });
      } catch {
        send(response, headers, 422, { error: 'Não foi possível ler os scripts do projeto.' });
      }
      return;
    }
    if (kind === 'plan') {
      const objective = snapshot.objectives.find(entry => entry.id === url.searchParams.get('objective'));
      if (!objective) {
        send(response, headers, 404, { error: 'Objetivo não encontrado.' });
        return;
      }
      send(response, headers, 200, { steps: draftPlan(objective.title) });
      return;
    }
    if (['status', 'diff', 'staged', 'check'].includes(kind)) {
      const project = snapshot.projects.find(entry => entry.id === url.searchParams.get('project'));
      if (!project) {
        send(response, headers, 404, { error: 'Projeto não encontrado.' });
        return;
      }
      try {
        send(response, headers, 200, await inspectProject(project, kind));
      } catch {
        send(response, headers, 422, { error: 'Git indisponível ou saída maior que o limite de 256 KiB.' });
      }
      return;
    }
    const activity = getActivity();
    send(response, headers, 200, {
      ...snapshot, dispatchEnabled,
      observed: {
        status: activity.status,
        projects: activity.projects.length,
        sessions: activity.projects.reduce((count, project) => count + project.agents.length, 0),
      },
      resources: resources(checks.activeCount()),
    });
  };
  handle.start = () => {
    scheduleDrain();
    if (dispatchEnabled && !executorTimer) {
      executorTimer = setInterval(() => {
        void open().then(synchronizeExecutor).catch(() => {});
      }, 5000);
      executorTimer.unref();
    }
  };
  handle.close = async () => {
    closed = true;
    clearInterval(executorTimer);
    await synchronizing;
    await draining;
    await checks.close();
    await Promise.all(taskChecks);
  };
  return handle;
}
