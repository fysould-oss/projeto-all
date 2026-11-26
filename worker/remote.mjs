const privateOrigin = 'https://projeto-all-condoconnect.sunnyode3.chatgpt.site';
const routes = new Map([
  ['/api/remote/instructions', 'owner'],
  ['/api/remote/claim', 'device'],
  ['/api/remote/result', 'device'],
  ['/api/remote/progress', 'device'],
]);
const jobId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sessionId = /^[0-9a-f]{24}$/;
const hour = 3_600_000;
const bodyLimit = 40_000;

function reply(data, status = 200) {
  return Response.json(data, { status, headers: {
    'Cache-Control': 'no-store, private',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin, X-Office-Owner, X-Office-Device',
  } });
}

class Rejected extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function authorize(request, env, role, origin) {
  const owner = env.OFFICE_OWNER_TOKEN;
  const device = env.OFFICE_DEVICE_TOKEN;
  if (![owner, device].every(key => typeof key === 'string' && key.length >= 32 && key.length <= 512)
      || owner === device) throw new Rejected(503, 'Pareamento indisponível.');
  const sender = request.headers.get('Origin');
  if (role === 'device' ? sender !== null : sender !== null && sender !== origin) {
    throw new Rejected(403, 'Origem inválida.');
  }
  if (role === 'owner' && request.method === 'POST' && sender !== origin) {
    throw new Rejected(403, 'Origem inválida.');
  }
  const supplied = request.headers.get(role === 'owner' ? 'X-Office-Owner' : 'X-Office-Device');
  if (!supplied || supplied.length > 512 || await digest(supplied) !== await digest(role === 'owner' ? owner : device)) {
    throw new Rejected(403, 'Autorização inválida.');
  }
}

async function readObject(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new Rejected(415, 'Envie JSON.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Rejected(400, 'Corpo ausente.');
  const buffer = new Uint8Array(bodyLimit);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > bodyLimit) {
        await reader.cancel();
        throw new Rejected(413, 'Corpo muito grande.');
      }
      buffer.set(value, offset);
      offset += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset)));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {}
  throw new Rejected(400, 'JSON inválido.');
}

function validId(id) {
  return typeof id === 'string' && jobId.test(id);
}

async function maintain(db, now) {
  await db.batch([
    db.prepare(`UPDATE office_instructions SET status = 'expired', instruction = NULL, receipt_hash = NULL, updated_at = ?
      WHERE (status = 'queued' AND created_at <= ?) OR (status = 'claimed' AND updated_at <= ?)`)
      .bind(now, now - hour, now - 24 * hour),
    db.prepare('DELETE FROM office_instructions WHERE updated_at <= ?').bind(now - 7 * 24 * hour),
  ]);
}

async function instructions(request, url, db, now) {
  const body = request.method === 'POST' ? await readObject(request) : null;
  const id = body ? body.id : url.searchParams.get('id');
  if (!validId(id)) throw new Rejected(400, 'Identificador inválido.');
  let fingerprint;
  if (body) {
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    if (typeof body.sessionId !== 'string' || !sessionId.test(body.sessionId)
        || !instruction || instruction.length > 4000 || instruction.includes('\0')) {
      throw new Rejected(400, 'Sessão ou instrução inválida.');
    }
    fingerprint = await digest(instruction);
    await db.prepare(`INSERT INTO office_instructions
      (id, session_id, instruction, instruction_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', ?, ?) ON CONFLICT(id) DO NOTHING`)
      .bind(id, body.sessionId, instruction, fingerprint, now, now).run();
  }
  const row = await db.prepare('SELECT id, session_id, status, updated_at, progress, instruction_hash FROM office_instructions WHERE id = ?')
    .bind(id).first();
  if (!row) throw new Rejected(404, 'Instrução indisponível.');
  if (body && (row.session_id !== body.sessionId || row.instruction_hash !== fingerprint)) {
    throw new Rejected(409, 'Este identificador já foi usado para outra instrução.');
  }
  return reply({ id: row.id, sessionId: row.session_id, status: row.status,
    progress: row.progress, updatedAt: row.updated_at,
    stale: row.status === 'claimed' && now - row.updated_at > 45000 });
}

