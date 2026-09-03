import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  MarketplaceRequestError,
  recordToolFailure,
  toolErrorResponse,
  type ToolFailureRecord,
} from "../src/utils/diagnostics.js";
import { createSearchListingsHandler } from "../src/mcp/tools/listings.js";
import type { MarketplaceService } from "../src/mcp/types.js";

async function withDiagnosticFile(run: (logPath: string) => Promise<void>) {
  const directory = await mkdtemp(
    join(tmpdir(), "marketplace-diagnostics-test-"),
  );
  try {
    await run(join(directory, "nested", "mcp-errors.jsonl"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("records sanitized tool failures with Facebook request context", async () => {
  await withDiagnosticFile(async (logPath) => {
    const correlationId = await recordToolFailure(
      "facebook_marketplace_search_listings",
      {
        query: "desk",
        Cookie: "c_user=private-user; xs=private-session",
        nested: {
          authorization: "Bearer private-token",
          requestBody: "raw body",
        },
      },
      new MarketplaceRequestError("GraphQL request failed: 500", {
        operation: "graphql",
        method: "POST",
        path: "/api/graphql/",
        docId: "123",
        status: 500,
      }),
      { logPath },
    );

    const [line] = (await readFile(logPath, "utf8")).trim().split("\n");
    const record = JSON.parse(line) as ToolFailureRecord;

    assert.equal(record.correlationId, correlationId);
    assert.equal(record.tool, "facebook_marketplace_search_listings");
    assert.deepEqual(record.error.request, {
      operation: "graphql",
      method: "POST",
      path: "/api/graphql/",
      docId: "123",
      status: 500,
    });
    assert.equal(JSON.stringify(record).includes("private-user"), false);
    assert.equal(JSON.stringify(record).includes("private-session"), false);
    assert.equal(JSON.stringify(record).includes("private-token"), false);
    assert.equal(JSON.stringify(record).includes("raw body"), false);
  });
});

test("keeps raw response text out of the log and exposes a correlation ID", async () => {
  await withDiagnosticFile(async (logPath) => {
    const previousPath = process.env.MCP_ERROR_LOG_PATH;
    process.env.MCP_ERROR_LOG_PATH = logPath;
    try {
      const response = await toolErrorResponse(
        "facebook_marketplace_search_locations",
        { query: "Boston" },
        new Error("<html><body>c_user=private-cookie</body></html>"),
        "Error searching locations",
      );
      const text = response.content[0].text;
      const diagnosticId = text.match(/diagnostic ID: ([^)]+)/)?.[1];
      const log = await readFile(logPath, "utf8");

      assert.match(text, /Error searching locations/);
      assert.ok(diagnosticId);
      assert.equal(log.includes("private-cookie"), false);
      assert.match(log, /\[REDACTED RAW CONTENT\]/);
    } finally {
      if (previousPath === undefined) delete process.env.MCP_ERROR_LOG_PATH;
      else process.env.MCP_ERROR_LOG_PATH = previousPath;
    }
  });
});

test("tool handlers preserve MCP errors while recording a correlation ID", async () => {
  await withDiagnosticFile(async (logPath) => {
    const previousPath = process.env.MCP_ERROR_LOG_PATH;
    process.env.MCP_ERROR_LOG_PATH = logPath;
    try {
      const client: MarketplaceService = {
        searchListings: async () => {
          throw new MarketplaceRequestError("GraphQL request failed: 429", {
            operation: "graphql",
            method: "POST",
            path: "/api/graphql/",
            docId: "123",
            status: 429,
          });
        },
        getListingDetail: async () => {
          throw new Error("not used");
        },
        searchLocation: async () => [],
      };
      const result = await createSearchListingsHandler(client)({
        query: "desk",
        latitude: 42.36,
        longitude: -71.06,
        radius_km: 50,
        limit: 20,
        response_format: "markdown",
      });

      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /diagnostic ID: [^)]+/);
      const [line] = (await readFile(logPath, "utf8")).trim().split("\n");
      assert.equal(
        (JSON.parse(line) as ToolFailureRecord).tool,
        "facebook_marketplace_search_listings",
      );
    } finally {
      if (previousPath === undefined) delete process.env.MCP_ERROR_LOG_PATH;
      else process.env.MCP_ERROR_LOG_PATH = previousPath;
    }
  });
});
