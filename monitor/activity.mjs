import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, normalize } from 'node:path';
import { createCodexReader } from './codex.mjs';
import { createCloudReader } from './cloud.mjs';
import { createWorkspaceMonitor } from './git.mjs';

const token = (value) => createHash('sha256').update(value).digest('hex').slice(0, 24);
const normalizeRoot = (root) => process.platform === 'win32' ? normalize(root).toLowerCase() : normalize(root);
const latestFirst = (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
const dedicatedTeams = new Map([
  ['contas', 'contas'], ['comunidade', 'comunidade'], ['integracoes', 'integracoes'],
  ['qualidade', 'qualidade'], ['qa', 'qualidade'], ['testes', 'qualidade'],
]);

export function createActivityMonitor() {
  const reader = createCodexReader({
    codexHome: process.env.PROJETO_ALL_CODEX_HOME || process.env.CODEX_HOME || join(homedir(), '.codex'),
  });
  const workspaces = createWorkspaceMonitor();
  const cloud = createCloudReader();
  let snapshot = { status: 'starting', projects: [] };
  let cloudProjects = [];
  let pending;
  let pendingCloud;
  let closed = false;

  async function refresh() {
    try {
      const threads = (await reader.scan()).filter(thread => isAbsolute(thread.cwd));
      if (closed) return;
      const byCwd = await workspaces.scan([...new Set(threads.map(thread => thread.cwd))]);
      const byRoot = new Map();
      for (const thread of threads.sort(latestFirst)) {
        const workspace = byCwd.get(thread.cwd);
        const root = workspace?.root || thread.cwd;
        const key = normalizeRoot(root);
        if (!byRoot.has(key)) {
          byRoot.set(key, {
            id: token(key),
            name: workspace?.name || basename(root) || 'Projeto local',
            branch: workspace?.branch ?? null,
            changes: workspace?.changes ?? null,
            lastChangeAt: workspace?.lastChangeAt ?? null,
            updatedAt: thread.updatedAt,
            isRepository: workspace?.isRepository ?? false,
            agents: [],
          });
        }
        const agentRole = thread.agentPath.split('/').at(-1);
        const name = thread.parentId ? (thread.name || (agentRole && agentRole !== 'root'
          ? agentRole[0].toUpperCase() + agentRole.slice(1).replaceAll(/[-_]/g, ' ')
          : 'Subagente ' + token(thread.id).slice(0, 4)))
          : 'Codex ' + token(thread.id).slice(0, 4);
        const project = byRoot.get(key);
        project.agents.push({
          id: token(thread.id),
          name,
          teamId: thread.parentId ? (dedicatedTeams.get(agentRole) || null) : 'produto',
          status: thread.status,
          task: thread.task,
          activity: thread.activity,
          updatedAt: thread.updatedAt,
          events: thread.events,
        });
      }
      snapshot = { status: 'connected', projects: [...byRoot.values()] };
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
    getSnapshot: () => ({ ...snapshot, projects: [...snapshot.projects, ...cloudProjects] }),
    close() {
      closed = true;
      clearInterval(timer);
      workspaces.close();
    },
  };
}
