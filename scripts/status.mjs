import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';

const [id, status, task, activity] = process.argv.slice(2);
const states = ['disponivel', 'a-fazer', 'em-andamento', 'bloqueado', 'concluido'];
const taskText = task?.trim() ?? '';
const activityText = activity?.trim() ?? '';
if (!id || !states.includes(status) || (status !== 'disponivel' && (!taskText || !activityText))) {
  console.error('Uso: node scripts/status.mjs <agente> <status> "<tarefa>" "<atividade>"');
  console.error('Tarefa e atividade são opcionais para o estado disponivel.');
  console.error('Estados: ' + states.join(', '));
  process.exit(1);
}

const record = new URL('../dist/progress.json', import.meta.url);
const snapshot = JSON.parse(await readFile(record, 'utf8'));
const agent = snapshot.agents.find(entry => entry.id === id);
if (!agent) {
  console.error('Agentes disponíveis: ' + snapshot.agents.map(entry => entry.id).join(', '));
  process.exit(1);
}

Object.assign(agent, { status, task: taskText, activity: activityText, updatedAt: new Date().toISOString() });
const temporary = new URL('./.' + randomUUID() + '.tmp', record);
try {
  await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
  await rename(temporary, record);
} finally {
  await rm(temporary, { force: true });
}
