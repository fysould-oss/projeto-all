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
