/**
 * Validate and canonicalize a local preview URL without contacting it.
 * Only loopback HTTP endpoints with an explicit unprivileged port are allowed.
 */
export function normalizePreviewUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f\\]/.test(value)
    || !/^http:\/\/(?:localhost|127\.0\.0\.1):\d{1,5}(?:[/?]|$)/i.test(value.trim())
    || value.includes('#')) {
    throw new TypeError('URL de preview inválida.');
  }
  let url;
  try { url = new URL(value); } catch { throw new TypeError('URL de preview inválida.'); }
  if (url.protocol !== 'http:' || url.username || url.password || url.hash || !url.port) {
    throw new TypeError('Preview deve usar HTTP local, sem credenciais ou fragmento.');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') throw new TypeError('Preview deve apontar para localhost.');
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new TypeError('Porta de preview inválida.');
  return url.toString();
}
