# Facebook Marketplace MCP Server

An MCP server that provides access to Facebook Marketplace via direct GraphQL API calls. No browser automation at runtime — speaks Facebook's internal protocol directly.

## How It Works

Facebook's web client makes all Marketplace requests as `POST /api/graphql/` with a `doc_id` (query hash) and `variables`. This server replays those requests using your existing Facebook session cookies from Chrome.

**Think of it like [pypush](https://github.com/JJTech0130/pypush) for iMessage — direct protocol, no browser.**

## Prerequisites

- **macOS** (cookie extraction uses Keychain)
- **Google Chrome** with an active Facebook login or a Facebook cookie JSON file configured with `FACEBOOK_SESSION_FILE`
- **Node.js** 22+

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
        "CHROME_PROFILE": "Default",
        "FACEBOOK_SESSION_FILE": "/absolute/path/to/facebook-marketplace-mcp/.local/facebook-session.json"
      }
    }
  }
}
```

## Setup with Codex

```toml
[mcp_servers.facebook-marketplace]
command = "node"
args = ["/path/to/facebook-marketplace-mcp/dist/index.js"]

[mcp_servers.facebook-marketplace.env]
"CHROME_PROFILE" = "Default"
"FACEBOOK_SESSION_FILE" = "/absolute/path/to/facebook-marketplace-mcp/.local/facebook-session.json"

```

## Tools

### `search_listings`

Search Marketplace by query, location, and filters.

| Parameter   | Type   | Required | Description                 |
| ----------- | ------ | -------- | --------------------------- |
| `query`     | string | yes      | Search term                 |
| `latitude`  | number | yes      | Latitude of search center   |
| `longitude` | number | yes      | Longitude of search center  |
| `radius_km` | number | no       | Search radius (default: 50) |
| `min_price` | number | no       | Min price in dollars        |
| `max_price` | number | no       | Max price in dollars        |
| `category`  | string | no       | Category ID                 |
| `limit`     | number | no       | Max results (default: 20)   |

### `get_listing`

Get full details for a specific listing.

| Parameter    | Type   | Required | Description            |
| ------------ | ------ | -------- | ---------------------- |
| `listing_id` | string | yes      | Marketplace listing ID |

### `search_location`

Look up a city, neighborhood, or ZIP code to get coordinates for
`search_listings`.

| Parameter | Type   | Required | Description                                   |
| --------- | ------ | -------- | --------------------------------------------- |
| `query`   | string | yes      | Location text, such as `Boston MA` or `02108` |

### `monitor_search`

Save a search as a monitor to track new listings over time.

| Parameter   | Type   | Required | Description          |
| ----------- | ------ | -------- | -------------------- |
| `name`      | string | yes      | Monitor name         |
| `query`     | string | yes      | Search term          |
| `latitude`  | number | yes      | Search center lat    |
| `longitude` | number | yes      | Search center lng    |
| `radius_km` | number | no       | Radius (default: 50) |
| `min_price` | number | no       | Min price            |
| `max_price` | number | no       | Max price            |

### `check_monitors`

Check monitors for new listings since last check.

| Parameter      | Type   | Required | Description                             |
| -------------- | ------ | -------- | --------------------------------------- |
| `monitor_name` | string | no       | Check specific monitor, or omit for all |

### `list_monitors`

List all saved monitors.

### `delete_monitor`

Delete a saved monitor.

## Configuration

| Env Variable            | Default   | Description                                                        |
| ----------------------- | --------- | ------------------------------------------------------------------ |
| `CHROME_PROFILE`        | `Default` | Chrome profile directory name                                      |
| `FACEBOOK_SESSION_FILE` | unset     | Absolute path to a JSON cookie file; used before Chrome extraction |

### Cookie file authentication

If Keychain access is unavailable, create a local JSON file with cookies copied
from Chrome's Facebook cookie storage. The file may be either a JSON array or
an object containing a `cookies` array. `c_user` and `xs` are required; `datr`,
`fr`, and `sb` are recommended when present. Chrome-style fields such as
`domain`, `path`, `expirationDate`, `secure`, and `httpOnly` are accepted.

```json
{
  "cookies": [
    {
      "name": "c_user",
      "value": "YOUR_USER_ID",
      "domain": ".facebook.com",
      "path": "/",
      "secure": true,
      "httpOnly": true
    },
    {
      "name": "xs",
      "value": "YOUR_SESSION_VALUE",
      "domain": ".facebook.com",
      "path": "/",
      "secure": true,
      "httpOnly": true
    }
  ]
}
```

Keep this file out of version control and restrict it to your account, for
example `chmod 600 .local/facebook-session.json`. When the file is valid, the
server does not access Chrome or Keychain. If the file cannot be read or does
not contain an active Facebook session, it falls back to `CHROME_PROFILE`.
Restart the MCP server after replacing the file; cookies and page tokens are
kept in memory for the running process.

## Updating GraphQL Queries

Facebook rotates their `doc_id` values on deploys. If searches stop working:

```bash
npm install -D playwright
npx playwright install chromium
npm run capture-queries
```

This opens a browser, navigates Marketplace, and captures current query IDs. Update `src/facebook/queries.ts` with the new values.

## Verification

```bash
npm test
npm run build
```

### MCP Inspector

Use the Inspector's browser interface to explore and invoke the local stdio
server:

```bash
npm run inspector
```

## Rate Limiting

The server self-rate-limits to 3 requests/minute with random jitter to avoid detection. This means searches take a few seconds.

## Limitations

- **macOS only** for automatic cookie extraction
- **Requires Chrome** with active Facebook session
- **Facebook ToS** — automating Facebook violates their Terms of Service
- **Fragile** — `doc_id` values change on Facebook deploys
- **Rate limited** — aggressive use may trigger CAPTCHAs or account flags
- **No write operations** — search/read only, no messaging or listing creation
