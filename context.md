# Facebook Marketplace MCP Server — Context

## Architecture
Direct GraphQL API replay (no browser at runtime). Speaks Facebook's internal `/api/graphql/` protocol using session cookies extracted from Chrome on macOS.

## Key Files
- `src/index.ts` — MCP server entry point (stdio transport)
- `src/facebook/client.ts` — GraphQL HTTP client, session management, token extraction
- `src/facebook/auth.ts` — Chrome cookie extraction (SQLite + Keychain decrypt)
- `src/facebook/queries.ts` — Known `doc_id` values for Marketplace GraphQL operations
- `src/facebook/parser.ts` — Response normalization for search results and listing details
- `src/tools/` — MCP tool handlers (search, listing, monitor)
- `src/storage/monitors.ts` — JSON file persistence for saved search monitors (~/.fb-marketplace/)
- `scripts/capture-queries.ts` — Playwright-based script to discover new GraphQL doc_ids

## Fragility Points
- `doc_id` values change when Facebook deploys (use capture-queries script to update)
- `fb_dtsg` token rotates per session (auto-refreshed on auth errors)
- Facebook DOM structure changes affect listing detail parsing
- Rate limiting: 3 req/min default to avoid detection

## Dependencies
- `@modelcontextprotocol/sdk` — MCP server framework
- `better-sqlite3` — Chrome cookie DB access
- `zod` — Tool schema validation

## Cookie Encryption (macOS Chrome)
- AES-128-CBC, PBKDF2 with SHA-1, salt="saltysalt", 1003 iterations
- Key from Keychain: `security find-generic-password -w -s "Chrome Safe Storage" -a "Chrome"`
- IV: 16 space characters, encrypted values prefixed with "v10"
