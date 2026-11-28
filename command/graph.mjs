const NODE_LIMIT = 300;
const EDGE_LIMIT = 2500;

export function objectiveGraph(snapshot, objectiveId) {
  const objective = snapshot.objectives.find(item => item.id === objectiveId);
  if (!objective) return null;

  const allTasks = new Map(snapshot.tasks.map(task => [task.id, task]));
  const selected = new Map();
  let truncated = false;
  function include(task) {
    if (selected.has(task.id)) return;
    if (selected.size === NODE_LIMIT) {
      truncated = true;
      return;
    }
    selected.set(task.id, task);
  }

  for (const task of snapshot.tasks) {
    if (task.objectiveId === objectiveId) include(task);
  }
  for (const task of selected.values()) {
    for (const id of task.dependencies) {
      const dependency = allTasks.get(id);
      if (dependency) include(dependency);
    }
  }

  const edges = [];
  const missing = new Set();
  const outgoing = new Map([...selected.keys()].map(id => [id, []]));
  const pending = new Map();
  const layers = new Map();
  const readyForLayer = [];
  for (const task of selected.values()) {
    const dependencies = new Set(task.dependencies);
    pending.set(task.id, dependencies.size);
    if (!dependencies.size) readyForLayer.push(task.id);
    for (const id of dependencies) {
      if (!allTasks.has(id)) missing.add(id);
      if (!selected.has(id)) continue;
      if (edges.length === EDGE_LIMIT) {
        truncated = true;
        continue;
      }
      edges.push({ from: id, to: task.id });
      outgoing.get(id).push(task.id);
    }
  }

  const candidates = new Map();
  for (let index = 0; index < readyForLayer.length; index++) {
    const id = readyForLayer[index];
    const layer = candidates.get(id) ?? 0;
    layers.set(id, layer);
    for (const next of outgoing.get(id)) {
      candidates.set(next, Math.max(candidates.get(next) ?? 0, layer + 1));
      const remaining = pending.get(next) - 1;
      pending.set(next, remaining);
      if (!remaining) readyForLayer.push(next);
    }
  }

  const nodes = [...selected.values()].map(task => {
    const layer = layers.get(task.id) ?? null;
    const waitingOn = task.dependencies.filter(id => allTasks.get(id)?.state !== 'done');
    return {
      id: task.id, title: task.title, state: task.state, role: task.role, check: task.check,
      scheduledScript: task.scheduledScript,
      dependencies: task.dependencies, external: task.objectiveId !== objectiveId,
      waitingOn, layer, ready: task.state === 'pending' && layer !== null && !waitingOn.length,
    };
  });
  const local = nodes.filter(node => !node.external);
  const counts = {
    total: local.length,
    ready: local.filter(node => node.ready).length,
    waiting: local.filter(node => node.state === 'pending' && !node.ready).length,
    done: local.filter(node => node.state === 'done').length,
    external: nodes.length - local.length,
    unresolved: nodes.length - layers.size,
    missing: missing.size,
  };
  return { objective, nodes, edges, counts, truncated };
}
