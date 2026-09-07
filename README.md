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
"FACEBOOK_SESSION_FILE" = "/absolute/path/to/facebook-marketplace-mcp/.local/facebook-session.json"

```

## Tools

### `facebook_marketplace_search_listings`

Search Marketplace by query, location, and filters.

| Parameter         | Type   | Required | Description                                                                                   |
| ----------------- | ------ | -------- | --------------------------------------------------------------------------------------------- |
| `query`           | string | yes      | Search term                                                                                   |
| `latitude`        | number | yes      | Latitude of search center                                                                     |
| `longitude`       | number | yes      | Longitude of search center                                                                    |
| `radius_km`       | number | no       | Search radius (default: 50)                                                                   |
| `min_price`       | number | no       | Min price in dollars                                                                          |
| `max_price`       | number | no       | Max price in dollars                                                                          |
| `category`        | string | no       | Category ID                                                                                   |
| `sort_by`         | string | no       | `suggested` (default), `distance`, `date_listed`, `price_low_to_high`, or `price_high_to_low` |
| `delivery_method` | string | no       | `all` (default), `local_pickup`, or `shipping`                                                |
| `date_listed`     | string | no       | `all` (default), `last_24_hours`, `last_7_days`, or `last_30_days`                            |
| `limit`           | number | no       | Max results (default: 20)                                                                     |

### `facebook_marketplace_get_listing`

Get full details for a specific listing.

| Parameter    | Type   | Required | Description            |
| ------------ | ------ | -------- | ---------------------- |
| `listing_id` | string | yes      | Marketplace listing ID |

### `facebook_marketplace_search_location`

Look up a city, neighborhood, or ZIP code to get coordinates for
`search_listings`.

| Parameter | Type   | Required | Description                                   |
| --------- | ------ | -------- | --------------------------------------------- |
| `query`   | string | yes      | Location text, such as `Boston MA` or `02108` |

### `facebook_marketplace_monitor_search`

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

### `facebook_marketplace_check_monitors`

Check monitors for new listings since last check.

| Parameter      | Type   | Required | Description                             |
| -------------- | ------ | -------- | --------------------------------------- |
| `monitor_name` | string | no       | Check specific monitor, or omit for all |

### `facebook_marketplace_list_monitors`

List all saved monitors.

### `facebook_marketplace_delete_monitor`

Delete a saved monitor.

## Configuration

| Env Variable               | Default                        | Description                                                 |
| -------------------------- | ------------------------------ | ----------------------------------------------------------- |
| `FACEBOOK_SESSION_FILE`    | `.local/facebook-session.json` | Login session snapshot path                                 |
| `MCP_ERROR_LOG_PATH`       | `.local/mcp-errors.jsonl`      | Alternate path for sanitized failed-tool diagnostics        |
| `MCP_CAPTURE_LISTING_HTML` | unset                          | Set to `1` to retain exact direct listing-page HTML locally |
| `MCP_LISTING_CAPTURE_DIR`  | `.local/listing-page-captures` | Alternate directory for opted-in raw HTML captures          |

### Failed-request diagnostics

Every failed MCP tool call is appended as a JSON line to
`.local/mcp-errors.jsonl`. The error returned by the tool includes a
`diagnostic ID`; search the file for that ID to inspect the matching record.
Set `MCP_ERROR_LOG_PATH` when the log should live elsewhere.

Records include the timestamp, tool, bounded input summary, error type/message,
and safe Facebook request metadata such as the operation, path, status, and
GraphQL document ID. They never include cookies, authorization or CSRF values,
page tokens, request bodies, raw headers, HTML, or response bodies. The server
continues returning the original MCP tool error if diagnostic writing fails.

### Opt-in raw listing-page captures

Set `MCP_CAPTURE_LISTING_HTML=1` to save the exact HTML response from every
direct listing-page request, including successful, login, block, and error
pages. Captures are written before response status handling and parsing, so
they can be compared later when Facebook markup changes.

Raw captures are separate from `mcp-errors.jsonl`, never appear in MCP output,
and are stored as `0600` files in a `0700` directory. They can contain private
Facebook page data, are not pruned automatically, and must not be committed or
shared. Set `MCP_LISTING_CAPTURE_DIR` to use another protected local directory;
remove captures manually when they are no longer needed. A capture-write failure
is reported only on stderr and does not alter the request result.

### Cookie file authentication

Run `npm run login` before starting the server. It saves Facebook cookies and
Chrome's user agent to `.local/facebook-session.json`. Set `FACEBOOK_SESSION_FILE`
to use another path. The server requires this login-generated session format,
including its browser user agent; cookie-only exports are not supported.

### Interactive login

When the session must be refreshed, run:

```bash
npm run login
```

This opens a visible, dedicated Chrome profile at
`.local/facebook-login-profile`. Complete Facebook login (including any
checkpoint), return to Marketplace, and press Enter in the terminal. The
command validates the Marketplace page and saves normalized cookies and the browser user agent to
`FACEBOOK_SESSION_FILE` or `.local/facebook-session.json`; page tokens are not
stored. It closes Chrome when it succeeds or fails, while retaining the private
login profile for the next interactive refresh.

The server writes snapshots atomically with owner-only directory and file
permissions, and refuses to overwrite symbolic links. Keep the file out of
version control. If it is missing, malformed, or expired, run `npm run login` again. Restart the
MCP server afterward to load the new cookies and browser user agent.

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
