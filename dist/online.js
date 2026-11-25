'use strict';

const privateOffice = 'https://projeto-all-condoconnect.sunnyode3.chatgpt.site';
const sprites = new Image();
sprites.onload = () => document.body.classList.add('sprites-ready');
sprites.src = './office-sprites.png';

const zoomButton = document.getElementById('zoom-office');
if (zoomButton) {
  const scroll = document.querySelector('.map-scroll');
  zoomButton.hidden = false;
  zoomButton.addEventListener('click', () => {
    const zoomed = scroll.classList.toggle('zoomed');
    zoomButton.setAttribute('aria-pressed', String(zoomed));
    zoomButton.textContent = zoomed ? 'Ver sala inteira' : 'Ampliar sala';
    if (!zoomed) {
      scroll.scrollLeft = 0;
    } else {
      const focusedSeat = scroll.querySelector('.seat-button[aria-pressed="true"]');
      if (focusedSeat) {
        const seat = focusedSeat.getBoundingClientRect();
        scroll.scrollLeft += seat.left + seat.width / 2 - scroll.getBoundingClientRect().left - scroll.clientWidth / 2;
      }
    }
  });
}
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
    if (['sisc', 'sisc-test', 'projeto-all'].includes(floor)) destination.searchParams.set('andar', floor);
    if (liveLink) liveLink.href = destination.href;
  };
}
