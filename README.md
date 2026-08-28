# Facebook Marketplace MCP Server

An MCP server that provides access to Facebook Marketplace via direct GraphQL API calls. No browser automation at runtime — speaks Facebook's internal protocol directly.

## How It Works

Facebook's web client makes all Marketplace requests as `POST /api/graphql/` with a `doc_id` (query hash) and `variables`. This server replays those requests using your existing Facebook session cookies from Chrome.

**Think of it like [pypush](https://github.com/JJTech0130/pypush) for iMessage — direct protocol, no browser.**

## Prerequisites

- **macOS** (cookie extraction uses Keychain)
- **Google Chrome** with an active Facebook login
- **Node.js** 20+

## Installation

```bash
git clone <this-repo>
cd facebook-marketplace-mcp
npm install
npm run build
```

## Setup with Claude Code

```bash
claude mcp add facebook-marketplace -- node /path/to/facebook-marketplace-mcp/dist/index.js
```

Or add to your Claude Code config manually:

```json
{
  "mcpServers": {
    "facebook-marketplace": {
      "command": "node",
      "args": ["/path/to/facebook-marketplace-mcp/dist/index.js"],
      "env": {
        "CHROME_PROFILE": "Default"
      }
    }
  }
}
```

## Tools

### `search_listings`
Search Marketplace by query, location, and filters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search term |
| `latitude` | number | yes | Latitude of search center |
| `longitude` | number | yes | Longitude of search center |
| `radius_km` | number | no | Search radius (default: 50) |
| `min_price` | number | no | Min price in dollars |
| `max_price` | number | no | Max price in dollars |
| `category` | string | no | Category ID |
| `limit` | number | no | Max results (default: 20) |

### `get_listing`
Get full details for a specific listing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `listing_id` | string | yes | Marketplace listing ID |

### `search_location`
Look up a city/town to get coordinates for `search_listings`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | City, neighborhood, or ZIP (e.g. `Sarasota`, `Brooklyn NY`) |

### `monitor_search`
Save a search as a monitor to track new listings over time.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Monitor name |
| `query` | string | yes | Search term |
| `latitude` | number | yes | Search center lat |
| `longitude` | number | yes | Search center lng |
| `radius_km` | number | no | Radius (default: 50) |
| `min_price` | number | no | Min price |
| `max_price` | number | no | Max price |

### `check_monitors`
Check monitors for new listings since last check.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `monitor_name` | string | no | Check specific monitor, or omit for all |

### `list_monitors`
List all saved monitors.

### `delete_monitor`
Delete a saved monitor.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Monitor name (note: `check_monitors` uses `monitor_name`) |

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `CHROME_PROFILE` | `Default` | Chrome profile directory name |

## Updating GraphQL Queries

Facebook rotates their `doc_id` values on deploys. If searches stop working:

```bash
npm install -D playwright
npx playwright install chromium
npm run capture-queries
```

This opens a browser, navigates Marketplace, and captures current query IDs. Update `src/facebook/queries.ts` with the new values.

Note that `capture-queries` launches Playwright against your real Chrome profile
directory, so Chrome must be fully quit first or it will fail to launch.

You can also capture them by hand without Playwright: open Marketplace in Chrome,
run this in the DevTools console, then scroll the results to trigger a fetch.

```js
const rec = b => { const p = new URLSearchParams(b); const d = p.get('doc_id');
  if (d) console.log(p.get('fb_api_req_friendly_name'), d); };
const of = window.fetch;
window.fetch = function (...a) {
  const u = typeof a[0] === 'string' ? a[0] : a[0]?.url ?? '';
  if (u.includes('/api/graphql') && typeof a[1]?.body === 'string') rec(a[1].body);
  return of.apply(this, a);
};
```

The two IDs this server needs are `CometMarketplaceSearchContentPaginationQuery`
(search) and `MarketplaceSearchAddressDataSourceQuery` (location lookup).

If results come back empty after a Facebook deploy, run with `FB_MCP_DEBUG=1` to
see whether listing data is being matched in the page.

## Rate Limiting

The server self-rate-limits to 3 requests/minute with random jitter to avoid detection. This means searches take a few seconds.

## Limitations

- **macOS only** for automatic cookie extraction
- **Requires Chrome** with active Facebook session
- **Facebook ToS** — automating Facebook violates their Terms of Service
- **Fragile** — `doc_id` values change on Facebook deploys
- **Rate limited** — aggressive use may trigger CAPTCHAs or account flags
- **No write operations** — search/read only, no messaging or listing creation
