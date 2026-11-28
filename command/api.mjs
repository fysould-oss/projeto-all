import { createStore } from './store.mjs';
import { inspectProject, resources } from './inspect.mjs';
import { draftPlan } from './plan.mjs';
import { createChecks } from './checks.mjs';
import { listFiles } from './index.mjs';
import { listRemotes } from './push.mjs';

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

export function createCommandApi(file, getActivity) {
  const checks = createChecks();
  let store;
  const open = () => store ??= createStore(file).catch(error => {
    store = undefined;
    throw error;
  });

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
          send(response, headers, 200, { run });
          return;
        }
        const result = await database.mutate(action, data);
        send(response, headers, 200, ['git.stage', 'git.unstage'].includes(action) ? result : database.snapshot());
      } catch (error) {
        const message = error.code ? 'Não foi possível gravar a ação.' : error.message;
        send(response, headers, 400, { error: message });
      }
      return;
    }
    const snapshot = database.snapshot();
    const kind = url.searchParams.get('view');
    if (kind === 'files' || kind === 'remotes') {
      const project = snapshot.projects.find(entry => entry.id === url.searchParams.get('project'));
      if (!project) {
        send(response, headers, 404, { error: 'Projeto não encontrado.' });
        return;
      }
      try {
        const result = kind === 'files' ? { files: await listFiles(project) } : { remotes: await listRemotes(project) };
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
        send(response, headers, 200, { scripts: await checks.available(project), runs: checks.list(project) });
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
      ...snapshot,
      observed: {
        status: activity.status,
        projects: activity.projects.length,
        sessions: activity.projects.reduce((count, project) => count + project.agents.length, 0),
      },
      resources: resources(),
    });
  };
  handle.close = () => checks.close();
  return handle;
}
