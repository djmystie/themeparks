import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createAccessVerifier } from './access.js';
import { ThemeParksApi } from './api.js';
import { createServer } from './server.js';

export function createHttpApp({ token, host = '127.0.0.1', allowedHosts, access, api = new ThemeParksApi(), now } = {}) {
  if (!access && (!token || token.length < 32)) throw new Error('Set MCP_AUTH_TOKEN to a random secret of at least 32 characters.');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !allowedHosts?.length) {
    throw new Error('Set MCP_ALLOWED_HOSTS when listening outside loopback.');
  }
  if (access && token) throw new Error('Configure either Cloudflare Access or bearer authentication, not both.');
  const verifyAccess = access ? createAccessVerifier(access) : null;
  const app = createMcpExpressApp({ host, allowedHosts });
  app.use('/mcp', async (req, res, next) => {
    if (verifyAccess) {
      try { await verifyAccess(req.headers['cf-access-jwt-assertion']); }
      catch { return res.status(401).json({ error: 'A valid Cloudflare Access credential is required.' }); }
    } else {
      const supplied = Buffer.from(req.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        return res.status(401).json({ error: 'A valid bearer token is required.' });
      }
    }
    // This endpoint is for MCP clients; browser cross-origin access is disabled.
    if (req.headers.origin) return res.status(403).json({ error: 'Browser origins are not supported.' });
    next();
  });
  app.post('/mcp', async (req, res) => {
    const server = createServer({ api, now });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'MCP request failed.' } });
      await server.close();
    }
  });
  app.all('/mcp', (req, res) => res.status(405).set('Allow', 'POST').end());
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.MCP_HOST ?? '127.0.0.1';
  const port = Number(process.env.MCP_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid MCP_PORT.');
  const app = createHttpApp({ host, token: process.env.MCP_AUTH_TOKEN,
    access: process.env.CF_ACCESS_TEAM_DOMAIN || process.env.CF_ACCESS_AUD
      ? { issuer: process.env.CF_ACCESS_TEAM_DOMAIN, audience: process.env.CF_ACCESS_AUD } : undefined,
    allowedHosts: process.env.MCP_ALLOWED_HOSTS?.split(',').map(s => s.trim()).filter(Boolean) });
  const listener = app.listen(port, host, () => console.error(`Disney World MCP listening on ${host}:${port}/mcp`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    listener.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
