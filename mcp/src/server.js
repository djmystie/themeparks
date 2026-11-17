import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ThemeParksApi } from './api.js';
import { DisneyWorld } from './disneyworld.js';

const entity = z.string().trim().min(1).max(200).describe('Exact Disney World entity name, UUID or slug. Park aliases: mk, epcot, hs, ak. wdw means the resort.');
const type = z.enum(['DESTINATION', 'PARK', 'ATTRACTION', 'SHOW', 'RESTAURANT', 'HOTEL']);
const limit = z.number().int().min(1).max(250).optional();
const date = z.string().date().describe('Park-local calendar day (YYYY-MM-DD), America/New_York.');

export function createServer({ api = new ThemeParksApi(), now } = {}) {
  const disney = new DisneyWorld(api, { now });
  const server = new McpServer({ name: 'disneyworld', version: '1.0.0' }, {
    instructions: 'Read-only Walt Disney World data from ThemeParks.wiki. Show observation timestamps and source uncertainty. Never interpret missing waits as zero. Use park-local time and distinguish general opening hours from restricted events. No booking or account access is provided.'
  });
  function register(name, description, inputSchema, method) {
    server.registerTool(name, { description, inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    }, async args => {
      try {
        const result = await disney[method](args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        const result = { error: error.message, ...(error.status ? { status: error.status } : {}),
          ...(error.retryAfter ? { retryAfterSeconds: error.retryAfter } : {}) };
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
    });
  }
  register('search_entities', 'Find Disney World parks, attractions, shows and restaurants, with IDs and locations. Empty query lists entities. Search is case/accent/punctuation insensitive.', {
    query: z.string().max(100).optional(), type: type.optional(), park: entity.optional(), limit
  }, 'search');
  register('get_entity_details', 'Get published metadata, coordinates and available attributes such as height restrictions for one verified Disney World entity.', { entity }, 'details');
  register('get_live_data', 'Get current status, standby waits, Lightning Lane return times/prices, forecasts and boarding groups where supplied. Unknown waits remain null; zero is a valid wait. Sorted by standby wait.', {
    entity: entity.optional(), type: type.optional(), status: z.string().min(1).max(50).optional(),
    maxWait: z.number().min(0).max(1440).optional().describe('Only operating entities with a known standby wait at or below this many minutes.'), limit
  }, 'live');
  register('get_park_hours', 'Get published schedules and pass prices/availability where supplied. Defaults to the next 30 days; supply year AND month for a calendar month. Preserves early entry and special ticketed event labels.', {
    entity, year: z.number().int().min(1970).max(2150).optional(), month: z.number().int().min(1).max(12).optional()
  }, 'hours');
  register('get_showtimes', 'Get remaining show and character-experience times or operating windows. Window types are preserved and are not necessarily discrete performances. Defaults to now.', {
    entity: entity.optional(), after: z.string().datetime({ offset: true }).optional().describe('ISO timestamp with timezone offset or Z.'), limit
  }, 'shows');
  register('get_dining_waits', 'Get published restaurant waits, optionally for a party size. This is not dining reservation inventory; no bookings are supported.', {
    entity: entity.optional(), partySize: z.number().int().min(1).max(100).optional(), limit
  }, 'dining');
  register('get_wait_history', 'Get daily wait/downtime summaries, raw recorded changes or available historical coverage. Use date OR from/to. API plan limits apply. Raw park history supports one day; daily park results may be paged.', {
    entity, mode: z.enum(['daily', 'raw', 'coverage']).optional(), date: date.optional(), from: date.optional(), to: date.optional()
  }, 'history');
  register('recommend_rides', 'Suggest operating attractions in a park ranked by current standby wait. Only recent known waits qualify. This does not account for walking time, height eligibility or personal preferences.', {
    park: entity, maxWait: z.number().min(0).max(1440).optional(), limit
  }, 'recommend');
  return server;
}
