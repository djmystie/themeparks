import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { DESTINATION_ID, DisneyWorld } from '../src/disneyworld.js';

const park = { id: 'park', name: 'Magic Kingdom Park', entityType: 'PARK' };
const attraction = (id, wait, status = 'OPERATING', time = '2026-11-17T17:00:00Z') => ({ id, name: id, entityType: 'ATTRACTION', status, queue: { STANDBY: { waitTime: wait } }, lastUpdated: time });
const live = [attraction('zero', 0), attraction('unknown', null), attraction('stale', 5, 'OPERATING', '2026-11-17T15:00:00Z'), attraction('down', 5, 'DOWN'),
  { id: 'show', name: 'Show', entityType: 'SHOW', showtimes: [{ type: 'Operating', startTime: '2026-11-17T09:00:00-05:00', endTime: '2026-11-17T18:00:00-05:00' }, { type: 'Performance', startTime: '2026-11-17T10:00:00-05:00' }] },
  { id: 'food', name: 'Food', entityType: 'RESTAURANT', diningAvailability: [{ partySize: 2, waitTime: 0 }, { partySize: 4, waitTime: 20 }] },
  attraction('outside-wdw', 1)];
const children = [park, ...live.filter(r => r.id !== 'outside-wdw').map(r => ({ id: r.id, name: r.name, entityType: r.entityType, parentId: 'park' }))];
const now = () => new Date('2026-11-17T17:01:00Z');
function mockApi() {
  return { calls: [], async get(path, params) {
    this.calls.push({ path, params });
    if (path.endsWith('/children')) return { name: 'Walt Disney World® Resort', children };
    if (path.endsWith('/live')) return { liveData: live };
    return { id: path.split('/')[1], schedule: [], days: [] };
  } };
}
async function connect(t) {
  const api = mockApi();
  const server = createServer({ api, now });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  return { client, api };
}
const call = async (client, name, args) => {
  const result = await client.callTool({ name, arguments: args });
  return { ...result, data: result.isError ? { error: result.content[0].text } : JSON.parse(result.content[0].text) };
};

test('MCP handshake and all eight read-only tools', async t => {
  const { client } = await connect(t);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 8);
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint));
  for (const [name, args] of [['search_entities', {}], ['get_entity_details', { entity: 'zero' }], ['get_live_data', {}], ['get_park_hours', { entity: 'mk' }], ['get_showtimes', {}], ['get_dining_waits', {}], ['get_wait_history', { entity: 'zero' }], ['recommend_rides', { park: 'mk' }]]) {
    const result = await call(client, name, args);
    assert.ok(!result.isError, JSON.stringify(result));
    assert.equal(result.structuredContent.timezone, 'America/New_York');
  }
});

test('zero waits survive; null waits and nonoperating rides excluded by maxWait', async t => {
  const { client } = await connect(t);
  const { data } = await call(client, 'get_live_data', { maxWait: 0 });
  assert.deepEqual(data.liveData.map(r => r.id), ['zero']);
  const all = (await call(client, 'get_live_data', {})).data.liveData;
  assert.equal(all.find(r => r.id === 'unknown').queue.STANDBY.waitTime, null);
  assert.equal(all.find(r => r.id === 'stale').freshness, 'stale');
  assert.equal(all.find(r => r.id === 'show').freshness, 'unknown');
  assert.ok(!all.some(r => r.id === 'outside-wdw'));
});

test('recommendations exclude stale, unknown, down and foreign rides', async t => {
  const { client } = await connect(t);
  const { data } = await call(client, 'recommend_rides', { park: 'mk' });
  assert.deepEqual(data.suggestions.map(r => r.id), ['zero']);
});

test('scope enforcement rejects foreign UUID before fetching details', async t => {
  const { client, api } = await connect(t);
  const result = await call(client, 'get_entity_details', { entity: 'foreign-uuid' });
  assert.ok(result.isError);
  assert.ok(api.calls.every(c => c.path.endsWith('/children')));
});

test('show windows retain types, past performances removed; dining filters party size', async t => {
  const { client } = await connect(t);
  const shows = (await call(client, 'get_showtimes', {})).data.shows;
  assert.equal(shows[0].showtimes.length, 1);
  assert.equal(shows[0].showtimes[0].type, 'Operating');
  const food = (await call(client, 'get_dining_waits', { partySize: 2 })).data.restaurants;
  assert.deepEqual(food[0].diningAvailability, [{ partySize: 2, waitTime: 0 }]);
});

test('validates dates, filters and paired schedule parameters over MCP', async t => {
  const { client, api } = await connect(t);
  for (const [name, args] of [['get_park_hours', { entity: 'mk', year: 2026 }], ['get_wait_history', { entity: 'zero', date: '2026-11-17', from: '2026-11-16' }], ['get_wait_history', { entity: 'zero', from: '2026-11-17', to: '2026-11-16' }], ['get_wait_history', { entity: 'zero', date: '2026-02-30' }], ['get_live_data', { limit: 10000 }], ['get_showtimes', { after: 'tomorrow' }]]) {
    assert.ok((await call(client, name, args)).isError, name);
  }
  await call(client, 'get_park_hours', { entity: 'mk', year: 2026, month: 9 });
  assert.ok(api.calls.some(c => c.path === 'entity/park/schedule/2026/09'));
});

test('ambiguous names return choices; search limits and park filters work', async () => {
  const api = mockApi(); const disney = new DisneyWorld(api, { now });
  const all = await disney.search({ park: 'mk', limit: 2 });
  assert.equal(all.entities.length, 2);
  assert.ok(all.total > 2);
  await assert.rejects(disney.resolve('o'), /Ambiguous/);
  assert.equal((await disney.resolve(DESTINATION_ID)).entityType, 'DESTINATION');
});
