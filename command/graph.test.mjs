import test from 'node:test';
import assert from 'node:assert/strict';
import { objectiveGraph } from './graph.mjs';

test('builds layers and readiness for an objective graph', () => {
  const snapshot = { objectives: [{ id: 'o1', title: 'Goal' }], tasks: [
    { id: 'a', objectiveId: 'o1', title: 'A', state: 'done', role: 'scan', dependencies: [] },
    { id: 'b', objectiveId: 'o1', title: 'B', state: 'pending', role: 'implementation', dependencies: ['a'] },
    { id: 'c', objectiveId: 'o1', title: 'C', state: 'pending', role: 'qa', dependencies: ['b'] },
  ] };
  const graph = objectiveGraph(snapshot, 'o1');
  assert.deepEqual(graph.edges, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]);
  assert.deepEqual(graph.nodes.map(node => [node.id, node.layer, node.ready]), [['a', 0, false], ['b', 1, true], ['c', 2, false]]);
});

test('includes external context and blocks missing or cyclic dependencies', () => {
  const snapshot = { objectives: [{ id: 'o1' }, { id: 'o2' }], tasks: [
    { id: 'a', objectiveId: 'o1', title: 'A', state: 'pending', dependencies: ['external', 'missing'] },
    { id: 'external', objectiveId: 'o2', title: 'External', state: 'done', dependencies: ['a'] },
  ] };
  const graph = objectiveGraph(snapshot, 'o1');
  assert.equal(graph.nodes.find(node => node.id === 'external').external, true);
  assert.equal(graph.nodes.find(node => node.id === 'a').ready, false);
  assert.ok(graph.counts.missing > 0);
  assert.equal(graph.counts.unresolved, 2);
  assert.equal(graph.counts.total, 1);
});

test('keeps independent tasks ready and bounds expansion', () => {
  const id = 'objective';
  const tasks = Array.from({ length: 310 }, (_, index) => ({
    id: String(index), objectiveId: id, title: String(index), state: 'pending',
    dependencies: index === 0 ? ['309'] : [],
  }));
  const graph = objectiveGraph({ objectives: [{ id }], tasks }, id);
  assert.equal(graph.truncated, true);
  assert.equal(graph.nodes.length, 300);
  assert.equal(graph.nodes[0].ready, false);
  assert.equal(graph.nodes[1].ready, true);
  assert.deepEqual(graph.edges, []);
  assert.equal(graph.counts.missing, 0);
});
