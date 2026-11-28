import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePreviewUrl } from './previews.mjs';

test('normalizes allowed loopback previews while preserving path and query', () => {
  assert.equal(normalizePreviewUrl('http://localhost:4173/painel?a=1&b=2'), 'http://localhost:4173/painel?a=1&b=2');
  assert.equal(normalizePreviewUrl('http://127.0.0.1:8080/a%20b'), 'http://127.0.0.1:8080/a%20b');
});

test('rejects non-local, unsafe, credentialed, fragmented, and implicit-port URLs', () => {
  for (const value of [
    'https://localhost:4173/', 'http://example.test:4173/', 'http://127.0.0.2:4173/',
    'http://user:pass@localhost:4173/', 'http://localhost:4173/#private', 'http://localhost/',
    'http://localhost:80/', 'http://localhost:65536/', 'file:///tmp/site', 'http://localhost:4173/\n',
    'http://127.1:3000/', 'http://2130706433:3000/', 'http:/localhost:3000/', 'http://localhost:3000/#',
  ]) assert.throws(() => normalizePreviewUrl(value));
});
