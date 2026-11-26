'use strict';

const privateOffice = 'https://projeto-all-condoconnect.sunnyode3.chatgpt.site';
const sprites = new Image();
sprites.onload = () => document.body.classList.add('sprites-ready');
sprites.src = './office-sprites.png';

if (location.origin === privateOffice) {
  installRemoteOffice();
  window.fetchOnlineActivity = async () => {
    const response = await fetch('./api/activity', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('Atividade privada indisponível');
    return response.json();
  };
}

function installRemoteOffice() {
  const byId = id => document.getElementById('remote-' + id);
  const panel = byId('office');
  const owner = byId('owner');
  const prompt = byId('prompt');
  const send = byId('send');
  const check = byId('check');
  const status = byId('status');
  const endpoint = '/api/remote/instructions';
  const states = {
    queued: 'Na fila do PC de casa',
    claimed: 'Recebida pelo monitor do PC',
    completed: 'Execução concluída',
    failed: 'Falha na execução',
    expired: 'Instrução expirada',
  };
  let session = null;
  let receipt = null;
  let busy = false;
  let timer;

  function render() {
    panel.hidden = !session && !receipt;
    byId('compose').hidden = !session;
    if (session) byId('target').textContent = 'Instrução para ' + session.name;
    send.disabled = busy || !owner.value.trim() || !prompt.value.trim() || Boolean(receipt && !receipt.finished);
    check.hidden = !receipt || receipt.finished;
    check.disabled = busy || !owner.value.trim();
  }

  window.selectRemoteSession = agent => {
    const eligible = agent?.source === 'local' && agent.remoteEligible === true &&
      agent.status === 'concluido' && /^[0-9a-f]{24}$/.test(agent.id);
    const next = eligible ? agent : null;
    if (next?.id !== session?.id) prompt.value = '';
    session = next;
    render();
  };

  async function request(create) {
    if (busy || !owner.value.trim()) return;
    if (create) {
      if (!session || !prompt.value.trim() || (receipt && !receipt.finished)) return;
      receipt = { id: crypto.randomUUID(), sessionId: session.id, name: session.name, text: prompt.value.trim() };
    }
    if (!receipt) return;
    busy = true;
    clearTimeout(timer);
    render();
    const label = ' · ' + receipt.name + ' · Recibo ' + receipt.id;
    try {
      // Reuse the original id and payload if delivery of a POST is uncertain.
      const posting = create || !receipt.accepted;
      const headers = { 'X-Office-Owner': owner.value.trim() };
      const options = { method: posting ? 'POST' : 'GET', headers, cache: 'no-store',
        redirect: 'error', signal: AbortSignal.timeout(12000) };
      if (posting) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify({ id: receipt.id, sessionId: receipt.sessionId, instruction: receipt.text });
      }
      const response = await fetch(posting ? endpoint : endpoint + '?id=' + receipt.id, options);
      if (!response.ok) {
        if (posting && [400, 401, 403, 409, 413, 422].includes(response.status)) {
          status.textContent = response.status === 401 || response.status === 403
            ? 'Envio recusado. Confira a chave e a autorização da sessão.'
            : 'O servidor recusou a instrução. Confira a sessão selecionada.';
          receipt = null;
          return;
        }
        throw new Error();
      }
      const result = await response.json();
      if (result.id !== receipt.id || result.sessionId !== receipt.sessionId || !Object.hasOwn(states, result.status)) throw new Error();
      if (posting && session?.id === receipt.sessionId && prompt.value.trim() === receipt.text) prompt.value = '';
      receipt.accepted = true;
      delete receipt.text;
      receipt.finished = ['completed', 'failed', 'expired'].includes(result.status);
      const phases = { waiting: 'Aguardando executor', running: 'Executor iniciou',
        'turn.started': 'Turno iniciado', 'item.started': 'Atividade em execução',
        'item.completed': 'Atividade concluída', 'turn.completed': 'Confirmando conclusão' };
      const detail = result.stale ? 'Último sinal do executor desatualizado'
        : result.status === 'claimed' && phases[result.progress];
      status.textContent = states[result.status] + (detail ? ' · ' + detail : '') + label;
      if (!receipt.finished) timer = setTimeout(() => { if (!document.hidden) request(false); }, 6000);
    } catch {
      status.textContent = 'Estado não confirmado. Consulte o mesmo recibo.' + label;
    } finally {
      busy = false;
      render();
    }
  }

  owner.addEventListener('input', render);
  prompt.addEventListener('input', render);
  send.addEventListener('click', () => request(true));
  check.addEventListener('click', () => request(false));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && receipt?.accepted && !receipt.finished) request(false);
  });
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
  const states = { queued: 'Na fila', waiting_remote: 'Aguardando executor', running: 'Em execução', done: 'Concluída', failed: 'Falhou' };
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
