import test from 'node:test';
import assert from 'node:assert/strict';
import { ThemeParksApi } from '../src/api.js';

test('caches, coalesces and conditionally revalidates with ETag', async () => {
  let calls = 0; let clock = 0; let headers;
  const api = new ThemeParksApi({ now: () => clock, fetchImpl: async (url, options) => {
    calls++; headers = options.headers;
    return calls === 1 ? Response.json({ ok: true }, { headers: { etag: 'v1', 'cache-control': 'max-age=60' } }) : new Response(null, { status: 304 });
  } });
  await Promise.all([api.get('destinations', {}, 10), api.get('destinations', {}, 10)]);
  assert.equal(calls, 1);
  clock = 59_000; await api.get('destinations', {}, 10); assert.equal(calls, 1);
  clock = 61_000; assert.deepEqual(await api.get('destinations', {}, 10), { ok: true });
  assert.equal(headers['If-None-Match'], 'v1');
});

test('429 backs off without another fetch; errors never leak API key', async () => {
  let calls = 0;
  const api = new ThemeParksApi({ now: () => 0, apiKey: 'secret', fetchImpl: async () => {
    calls++; return Response.json({ message: 'secret', retryAfter: 20 }, { status: 429 });
  } });
  await assert.rejects(api.get('destinations'), e => e.status === 429 && e.retryAfter === 20 && !e.message.includes('secret'));
  await assert.rejects(api.get('destinations'), e => e.retryAfter === 20);
  assert.equal(calls, 1);
});

test('denied history, unreachable API and invalid JSON are handled', async () => {
  const denied = new ThemeParksApi({ fetchImpl: async () => Response.json({}, { status: 403 }) });
  await assert.rejects(denied.get('history'), /plan history window/);
  const failed = new ThemeParksApi({ fetchImpl: async () => { throw new Error('private url'); } });
  await assert.rejects(failed.get('destinations'), /could not be reached/);
  const invalid = new ThemeParksApi({ fetchImpl: async () => Response.json(null) });
  await assert.rejects(invalid.get('destinations'), /invalid response/);
});

test('no-store responses are not retained; malformed JSON becomes a safe error', async () => {
  let calls = 0;
  const api = new ThemeParksApi({ fetchImpl: async () => { calls++; return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } }); } });
  await api.get('destinations'); await api.get('destinations');
  assert.equal(calls, 2);
  assert.equal(api.cache.size, 0);
  const malformed = new ThemeParksApi({ fetchImpl: async () => new Response('sensitive upstream text') });
  await assert.rejects(malformed.get('destinations'), e => e.status === 502 && !e.message.includes('sensitive'));
});
