# Facebook Marketplace MCP Server — Design

## Summary

An MCP server that exposes Facebook Marketplace search and listing data via direct GraphQL API calls. No browser automation at runtime — speaks Facebook's internal protocol directly (similar to how pypush reverse-engineered iMessage).

Users authenticate via automatic Chrome cookie extraction on macOS. Includes saved search monitoring for deal alerts.

## Requirements

- **Search/browse** listings by query, location, radius, price, category
- **Get listing details** by ID
- **Monitor saved searches** — persist queries, return only new listings on check
- **macOS only** for cookie extraction
- **Automated auth** — read Chrome cookie DB, decrypt via Keychain

## Architecture

```
MCP Client (stdio) → MCP Server → Facebook GraphQL Client → POST /api/graphql/
                                 → Auth Layer (Chrome SQLite + Keychain decrypt)
                                 → Monitor Storage (~/.fb-marketplace/monitors.json)
```

### Approach

Direct GraphQL over HTTP. Facebook's web client makes all Marketplace requests as `POST /api/graphql/` with:
- `doc_id` (query hash identifying the GraphQL operation)
- `variables` (JSON query parameters)
- `fb_dtsg`, `lsd`, `jazoest` (CSRF/session tokens from page HTML)
- Session cookies (`c_user`, `xs`, `datr`, `fr`)

We replay these requests directly — no browser needed at runtime.

## MCP Tools

### `search_listings`
- **Inputs**: `query`, `latitude`, `longitude`, `radius_km` (default 50), `min_price?`, `max_price?`, `category?`, `limit` (default 20)
- **Output**: Array of `{ id, title, price, location, image_url, seller_name, posted_date, url }`

### `get_listing`
- **Inputs**: `listing_id`
- **Output**: `{ id, title, description, price, images[], location, seller: { name, profile_url }, condition, posted_date, url }`

### `monitor_search`
- **Inputs**: `name`, `query`, `latitude`, `longitude`, `radius_km`, `min_price?`, `max_price?`, `category?`
- **Output**: `{ monitor_id, message }`

### `check_monitors`
- **Inputs**: `monitor_name?` (optional — check one or all)
- **Output**: Array of `{ monitor_name, new_listings: [...] }` — only unseen listings

## Auth Flow

1. Read Chrome `Cookies` SQLite DB: `~/Library/Application Support/Google/Chrome/Default/Cookies`
2. Decrypt via macOS Keychain: `security find-generic-password -s "Chrome Safe Storage" -w`
3. AES-CBC decrypt cookie values using PBKDF2-derived key (Chrome's encryption scheme)
4. Extract `facebook.com` cookies: `c_user`, `xs`, `datr`, `fr`, `sb`
5. Fetch `facebook.com/marketplace/` to extract `fb_dtsg`, `lsd`, `jazoest` from HTML
6. Cache tokens in memory, re-extract on auth failure
7. Fallback: manual cookie paste if Chrome extraction fails

## File Structure

```
facebook-marketplace-mcp/
├── src/
│   ├── index.ts              # MCP server (stdio transport)
│   ├── facebook/
│   │   ├── client.ts         # GraphQL HTTP client
│   │   ├── auth.ts           # Cookie extraction + token management
│   │   ├── queries.ts        # GraphQL doc_ids and query builders
│   │   ├── parser.ts         # Response normalization
│   │   └── types.ts          # TypeScript types
│   ├── tools/
│   │   ├── search.ts         # search_listings
│   │   ├── listing.ts        # get_listing
│   │   └── monitor.ts        # monitor_search + check_monitors
│   ├── storage/
│   │   └── monitors.ts       # JSON file persistence
│   └── utils/
│       └── rate-limit.ts     # Request throttling
├── scripts/
│   └── capture-queries.ts    # Discover/update GraphQL doc_ids via Playwright
├── package.json
├── tsconfig.json
└── README.md
```

## Rate Limiting & Anti-Detection

- Max 3 req/min default (configurable)
- Random jitter 1-3s between requests
- Match User-Agent to Chrome version
- On 401: pause, refresh tokens, retry once
- On CAPTCHA/block: stop, return MCP error

## Query Discovery

`scripts/capture-queries.ts` launches Playwright with Chrome profile, intercepts `/api/graphql/` traffic while browsing Marketplace, and records `doc_id` → operation name mappings. Run when queries break after a Facebook deploy.

## Risks

- **ToS**: Automating Facebook violates their Terms of Service. Account ban risk.
- **Fragility**: `doc_id` values change on Facebook deploys. Query discovery script mitigates this.
- **Token rotation**: `fb_dtsg` rotates per session. Re-extracted automatically on auth errors.
- **Rate limits**: Facebook throttles aggressive scraping. Self-rate-limiting mitigates.
