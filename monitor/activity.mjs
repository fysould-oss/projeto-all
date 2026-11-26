import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { remoteSettings, isRemoteEligible } from './remote.mjs';
import { createCodexReader } from './codex.mjs';
import { createCloudReader } from './cloud.mjs';
import { createWorkspaceMonitor } from './git.mjs';

const token = (value) => createHash('sha256').update(value).digest('hex').slice(0, 24);
const normalizeRoot = (root) => process.platform === 'win32' ? normalize(root).toLowerCase() : normalize(root);
const latestFirst = (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
const dedicatedRoles = new Map([
  ['contas', 'contas'], ['comunidade', 'comunidade'], ['integracoes', 'integracoes'],
  ['qualidade', 'qualidade'], ['qa', 'qualidade'], ['testes', 'qualidade'],
]);
const projectDirectory = fileURLToPath(new URL('../../', import.meta.url));
const pinnedProjects = JSON.parse(readFileSync(new URL('../dist/projects.json', import.meta.url), 'utf8'))
  .map(({ directories, ...project }) => ({ ...project, cwds: directories.map(directory => join(projectDirectory, directory)) }));
const pinnedByName = new Map(pinnedProjects.flatMap(project => {
  const slug = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/?$/i.exec(project.remoteUrl)?.[1];
  return [[project.name.toLowerCase(), project.id], ...(slug ? [[slug.toLowerCase(), project.id]] : [])];
}));

function workspaceMetadata(workspace) {
  return {
    branch: workspace?.branch ?? null,
    changes: workspace?.changes ?? null,
    lastChangeAt: workspace?.lastChangeAt ?? null,
    isRepository: workspace?.isRepository ?? false,
    available: workspace?.available === true,
  };
}

function pinnedProject({ id, name, remoteUrl }, workspace) {
  return {
    id, name, remoteUrl, pinned: true, source: 'local', available: workspace?.available === true,
    ...workspaceMetadata(workspace), updatedAt: null, agents: [],
  };
}

function combineCloudProjects(projects, cloudProjects) {
  const byId = new Map(projects.map(project => [project.id, project]));
  for (const cloud of cloudProjects) {
    const local = byId.get(pinnedByName.get(cloud.name.trim().toLowerCase()));
    if (!local) {
      byId.set(cloud.id, { ...cloud, source: 'cloud' });
      continue;
    }
    byId.set(local.id, {
      ...local,
      source: local.source === 'local' && cloud.source === 'cloud' ? 'mixed' : local.source,
      agents: [...local.agents, ...cloud.agents].sort(latestFirst),
      updatedAt: [local.updatedAt, cloud.updatedAt].filter(Boolean).sort().at(-1) ?? null,
    });
  }
  return [...byId.values()];
}

export function createActivityMonitor() {
  const remote = remoteSettings();
  const reader = createCodexReader({
    codexHome: process.env.PROJETO_ALL_CODEX_HOME || process.env.CODEX_HOME || join(homedir(), '.codex'),
  });
  const workspaces = createWorkspaceMonitor();
  const cloud = createCloudReader();
  let snapshot = { status: 'starting', projects: pinnedProjects.map(project => pinnedProject(project)) };
  let cloudProjects = [];
  let pending;
  let pendingCloud;
  let closed = false;
  let lastSignalAt = null;

  async function refresh() {
    try {
      const threads = (await reader.scan()).filter(thread => isAbsolute(thread.cwd));
      if (closed) return;
      const byCwd = await workspaces.scan([...new Set([
        ...pinnedProjects.flatMap(project => project.cwds), ...threads.map(thread => thread.cwd),
      ])]);
      if (closed) return;
      const byRoot = new Map();
      const projects = pinnedProjects.map(definition => {
        const candidates = definition.cwds.map(cwd => byCwd.get(cwd)).filter(Boolean);
        const repository = candidates.find(workspace => workspace.isRepository);
        const project = pinnedProject(definition, repository || candidates.find(workspace => workspace.available));
        project.available = candidates.some(workspace => workspace.available === true);
        project.isRepository = Boolean(repository);
        for (const workspace of candidates) byRoot.set(normalizeRoot(workspace.root), project);
        return project;
      });
      for (const thread of threads.sort(latestFirst)) {
        const workspace = byCwd.get(thread.cwd);
        const root = workspace?.root || thread.cwd;
        const key = normalizeRoot(root);
        let project = byRoot.get(key);
        if (!project) {
          project = {
            id: token(key),
            name: workspace?.name || basename(root) || 'Projeto local',
            source: 'local',
            available: workspace?.available !== false,
            ...workspaceMetadata(workspace),
            updatedAt: thread.updatedAt,
            agents: [],
          };
          byRoot.set(key, project);
          projects.push(project);
        }
        project.updatedAt ??= thread.updatedAt;
        const pathRole = thread.agentPath.split('/').at(-1);
        const roleId = thread.parentId
          ? dedicatedRoles.get(thread.agentRole.toLowerCase()) ?? dedicatedRoles.get(pathRole.toLowerCase())
          : 'coordenacao';
        const name = thread.parentId ? (thread.name || (pathRole && pathRole !== 'root'
          ? pathRole[0].toUpperCase() + pathRole.slice(1).replaceAll(/[-_]/g, ' ')
          : 'Subagente ' + token(thread.id).slice(0, 4)))
          : 'Codex ' + token(thread.id).slice(0, 4);
        project.agents.push({
          id: token(thread.id),
          remoteEligible: isRemoteEligible(thread, remote),
          name,
          teamId: roleId === 'coordenacao' ? 'produto' : roleId ?? null,
          ...(roleId ? { roleId } : {}),
          status: thread.status,
          task: thread.task,
          activity: thread.activity,
          updatedAt: thread.updatedAt,
          events: thread.events,
          chat: thread.chat,
          source: 'local',
        });
      }
      lastSignalAt = new Date().toISOString();
      snapshot = { status: 'connected', projects, receivedAt: lastSignalAt };
    } catch {
      snapshot = { ...snapshot, status: 'unavailable' };
    }
  }

  function scheduleRefresh() {
    if (!pending) pending = refresh().finally(() => { pending = undefined; });
    if (!pendingCloud) {
      pendingCloud = cloud.scan().then(projects => {
        cloudProjects = projects.map(project => ({ ...project, source: 'cloud' }));
      }).catch(() => {}).finally(() => { pendingCloud = undefined; });
    }
  }

  scheduleRefresh();
  const timer = setInterval(scheduleRefresh, 2200);
  timer.unref();
  return {
    getSnapshot: () => ({
      ...snapshot,
      receivedAt: lastSignalAt,
      projects: combineCloudProjects(snapshot.projects, cloudProjects),
    }),
    close() {
      closed = true;
      clearInterval(timer);
      workspaces.close();
    },
  };
}
