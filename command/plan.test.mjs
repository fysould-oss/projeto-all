import test from 'node:test';
import assert from 'node:assert/strict';
import { draftPlan } from './plan.mjs';

test('keeps a generic objective as one conservative item', () => {
  assert.deepEqual(draftPlan('Melhorar o painel'), [{
    title: 'Melhorar o painel', role: 'coordination', modelTier: 'economy', dependencies: [],
  }]);
});

test('extracts explicit Portuguese steps and infers ordered dependencies', () => {
  assert.deepEqual(draftPlan('Pesquisar requisitos; implementar API e testar fluxo; publicar'), [
    { title: 'Pesquisar requisitos', role: 'scan', modelTier: 'economy', dependencies: [] },
    { title: 'implementar API', role: 'implementation', modelTier: 'balanced', dependencies: [0] },
    { title: 'testar fluxo', role: 'qa', modelTier: 'economy', dependencies: [1] },
    { title: 'publicar', role: 'delivery', modelTier: 'economy', dependencies: [2] },
  ]);
});

test('does not split a noun list at e or invent scan and QA work', () => {
  assert.equal(draftPlan('Configurar API e banco de dados').length, 1);
  assert.equal(draftPlan('Configurar API e banco de dados')[0].title, 'Configurar API e banco de dados');
});

test('deduplicates steps and marks complex work advanced', () => {
  const plan = draftPlan('Mapear segurança; implementar migração de banco de dados; implementar migração de banco de dados');
  assert.equal(plan.length, 2);
  assert.equal(plan[1].modelTier, 'advanced');
  assert.deepEqual(plan[1].dependencies, [0]);
});

test('uses the leading action instead of repository labels when classifying', () => {
  const plan = draftPlan('Analise o sisc-test, melhore o mobile, integre o Mercado Pago, teste tudo e publique.');
  assert.deepEqual(plan.map(({ title, role }) => ({ title, role })), [
    { title: 'Analise o sisc-test', role: 'scan' },
    { title: 'melhore o mobile', role: 'implementation' },
    { title: 'integre o Mercado Pago', role: 'implementation' },
    { title: 'teste tudo', role: 'qa' },
    { title: 'publique.', role: 'delivery' },
  ]);
});
