import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpApp } from '../src/http.js';
import { createAccessVerifier } from '../src/access.js';

test('Access configuration fails closed', () => {
  assert.throws(() => createAccessVerifier({ issuer: 'http://evil.example', audience: 'app' }), /TEAM_DOMAIN/);
  assert.throws(() => createAccessVerifier({ issuer: 'https://test.cloudflareaccess.com' }), /AUD/);
  assert.throws(() => createHttpApp({ token: 'a'.repeat(32), access: {} }), /either/);
});

test('Access checks signature, issuer, audience and expiry before MCP calls', async t => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const issuer = 'https://test.cloudflareaccess.com';
  const jwks = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'test' }] });
  const sign = (claims = {}, key = privateKey) => new SignJWT({ sub: 'user', iss: issuer, aud: ['disney'], exp: Math.floor(Date.now()/1000) + 300, ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(key);
  const app = createHttpApp({ access: { issuer, audience: 'disney', jwks }, api: { get: async () => ({ name: 'Disney World', children: [] }) } });
  const listener = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); }));
  const url = new URL(`http://127.0.0.1:${listener.address().port}/mcp`);
  for (const assertion of ['', 'forged', await sign({ aud: ['panel'] }), await sign({ iss: 'https://evil.cloudflareaccess.com' }), await sign({ exp: 1 }), await sign({}, other.privateKey)]) {
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': assertion } })).status, 401);
  }
  assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + 'a'.repeat(32) } })).status, 401);
  const headers = { 'Cf-Access-Jwt-Assertion': await sign() };
  assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  const client = new Client({ name: 'access-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
  assert.equal((await client.listTools()).tools.length, 8);
  assert.ok(!(await client.callTool({ name: 'search_entities', arguments: {} })).isError);
});
