import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchAudit } from './audit-search.mjs';

test('matches related records without returning titles or stored payloads', () => {
  const projects = [{ id: 'project', name: 'Operação móvel' }];
  const objectives = [{ id: 'objective', projectId: 'project', title: 'Upgrade' }];
  const tasks = [{ id: 'task', objectiveId: 'objective', title: 'Validar tela' }];
  const audit = [
    { id: '1', action: 'project.create', result: 'project', secret: 'private' },
    { id: '2', action: 'task.check.passed', result: 'task', data: { prompt: 'private' } },
  ];
  const params = new URLSearchParams({ kind: 'check', q: 'OPERACAO MOVEL' });
  const result = searchAudit({ audit, projects, objectives, tasks }, params);
  assert.equal(result.total, 1);
  assert.deepEqual(result.entries, [{ id: '2', at: undefined, action: 'task.check.passed', result: 'task', fields: undefined }]);
  assert.doesNotMatch(JSON.stringify(result), /private|Validar tela|Upgrade/);
});

test('pages newest first and bounds input', () => {
  const audit = Array.from({ length: 120 }, (_, index) => ({ id: String(index), action: 'project.create', result: 'project' }));
  const result = searchAudit({ audit }, { limit: 500, offset: 10 });
  assert.equal(result.limit, 100);
  assert.equal(result.entries[0].id, '109');
  assert.equal(result.entries.at(-1).id, '10');
  assert.equal(result.total, 120);
  assert.equal(searchAudit({ audit }, new URLSearchParams()).limit, 25);
});
