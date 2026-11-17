import test from 'node:test';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpApp } from '../src/http.js';

test('HTTP requires a strong token and host allowlist for public bindings', () => {
  assert.throws(() => createHttpApp(), /MCP_AUTH_TOKEN/);
  assert.throws(() => createHttpApp({ token: 'a'.repeat(32), host: '0.0.0.0' }), /MCP_ALLOWED_HOSTS/);
});

test('HTTP authentication, origin/host protection and real MCP handshake', async t => {
  const token = 'a'.repeat(32);
  const api = { get: async () => ({ name: 'Disney World', children: [] }) };
  const app = createHttpApp({ token, api });
  const listener = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve(s)); });
  t.after(() => new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); }));
  const url = new URL(`http://127.0.0.1:${listener.address().port}/mcp`);
  assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://other.example' } })).status, 403);
  const invalidHostStatus = await new Promise((resolve, reject) => {
    const req = request(url, { headers: { ...headers, Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(invalidHostStatus, 403);
  assert.equal((await fetch(url, { headers })).status, 405);
  const client = new Client({ name: 'http-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
  assert.equal((await client.listTools()).tools.length, 8);
  const result = await client.callTool({ name: 'search_entities', arguments: {} });
  assert.ok(!result.isError);
  assert.equal(result.structuredContent.entities[0].entityType, 'DESTINATION');
});
