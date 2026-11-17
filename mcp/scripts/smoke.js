import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/index.js', import.meta.url))], stderr: 'inherit', env: Object.fromEntries(['THEMEPARKS_API_KEY', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY', 'NODE_EXTRA_CA_CERTS'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])) });
const client = new Client({ name: 'disneyworld-smoke', version: '1.0.0' });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 8);
  const checks = [
    ['search_entities', { type: 'PARK' }, d => assert.equal(d.total, 6)],
    ['get_entity_details', { entity: 'mk' }, d => assert.equal(d.entity.timezone, 'America/New_York')],
    ['get_live_data', { entity: 'mk', limit: 5 }, d => assert.ok(d.total > 0)],
    ['get_park_hours', { entity: 'mk' }, d => assert.ok(d.data.schedule.length > 0)],
    ['get_showtimes', { entity: 'mk' }, d => assert.ok(Array.isArray(d.shows))],
    ['get_dining_waits', { entity: 'mk', partySize: 2 }, d => assert.ok(Array.isArray(d.restaurants))],
    ['get_wait_history', { entity: 'Mad Tea Party', mode: 'coverage' }, d => assert.ok(d.data)],
    ['get_wait_history', { entity: 'Mad Tea Party', mode: 'daily' }, d => assert.ok(d.data)],
    ['get_wait_history', { entity: 'Mad Tea Party', mode: 'raw' }, d => assert.ok(d.data)],
    ['recommend_rides', { park: 'mk' }, d => assert.ok(d.suggestions.every(r => r.freshness === 'recent'))]
  ];
  for (const [name, args, check] of checks) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, `${name}: ${JSON.stringify(result.content)}`);
    assert.ok(result.structuredContent);
    check(result.structuredContent);
    console.log(`PASS ${name}${args.mode ? ` (${args.mode})` : ''}`);
  }
  console.log('Verified all eight tools via a real stdio MCP subprocess and live ThemeParks.wiki calls.');
} finally {
  await client.close();
  await transport.close();
}
