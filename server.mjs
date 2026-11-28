import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createActivityMonitor } from './monitor/activity.mjs';
import { startOnlineRelay } from './monitor/relay.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createCommandApi } from './command/api.mjs';
import { readRelayCredential } from './monitor/credential.mjs';

const assets = new Map([
  ['/command.html', 'text/html; charset=utf-8'],
  ['/command.css', 'text/css; charset=utf-8'],
  ['/command.js', 'text/javascript; charset=utf-8'],
  ['/index.html', 'text/html; charset=utf-8'],
  ['/style.css', 'text/css; charset=utf-8'],
  ['/app.js', 'text/javascript; charset=utf-8'],
  ['/rules.js', 'text/javascript; charset=utf-8'],
  ['/online.js', 'text/javascript; charset=utf-8'],
  ['/progress.json', 'application/json; charset=utf-8'],
  ['/projects.json', 'application/json; charset=utf-8'],
  ['/office-lobby.png', 'image/png'],
  ['/office-floor.webp', 'image/webp'],
  ['/office-mobile.webp', 'image/webp'],
  ['/office-sprites.png', 'image/png'],
]);
const port = Number(process.env.PAINEL_PORT || 4173);
const activity = createActivityMonitor();
const commandApi = createCommandApi(process.env.PROJETO_ALL_COMMAND_DB || join(homedir(), '.projeto-all', 'command.json'), activity.getSnapshot);
const closeRelay = startOnlineRelay(activity.getSnapshot, process.env.PROJETO_ALL_DISABLE_RELAY === '1' ? '' : await readRelayCredential());
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

const server = createServer(async (request, response) => {
  const localHosts = ['127.0.0.1:' + port, 'localhost:' + port];
  if (!localHosts.includes(request.headers.host)) {
    response.writeHead(403, headers).end();
    return;
  }
  const pathname = request.url.split('?')[0];
  if (pathname === '/api/command') {
    await commandApi(request, response, headers);
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end();
    return;
  }
  if (pathname === '/api/activity') {
    if (request.headers['sec-fetch-site'] === 'cross-site'
        || (request.headers.origin && request.headers.origin !== 'http://' + request.headers.host)) {
      response.writeHead(403, headers).end();
      return;
    }
    response.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify(activity.getSnapshot()));
    return;
  }
  const path = pathname === '/' ? '/index.html' : pathname;
  const contentType = assets.get(path);
  if (!contentType) {
    response.writeHead(404, headers).end('Página indisponível');
    return;
  }
  try {
    const content = await readFile(new URL('./dist' + path, import.meta.url));
    response.writeHead(200, { ...headers, 'Content-Type': contentType });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    console.error('Falha ao servir um arquivo do painel.', error.code);
    response.writeHead(503, headers).end('Arquivo indisponível');
  }
}).listen(port, '127.0.0.1', () => {
  console.log('Painel disponível em http://127.0.0.1:' + port);
});
server.on('close', () => {
  void commandApi.close();
  closeRelay();
  activity.close();
});
process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());
