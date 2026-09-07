import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FacebookClient } from "../src/facebook/client.js";
import { MARKETPLACE_SEARCH_DOC_ID } from "../src/facebook/queries.js";
import { createSearchListingsHandler } from "../src/tools/listing.js";
import { MarketplaceRequestError } from "../src/utils/diagnostics.js";

const params = {
  query: "desk",
  latitude: 42,
  longitude: -71,
  radiusKm: 50,
  limit: 20,
};
const validData = {
  marketplace_search: {
    feed_units: {
      edges: [
        {
          node: {
            listing: { id: "listing-1", marketplace_listing_title: "Desk" },
          },
        },
      ],
      page_info: { has_next_page: true, end_cursor: "next" },
    },
  },
};

async function withResponse(
  body: string,
  run: (
    client: FacebookClient,
    logPath: string,
    directory: string,
  ) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "marketplace-client-test-"));
  const logPath = join(directory, "mcp-errors.jsonl");
  const previousFetch = globalThis.fetch;
  const previousLogPath = process.env.MCP_ERROR_LOG_PATH;
  process.env.MCP_ERROR_LOG_PATH = logPath;
  globalThis.fetch = async () => new Response(body, { status: 200 });
  const client = new FacebookClient();
  client.ensureSession = async () => ({
    cookies: [],
    cookieHeader: "c_user=private-user; xs=private-cookie",
    userId: "private-user",
    fbDtsg: "private-token",
    lsd: "private-lsd",
    jazoest: "",
    clientRevision: "1",
  });
  try {
    await run(client, logPath, directory);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousLogPath === undefined) delete process.env.MCP_ERROR_LOG_PATH;
    else process.env.MCP_ERROR_LOG_PATH = previousLogPath;
    await rm(directory, { recursive: true, force: true });
  }
}

test("rejects HTTP 200 error-only responses and malformed GraphQL envelopes", async () => {
  for (const body of [
    JSON.stringify({
      errors: [{ message: "private-provider-message", code: 123 }],
    }),
    JSON.stringify({
      error: 1357004,
      errorDescription: "private-provider-message",
    }),
    JSON.stringify({ errors: [{ code: 123 }], data: null }),
    JSON.stringify({ data: null }),
    JSON.stringify({ data: [] }),
    JSON.stringify({ data: "invalid" }),
    JSON.stringify({}),
    "null",
    "[]",
    '"invalid"',
    "42",
    "not JSON",
    '{"data":',
    '<html>{"data":{}}</html>',
  ]) {
    await withResponse(body, async (client) => {
      await assert.rejects(client.searchListings(params), (error: unknown) => {
        assert.ok(error instanceof MarketplaceRequestError);
        assert.equal(error.request.operation, "graphql");
        assert.equal(error.request.docId, MARKETPLACE_SEARCH_DOC_ID);
        assert.equal(error.request.status, 200);
        assert.equal(error.request.responseBytes, Buffer.byteLength(body));
        assert.equal(error.message.includes("private-provider-message"), false);
        return true;
      });
    });
  }
});

test("accepts valid JSON and Facebook's anti-JSONP prefix without logging warnings", async () => {
  for (const prefix of ["", "for (;;);", "  for(;;);\n"]) {
    await withResponse(
      prefix + JSON.stringify({ data: validData, errors: [], error: 0 }),
      async (client, logPath) => {
        const result = await client.searchListings(params);
        assert.equal(result.listings[0].id, "listing-1");
        assert.equal(result.hasNextPage, true);
        await assert.rejects(readFile(logPath), { code: "ENOENT" });
      },
    );
  }
});

