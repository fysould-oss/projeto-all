'use strict';

const privateOffice = 'https://projeto-all-condoconnect.sunnyode3.chatgpt.site';
const sprites = new Image();
sprites.onload = () => document.body.classList.add('sprites-ready');
sprites.src = './office-sprites.png';

if (location.origin === privateOffice) {
  window.fetchOnlineActivity = async () => {
    const response = await fetch('./api/activity', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('Atividade privada indisponível');
    return response.json();
  };
}
const isLiveOffice = location.origin === privateOffice || ['127.0.0.1', 'localhost'].includes(location.hostname);
if (['127.0.0.1', 'localhost'].includes(location.hostname)) {
  const details = document.createElement('details');
  details.className = 'local-queue';
  const heading = document.createElement('summary');
  heading.textContent = 'Fila de tarefas deste computador';
  const list = document.createElement('ul');
  details.append(heading, list);
  document.querySelector('.workspace-shell')?.before(details);
  const states = { queued: 'Na fila', running: 'Em execução', done: 'Concluída', failed: 'Falhou' };
  let pending = false;
  async function updateQueue() {
    if (!details.open || document.hidden || pending) return;
    pending = true;
    try {
      const response = await fetch('./api/local-tasks', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error();
      const { jobs } = await response.json();
      const rows = jobs.map(job => {
        const row = document.createElement('li');
        const project = document.createElement('strong');
        project.textContent = job.project;
        const state = states[job.status] || 'Estado desconhecido';
        row.append(project, ' · ' + state);
        if (job.slot) row.append(' · Executor ' + job.slot.toUpperCase());
        if (job.files != null) row.append(' · Arquivos pendentes: ' + job.files);
        return row;
      });
      list.replaceChildren(...rows);
      if (!rows.length) list.textContent = 'Nenhuma tarefa registrada.';
    } catch { list.textContent = 'Fila local indisponível.'; }
    finally { pending = false; }
  }
  let timer;
  details.addEventListener('toggle', () => {
    clearInterval(timer);
    if (details.open) { updateQueue(); timer = setInterval(updateQueue, 5000); }
  });
}
const liveLink = document.getElementById('live-office-link');
if (liveLink) liveLink.hidden = isLiveOffice;
if (!isLiveOffice) {
  document.body.classList.add('public-office');
  window.setLiveOfficeFloor = floor => {
    const destination = new URL('/', privateOffice);
    if (/^[a-z0-9_-]{1,64}$/i.test(floor)) destination.searchParams.set('andar', floor);
    if (liveLink) liveLink.href = destination.href;
  };
}
