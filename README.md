# Facebook Marketplace MCP Server

An MCP server that provides access to Facebook Marketplace via direct GraphQL API calls. No browser automation at runtime — speaks Facebook's internal protocol directly.

## How It Works

Facebook's web client makes all Marketplace requests as `POST /api/graphql/` with a `doc_id` (query hash) and `variables`. This server replays those requests using your existing Facebook session cookies, read directly from your browser's local cookie store.

**Think of it like [pypush](https://github.com/JJTech0130/pypush) for iMessage — direct protocol, no browser.**

## Prerequisites

- **Node.js 20 or later** (see [Node version notes](#node-version-notes) below)
- **A Chromium-based browser** — Google Chrome, Microsoft Edge, or Brave — with an active Facebook login
- **macOS or Windows** (see [Platform support](#platform-support))

## Platform Support

Cookie extraction reads and decrypts your browser's local cookie database directly, so the implementation is platform-specific:

| Platform | Status | Notes |
|----------|--------|-------|
| **macOS** | Supported | Decryption key comes from the macOS Keychain (`security find-generic-password`). The first run prompts you to allow Keychain access. |
| **Windows** | Supported | The decryption key is DPAPI-protected in the browser's `Local State` file; it's unprotected via PowerShell's `System.Security.Cryptography.ProtectedData` (`CurrentUser` scope), which requires PowerShell to be on `PATH` (default on Windows). Cookie values use AES-256-GCM (Chrome 80+) with a DPAPI-direct fallback for older cookie stores. |
| **Linux** | Not supported | Chromium on Linux typically encrypts cookies with a fixed/basic password (or none) rather than an OS keystore — not yet implemented. Contributions welcome. |

Supported browsers on both platforms: **Chrome**, **Edge**, **Brave** (all Chromium-based and share the same cookie DB format). Select one with the `BROWSER` env var — see [Configuration](#configuration).

## Installation

```bash
git clone <this-repo>
cd facebook-marketplace-mcp
npm install
npm run build
```

### Node version notes

- Requires **Node.js 20+** (declared in `package.json` under `engines`).
- `better-sqlite3` ships prebuilt native binaries per Node ABI/platform. If `npm install` tries to compile from source (e.g. on a very new Node version without a prebuild yet), you'll need a C++ build toolchain (Xcode Command Line Tools on macOS, or Visual Studio Build Tools with the "Desktop development with C++" workload on Windows).
- Check your version with `node --version`; use [nvm](https://github.com/nvm-sh/nvm) (macOS/Linux) or [nvm-windows](https://github.com/coreybutler/nvm-windows) to switch if needed.

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
        "BROWSER": "chrome"
      }
    }
  }
}
```

On Windows, use a Windows-style path in `args` (e.g. `"D:\\facebook-marketplace-mcp\\dist\\index.js"`).

## Tools

### `search_listings`
Search Marketplace by query, location, and filters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search term |
| `latitude` | number | yes | Latitude of search center |
| `longitude` | number | yes | Longitude of search center |
| `radius_km` | number | no | Search radius (default: 50) |
| `min_price` | number | no | Min price, in the marketplace's local currency |
| `max_price` | number | no | Max price, in the marketplace's local currency |
| `category` | string | no | Category ID |
| `limit` | number | no | Max results (default: 20) |

### `search_location`
Look up a city/town name to get coordinates for use with `search_listings`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Location search query (e.g. `"Karachi, Pakistan"`, `"Dedham MA"`) |

### `get_listing`
Get full details for a specific listing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `listing_id` | string | yes | Marketplace listing ID |

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

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `CHROME_PROFILE` | `Default` | Browser profile directory name (e.g. `Default`, `Profile 1`) |
| `BROWSER` | `chrome` | Which Chromium browser to read cookies from: `chrome`, `edge`, or `brave` |

## Updating GraphQL Queries

Facebook rotates their `doc_id` values on deploys. If searches stop working:

```bash
npm install -D playwright
npx playwright install chromium
npm run capture-queries
```

This opens a browser, navigates Marketplace, and captures current query IDs. Update `src/facebook/queries.ts` with the new values.

## Rate Limiting

The server self-rate-limits to 3 requests/minute with random jitter to avoid detection. This means searches take a few seconds.

## Troubleshooting

- **"Could not find `<Browser>` cookie database..."** — The selected `BROWSER`/`CHROME_PROFILE` combination doesn't exist on disk. The error lists any profiles it did find; set `CHROME_PROFILE` to one of those.
- **"No Facebook cookies found"** — Log into Facebook in the configured browser first, then retry.
- **"Failed to decrypt DPAPI-protected data via PowerShell" (Windows)** — Make sure `powershell.exe` is on `PATH` and that you're running the MCP server as the same Windows user that's logged into the browser (DPAPI keys are per-user).
- **"Failed to get `<Browser>` password from Keychain" (macOS)** — Approve the Keychain access prompt when it appears; if you denied it previously, remove and re-approve it via Keychain Access.
- **Session expired errors** — Cookies were extracted but Facebook rejected them; log into Facebook again in the browser and retry.

## Limitations

- **macOS and Windows only** for automatic cookie extraction (no Linux support yet)
- **Requires Chrome, Edge, or Brave** with an active Facebook session
- **Facebook ToS** — automating Facebook violates their Terms of Service
- **Fragile** — `doc_id` values change on Facebook deploys
- **Rate limited** — aggressive use may trigger CAPTCHAs or account flags
- **No write operations** — search/read only, no messaging or listing creation
