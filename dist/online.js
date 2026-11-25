'use strict';

const privateOffice = 'https://projeto-all-condoconnect.sunnyode3.chatgpt.site';
if (location.origin === privateOffice) {
  window.fetchOnlineActivity = async () => {
    const response = await fetch('./api/activity', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('Atividade privada indisponível');
    return response.json();
  };
}
if (location.hostname === 'fysould-oss.github.io') {
  const note = document.querySelector('#bridge-note');
  const link = document.createElement('a');
  link.href = privateOffice;
  link.textContent = 'Abrir atividade privada ao vivo';
  if (note) note.replaceChildren(link);
}
