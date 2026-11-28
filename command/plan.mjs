const ACTION_WORDS = [
  'analisar', 'auditar', 'conferir', 'configurar', 'corrigir', 'criar',
  'definir', 'desenvolver', 'documentar', 'entregar', 'escrever', 'explorar',
  'gerar', 'implementar', 'integrar', 'investigar', 'mapear', 'modelar',
  'planejar', 'publicar', 'refatorar', 'revisar', 'testar', 'validar',
  'verificar', 'levantar', 'pesquisar', 'construir', 'deploy', 'homologar',
];

const SCAN = /\b(pesquis|investig|analis|explor|levant|map[eá]ar|descob|requisit|auditor|inspec|consult)\w*/i;
const QA = /\b(test|valid|homolog|qualidade|cobertura|lint|smoke|regress|aceita[cç][aã]o)\w*/i;
const DELIVERY = /\b(public|entreg|deploy|release|lan[cç]|document|changelog|disponibil|produ[cç][aã]o)\w*/i;
const IMPLEMENT = /\b(implement|desenvolv|constru|cri(e|ar)|corrig|alter|editar|refator|integr|configur|codific|program|migr|adicionar|escrev)\w*/i;
const ADVANCED = /\b(arquitet|seguran[cç]|migra[cç]|infra|distribu|concorr|performance|escala|integra[cç][aã]o|protocolo|banco de dados)\b/i;

function fold(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function hasAction(value) {
  const text = fold(value);
  // Include common Portuguese inflections ("analise", "teste", etc.).
  return ACTION_WORDS.some((word) => text.includes(word.slice(0, -1)))
    || /\b(analis\w*|test\w*|publi\w*|integr\w*|melhor\w*)\b/.test(text);
}

// "e" separates actions, but not ordinary noun lists ("API e banco").
function splitConjunction(value) {
  const pieces = value.split(/\s+e\s+(?=(?:test\w*|valid\w*|publi\w*|integr\w*|melhor\w*))/i);
  if (pieces.length < 2) return pieces;
  const result = [];
  let current = pieces[0];
  for (let index = 1; index < pieces.length; index += 1) {
    const next = pieces[index];
    const nextIsAction = hasAction(next)
      || /^(test\w*|valid\w*|publi\w*|integr\w*|melhor(e|ou|em)\b)/.test(fold(next).trim());
    const currentIsAction = hasAction(current)
      || /^(test\w*|valid\w*|publi\w*|integr\w*|melhor(e|ou|em)\b)/.test(fold(current).trim());
    if (currentIsAction && nextIsAction) {
      result.push(current);
      current = next;
    } else {
      current += ` e ${next}`;
    }
  }
  result.push(current);
  return result;
}

function extractSteps(title) {
  const source = typeof title === 'string' ? title : '';
  const coarse = source.split(/[\r\n;]+/);
  const steps = [];
  for (const line of coarse) {
    // Commas are explicit only when they introduce another action. This keeps
    // phrases such as "API, banco de dados e assinaturas" together.
    const commaParts = line.split(/\s*,\s*/);
    const parts = commaParts.length > 1 && commaParts.every(hasAction)
      ? commaParts
      : [line];
    for (const part of parts) steps.push(...splitConjunction(part));
  }
  const seen = new Set();
  return steps.map((step) => step.trim().replace(/^[\-•\d.)]+\s*/, '').replace(/\s+/g, ' '))
    .filter((step) => step && !seen.has(fold(step)) && seen.add(fold(step)));
}

function roleFor(title) {
  const normalized = fold(title).trim();
  // The imperative/verb at the beginning wins over repository or product
  // labels later in the sentence (for example, "sisc-test").
  const leading = normalized.slice(0, 36);
  if (/^(test\w*|valid\w*|homolog\w*|verific\w*)\b/.test(leading)) return 'qa';
  if (/^(publi\w*|entreg\w*|deploy\b|release\b|lanc\w*)/.test(leading)) return 'delivery';
  if (/^(pesquis\w*|investig\w*|analis\w*|explor\w*|levant\w*|map\w*|descobr\w*)/.test(leading)) return 'scan';
  if (/^(implement\w*|desenvolv\w*|constru\w*|cri\w*|corrig\w*|alter\w*|refator\w*|integr\w*|configur\w*|migr\w*|adicion\w*|melhor(e|ou|em)\b)/.test(leading)) return 'implementation';
  if (QA.test(title)) return 'qa';
  if (DELIVERY.test(title)) return 'delivery';
  if (SCAN.test(title)) return 'scan';
  if (IMPLEMENT.test(title)) return 'implementation';
  return 'coordination';
}

function modelTierFor(title, role) {
  if (ADVANCED.test(title)) return 'advanced';
  if (role === 'scan' || role === 'qa' || role === 'delivery') return 'economy';
  if (role === 'coordination') return 'economy';
  return 'balanced';
}

/**
 * Make a deterministic, deliberately conservative draft from an objective.
 * No work is invented: a generic objective produces one coordination item.
 */
export function draftPlan(title) {
  const steps = extractSteps(title);
  const plan = steps.map((step) => ({
    title: step,
    role: roleFor(step),
    modelTier: modelTierFor(step, roleFor(step)),
    dependencies: [],
  }));

  const scans = plan.flatMap((item, index) => item.role === 'scan' ? [index] : []);
  const implementations = plan.flatMap((item, index) => item.role === 'implementation' ? [index] : []);
  const tests = plan.flatMap((item, index) => item.role === 'qa' ? [index] : []);
  for (const [index, item] of plan.entries()) {
    if (item.role === 'implementation') item.dependencies.push(...scans.filter((scan) => scan !== index));
    if (item.role === 'qa') item.dependencies.push(...implementations.filter((implementation) => implementation !== index));
    if (item.role === 'delivery') item.dependencies.push(...tests.filter((test) => test !== index));
    item.dependencies.sort((a, b) => a - b);
  }
  return plan;
}

export default draftPlan;
