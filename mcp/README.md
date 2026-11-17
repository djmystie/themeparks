# Disney World MCP

A read-only MCP server for Walt Disney World using [ThemeParks.wiki](https://api.themeparks.wiki/docs). This is a separate Node project; it does not require installing or building the older React app in the parent directory.

## Install and run

Requires Node.js 22 or later and outbound HTTPS to `api.themeparks.wiki`.

```sh
cd mcp
npm ci
npm start
```

`npm start` uses stdio. It waits for an MCP client and writes only MCP messages to stdout. No Disney login is needed. An optional `THEMEPARKS_API_KEY` grants the history window and limits associated with your API plan. Set it in the process environment or MCP client configuration; `.env` is not automatically loaded. Do not commit keys.

Example configuration for an MCP client that supports local stdio servers (replace the absolute path):

```json
{
  "mcpServers": {
    "disneyworld": {
      "command": "node",
      "args": ["/absolute/path/to/themeparks/mcp/src/index.js"]
    }
  }
}
```

To use an API key, add `"env": { "THEMEPARKS_API_KEY": "your-key" }` inside the `disneyworld` entry. Use your client's secret storage when available. Proxy-based environments may need their proxy variables forwarded to the subprocess. Node 24 supports `NODE_USE_ENV_PROXY=1`.

## Tools

| Tool | Inputs | Behavior |
| --- | --- | --- |
| `search_entities` | optional `query`, `type`, `park`, `limit` | Searches the resort's verified listing. Empty query lists entities, including parks and water parks. Returns total matches and a bounded result list. |
| `get_entity_details` | `entity` | Published name, location, relationships and available attributes such as height restrictions. |
| `get_live_data` | optional `entity`, `type`, `status`, `maxWait`, `limit` | Status, standby waits and any source-provided forecasts, return windows, boarding groups or paid queue details. Sorted by standby wait. `maxWait` selects operating entities with known waits. |
| `get_park_hours` | `entity`, optional paired `year` and `month` | Next 30 days or a calendar month, including past published months. Preserves special event/early entry labels and source-provided purchase prices and availability. |
| `get_showtimes` | optional `entity`, `after`, `limit` | Remaining performances and character/entertainment operating windows. `after` requires an ISO timestamp with timezone offset or Z; defaults to now. |
| `get_dining_waits` | optional `entity`, `partySize`, `limit` | Published restaurant waits by party size, not reservation inventory. |
| `get_wait_history` | `entity`, optional `mode`, `date` OR `from`/`to` | `daily` summaries (default), `raw` changes or `coverage`. Calendar dates use YYYY-MM-DD. Coverage takes no dates. |
| `recommend_rides` | `park`, optional `maxWait`, `limit` | Operating attractions ranked by lowest standby wait; excludes unknown waits and observations older than five minutes. Default maximum wait is 30 minutes. |

Entity arguments accept exact names, UUIDs or slugs found in the Disney World listing. Unique partial names work; ambiguous matches return choices. Aliases: `wdw`, `disneyworld`, `mk`, `epcot`, `hs`, `ak`. Tools with an optional entity default to the resort. Types are `DESTINATION`, `PARK`, `ATTRACTION`, `SHOW`, `RESTAURANT`, `HOTEL`; the actual listing determines which are available. Default result limits are 25 for search, 100 for live/shows/dining, and 10 for recommendations; maximum is 250. Narrow by park/type/query if the total exceeds the returned list.

Example questions:

- Which operating Magic Kingdom rides have waits under 20 minutes?
- When does EPCOT close tomorrow, and are there restricted events?
- What Hollywood Studios shows are left today?
- Which restaurants publish waits for a party of four?
- Compare Mad Tea Party's daily waits over the last week.

## Remote HTTP use

A stateless Streamable HTTP transport is included for clients that support bearer authentication:

```sh
# Generate once and save securely; reuse the same token in your MCP client.
export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
npm run start:http
```

The default endpoint is `http://127.0.0.1:3001/mcp`. Configure the client's `Authorization: Bearer <token>` header. The HTTP token protects your MCP server; `THEMEPARKS_API_KEY` is a separate optional upstream credential.

Settings:

- `MCP_PORT`: default `3001`.
- `MCP_HOST`: default `127.0.0.1`.
- `MCP_AUTH_TOKEN`: required, at least 32 characters; use a randomly generated secret.
- `MCP_ALLOWED_HOSTS`: comma-separated hostnames accepted in the HTTP Host header. Required for non-loopback binding; include the public hostname and any internal hostname used by a reverse proxy.

For access from a phone or a hosted MCP client, run this on the host you control behind an HTTPS reverse proxy or authenticated tunnel. Set the host allowlist to the endpoint hostname and configure the client to send the bearer token. Some hosted clients require OAuth instead of custom bearer headers; this server does not implement an OAuth provider. It rejects browser Origin headers and does not enable cross-origin browser access. GET/SSE sessions and DELETE are intentionally unsupported; POST handles stateless MCP requests. API caching is shared across HTTP requests.

This project supplies the server, not hosting infrastructure. No public deployment or account connection is performed by running the tests.

## Data quality and limits

- Third-party observations can be missing or stale. Each result identifies its source, timezone and response time. `retrievedAt` is **not** the observation time; live records retain `lastUpdated`, with `dataAgeSeconds` and `freshness` (`recent`, `stale`, `unknown`). Data older than five minutes is labelled stale, not silently discarded except in recommendations.
- Missing/null waits remain unknown; zero minutes is a valid wait. A missing entity in a live response does not prove it is closed. Missing days in history do not mean zero waits.
- Times use `America/New_York` with source timezone offsets preserved. A show labelled `Operating` is a window, not a discrete performance. Early entry or ticketed events do not imply general admission access.
- Lightning Lane prices, availability, dining waits and forecasts appear only where the source supplies them. Price objects are preserved; use their currency and formatted representation rather than assuming raw amounts are dollars. Forecasts are estimates, not guarantees.
- No purchases, bookings, Disney account integration, walking-route optimisation or background alerts are implemented. Ride recommendations do not check eligibility or personal preferences; consult published details before acting.
- API documentation at implementation time describes live updates about once a minute and details/schedules about every five minutes. Requests use matching cache lifetimes, ETags and cache headers, coalesce concurrent identical calls, and back off on HTTP 429. Errors do not silently return stale cached data.
- Documented anonymous limits: 300 requests/minute; history 60 calls/hour and seven days. A free key currently extends history to 30 days and 600 history calls/hour. Paid limits vary; consult the upstream pricing/docs for current terms. The server reports plan errors and retry delays without exposing API keys.
- Raw history supports up to 31 days for one entity and one day for a park. Daily park history can return a `next` page: continue with the indicated dates. Responses preserve the upstream history envelope. Coverage may lag live data; today's anonymous history can also be delayed. The upstream enforces history windows and range limits.

## Verification

```sh
npm test
npm run smoke
```

Tests cover MCP tool discovery/calls, Disney World scope, zero/null/stale waits, recommendations, show windows, party sizes, input validation, caching, conditional requests, rate limits and HTTP authentication/host/origin protection. HTTP tests bind an ephemeral loopback port. Smoke tests launch a real stdio subprocess and exercise all tools against the live API, including history coverage, daily and raw modes. They require network access and may fail during upstream outages or rate limiting. In proxy environments, use `NODE_USE_ENV_PROXY=1 npm run smoke` on Node 24.
