import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const assets = new Map([
  ['/index.html', 'text/html; charset=utf-8'],
  ['/style.css', 'text/css; charset=utf-8'],
  ['/app.js', 'text/javascript; charset=utf-8'],
  ['/rules.js', 'text/javascript; charset=utf-8'],
  ['/progress.json', 'application/json; charset=utf-8'],
]);
const port = Number(process.env.PAINEL_PORT || 4173);

createServer(async (request, response) => {
  const pathname = request.url.split('?')[0];
  const path = pathname === '/' ? '/index.html' : pathname;
  const contentType = assets.get(path);
  if (!contentType) {
    response.writeHead(404).end('Página indisponível');
    return;
  }
  try {
    const content = await readFile(new URL('./dist' + path, import.meta.url));
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    console.error(error.message);
    response.writeHead(503).end('Arquivo indisponível');
  }
}).listen(port, '127.0.0.1', () => {
  console.log('Painel disponível em http://127.0.0.1:' + port);
});
