import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FacebookClient } from "../src/facebook/client.js";
import { loadFacebookSession } from "../src/facebook/auth.js";

const cookies = [
  { name: "c_user", value: "test-user", domain: ".facebook.com" },
  { name: "xs", value: "test-session", domain: ".facebook.com" },
];

test("uses saved browser identity for bootstrap, GraphQL, and listing requests", async () => {
  const directory = mkdtempSync(join(tmpdir(), "facebook-user-agent-"));
  const sessionFile = join(directory, "session.json");
  const previousFetch = globalThis.fetch;
  const headers: Headers[] = [];
  writeFileSync(
    sessionFile,
    JSON.stringify({ version: 1, cookies, userAgent: "Browser/150.0" }),
  );
  globalThis.fetch = async (_url, init) => {
    headers.push(new Headers(init?.headers));
    if (headers.length === 1)
      return new Response('"dtsg":{"token":"test-token"}');
    if (headers.length === 2)
      return new Response(
        '{"data":{"marketplace_search":{"feed_units":{"edges":[],"page_info":{"has_next_page":false}}}}}',
      );
    return new Response("", { status: 404 });
  };
  try {
    const client = new FacebookClient({
      sessionFile,
      maxRequestsPerMinute: 1000,
    });
    await client.searchListings({
      query: "desk",
      latitude: 42,
      longitude: -71,
      radiusKm: 50,
      limit: 1,
    });
    await assert.rejects(client.getListingDetail("123"), /404/);
    assert.equal(headers.length, 3);
    for (const header of headers) {
      assert.equal(header.get("user-agent"), "Browser/150.0");
      assert.equal(header.has("sec-ch-ua"), false);
      assert.equal(header.has("sec-ch-ua-platform"), false);
      assert.equal(header.has("sec-ch-ua-mobile"), false);
    }
  } finally {
    globalThis.fetch = previousFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects legacy sessions and invalid user agents before making requests", async () => {
  const directory = mkdtempSync(join(tmpdir(), "facebook-user-agent-"));
  const sessionFile = join(directory, "session.json");
  const previousFetch = globalThis.fetch;
  try {
    for (const content of [
      cookies,
      { version: 1, cookies },
      ...["", "  ", 123, "bad\r\nInjected: value", "☃"].map((userAgent) => ({
        version: 1,
        cookies,
        userAgent,
      })),
    ]) {
      writeFileSync(sessionFile, JSON.stringify(content));
      assert.throws(() => loadFacebookSession({ sessionFile }), /npm run login/);
      globalThis.fetch = async () => { throw new Error("Unexpected request"); };
      await assert.rejects(new FacebookClient({ sessionFile }).initSession(), /npm run login/);
    }
  } finally {
    globalThis.fetch = previousFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});
