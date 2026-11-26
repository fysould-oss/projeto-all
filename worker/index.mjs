const pagesOrigin = 'https://fysould-oss.github.io/projeto-all/';
const assets = new Set([
  'index.html', 'style.css', 'app.js', 'online.js', 'rules.js',
  'projects.json', 'progress.json', 'office-lobby.png', 'office-sprites.png', 'office-floor.webp', 'office-mobile.webp',
]);
const maxBytes = 512_000;
const sessionTimeoutMs = 75_000;
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function json(data, status = 200) {
  return Response.json(data, { status, headers });
}

async function activity(request, env) {
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT snapshot, received_at FROM office_activity WHERE id = 1').first();
    if (!row) return json({ status: 'starting', projects: [] });
    const snapshot = JSON.parse(row.snapshot);
    if (Date.now() - Date.parse(row.received_at) > sessionTimeoutMs) {
      snapshot.status = 'unavailable';
      for (const project of snapshot.projects) {
        for (const agent of project.agents) {
          if (agent.status === 'em-andamento') agent.status = 'sem-sinal';
        }
      }
    }
    return json({ ...snapshot, receivedAt: row.received_at });
  }
  if (request.method !== 'POST') return json({ error: 'método indisponível' }, 405);
  if (request.headers.get('x-office-sync') !== '1' || request.headers.has('origin')) {
    return json({ error: 'acesso indisponível' }, 403);
  }
  const size = Number(request.headers.get('content-length'));
  if (!Number.isInteger(size) || size < 1 || size > maxBytes) return json({ error: 'tamanho inválido' }, 413);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maxBytes) return json({ error: 'tamanho inválido' }, 413);
  const snapshot = JSON.parse(new TextDecoder().decode(bytes));
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.projects) || snapshot.projects.length > 25
      || snapshot.projects.some(project => !Array.isArray(project.agents) || project.agents.length > 40)) {
    return json({ error: 'formato inválido' }, 400);
  }
  await env.DB.prepare('INSERT INTO office_activity VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot, received_at = excluded.received_at')
    .bind(JSON.stringify(snapshot), new Date().toISOString()).run();
  return new Response(null, { status: 204, headers });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/activity') {
      try {
        return await activity(request, env);
      } catch (error) {
        console.error('Falha na atividade do escritório.', error.name);
        return json({ error: 'registro temporariamente indisponível' }, error instanceof SyntaxError ? 400 : 503);
      }
    }
    const asset = path === '/' ? 'index.html' : path.slice(1);
    if (!assets.has(asset)) return new Response('Página indisponível', { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    const assetUrl = new URL(asset, pagesOrigin);
    assetUrl.searchParams.set('v', 'office-floor-2');
    const response = await fetch(assetUrl, { method: request.method });
    if (!response.ok) return new Response('Publicação do GitHub indisponível', { status: 503 });
    const responseHeaders = new Headers(headers);
    responseHeaders.set('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    responseHeaders.set('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    return new Response(response.body, { headers: responseHeaders });
  },
};