test("logs only safe summaries of provider errors while retaining partial listing data", async () => {
  const body = JSON.stringify({
    data: validData,
    errors: [
      {
        message: "private-provider-message",
        code: 123,
        extensions: { code: 456, token: "private-extension" },
      },
      { message: "private-message-two", code: "private-code", error_code: 789 },
    ],
    error: 1357004,
    errorDescription: "private-top-level-description",
  });
  await withResponse(body, async (client, logPath) => {
    const result = await client.searchListings(params);
    assert.equal(result.listings[0].id, "listing-1");
    assert.equal(result.endCursor, "next");
    const text = await readFile(logPath, "utf8");
    const lines = text.trim().split("\n");
    assert.equal(lines.length, 1);
    const warning = JSON.parse(lines[0]);
    assert.equal(warning.level, "warning");
    assert.equal(warning.event, "graphql-provider-errors");
    assert.equal(warning.errorCount, 3);
    assert.deepEqual(warning.codes, [123, 456, 789, 1357004]);
    assert.deepEqual(warning.request, {
      operation: "graphql",
      method: "POST",
      path: "/api/graphql/",
      docId: MARKETPLACE_SEARCH_DOC_ID,
      status: 200,
      responseBytes: Buffer.byteLength(body),
    });
    assert.equal(text.includes("private-"), false);
    assert.equal(text.includes("listing-1"), false);
    assert.equal(text.includes("Desk"), false);
  });
});

test("supports object-shaped provider errors and excludes nonnumeric codes", async () => {
  await withResponse(
    JSON.stringify({
      data: validData,
      errors: { code: "private-code", message: "private-message" },
      error: { code: 123, error_code: 123 },
    }),
    async (client, logPath) => {
      assert.equal((await client.searchListings(params)).listings.length, 1);
      const warning = JSON.parse(await readFile(logPath, "utf8"));
      assert.equal(warning.errorCount, 2);
      assert.deepEqual(warning.codes, [123]);
    },
  );
});

test("rejects missing or malformed search connections with GraphQL request context", async () => {
  for (const data of [
    {},
    { marketplace_search: { feed_units: {} } },
    { marketplace_search: { feed_units: { edges: null } } },
    { marketplace_search: { feed_units: { edges: [{ node: null }] } } },
  ]) {
    await withResponse(
      JSON.stringify({ data, errors: [{ code: 123 }] }),
      async (client, logPath) => {
        await assert.rejects(
          client.searchListings(params),
          (error: unknown) => {
            assert.ok(error instanceof MarketplaceRequestError);
            assert.equal(error.request.docId, MARKETPLACE_SEARCH_DOC_ID);
            assert.equal(error.request.operation, "graphql");
            assert.ok(error.cause instanceof Error);
            return true;
          },
        );
        assert.equal(
          JSON.parse(await readFile(logPath, "utf8")).level,
          "warning",
        );
      },
    );
  }
});

test("valid empty partial searches remain successful", async () => {
  await withResponse(
    JSON.stringify({
      data: { marketplace_search: { feed_units: { edges: [] } } },
      errors: [{ code: 123 }],
    }),
    async (client, logPath) => {
      assert.deepEqual(await client.searchListings(params), {
        listings: [],
        hasNextPage: false,
        endCursor: null,
      });
      assert.equal(JSON.parse(await readFile(logPath, "utf8")).errorCount, 1);
    },
  );
});

test("warning log failures do not discard usable partial data", async () => {
  await withResponse(
    JSON.stringify({ data: validData, errors: [{ code: 123 }] }),
    async (client, _logPath, directory) => {
      // Appending to a directory fails on every platform without permission assumptions.
      process.env.MCP_ERROR_LOG_PATH = directory;
      assert.equal(
        (await client.searchListings(params)).listings[0].id,
        "listing-1",
      );
    },
  );
});

test("MCP reports parser failures with a diagnostic ID and preserves partial successes", async () => {
  for (const data of [{}, validData]) {
    await withResponse(
      JSON.stringify({
        data,
        errors: [{ message: "private-provider-message", code: 123 }],
      }),
      async (client, logPath) => {
        const result = await createSearchListingsHandler(client)({
          query: "desk",
          latitude: 42,
          longitude: -71,
          radius_km: 50,
          limit: 20,
          sort_by: "suggested",
          delivery_method: "all",
          date_listed: "all",
          response_format: "json",
        });
        const text = await readFile(logPath, "utf8");
        assert.equal(text.includes("private-"), false);
        const records = text
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        if (data === validData) {
          assert.ok(!("isError" in result) || !result.isError);
          assert.equal(records.length, 1);
        } else {
          assert.ok("isError" in result && result.isError);
          assert.match(result.content[0].text, /diagnostic ID:/);
          assert.equal(records.length, 2);
          const failure = records[1];
          assert.ok(result.content[0].text.includes(failure.correlationId));
          assert.equal(failure.error.request.docId, MARKETPLACE_SEARCH_DOC_ID);
        }
      },
    );
  }
});