async function claim(db, body, now) {
  const ids = body.sessionIds;
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || !sessionId.test(id))) {
    throw new Rejected(400, 'Lista de sessões inválida.');
  }
  if (!ids.length) return reply({ job: null });
  const receipt = crypto.randomUUID();
  const fingerprint = await digest(receipt);
  // D1 batches are transactional. Capture the instruction once and erase it before committing the claim.
  const [, selected] = await db.batch([
    db.prepare(`UPDATE office_instructions SET status = 'claimed', receipt_hash = ?, updated_at = ?
      WHERE id = (SELECT q.id FROM office_instructions q
        WHERE q.status = 'queued' AND q.session_id IN (SELECT value FROM json_each(?))
        AND q.created_at > ? AND NOT EXISTS (SELECT 1 FROM office_instructions busy
          WHERE busy.session_id = q.session_id AND busy.status = 'claimed')
        ORDER BY q.created_at, q.id LIMIT 1)`).bind(fingerprint, now, JSON.stringify(ids), now - hour),
    db.prepare('SELECT id, session_id, instruction FROM office_instructions WHERE receipt_hash = ?')
      .bind(fingerprint),
    db.prepare('UPDATE office_instructions SET instruction = NULL WHERE receipt_hash = ?').bind(fingerprint),
  ]);
  const row = selected.results[0];
  return reply({ job: row ? { id: row.id, sessionId: row.session_id, instruction: row.instruction, receipt } : null });
}

async function result(db, body, now) {
  if (!validId(body.id) || !validId(body.receipt) || !['completed', 'failed'].includes(body.status)) {
    throw new Rejected(400, 'Resultado inválido.');
  }
  const fingerprint = await digest(body.receipt);
  await db.prepare(`UPDATE office_instructions SET status = ?, updated_at = ?
    WHERE id = ? AND receipt_hash = ? AND status = 'claimed'`)
    .bind(body.status, now, body.id, fingerprint).run();
  const row = await db.prepare('SELECT status FROM office_instructions WHERE id = ? AND receipt_hash = ?')
    .bind(body.id, fingerprint).first();
  if (!row || row.status !== body.status) throw new Rejected(409, 'Entrega indisponível.');
  return reply({ status: row.status });
}

async function progress(db, body, now) {
  if (!validId(body.id) || !validId(body.receipt) || !['waiting','running','turn.started','item.started','item.completed','turn.completed'].includes(body.phase)) {
    throw new Rejected(400, 'Evento inválido.');
  }
  const hash = await digest(body.receipt);
  const row = await db.prepare("UPDATE office_instructions SET progress=?, updated_at=? WHERE id=? AND receipt_hash=? AND status='claimed' RETURNING id")
    .bind(body.phase, now, body.id, hash).first();
  if (!row) throw new Rejected(409, 'Entrega indisponível.');
  return reply({ ok: true });
}

export async function remoteQueue(request, env) {
  try {
    const url = new URL(request.url);
    const role = routes.get(url.pathname);
    if (url.origin !== privateOrigin || !role) throw new Rejected(404, 'Recurso indisponível.');
    if (request.method !== 'POST' && !(request.method === 'GET' && role === 'owner')) {
      throw new Rejected(405, 'Método indisponível.');
    }
    await authorize(request, env, role, url.origin);
    const now = Date.now();
    await maintain(env.DB, now);
    if (role === 'owner') return await instructions(request, url, env.DB, now);
    const body = await readObject(request);
    if (url.pathname === '/api/remote/claim') return await claim(env.DB, body, now);
    if (url.pathname === '/api/remote/progress') return await progress(env.DB, body, now);
    return await result(env.DB, body, now);
  } catch (error) {
    if (error instanceof Rejected) return reply({ error: error.message }, error.status);
    return reply({ error: 'Fila temporariamente indisponível.' }, 503);
  }
}
