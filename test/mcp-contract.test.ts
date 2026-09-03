import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMarketplaceServer } from "../src/mcp/server.js";
import type { MarketplaceService, MonitorStore } from "../src/mcp/types.js";

const service: MarketplaceService = {
  async searchListings() {
    return {
      listings: [{ id: "listing-1", title: "Desk chair", price: "$35", location: "Boston, MA", imageUrl: "https://image.example/chair", sellerName: "Ada", postedDate: "today", url: "https://www.facebook.com/marketplace/item/listing-1/", isPending: false }],
      hasNextPage: true, endCursor: "cursor-2",
    };
  },
  async getListingDetail() {
    throw new Error("not used in this test");
  },
  async searchLocation() {
    return [{ name: "Boston, MA", latitude: 42.36, longitude: -71.06 }];
  },
};

function monitorStore(): MonitorStore {
  return {
    add(name, params) {
      return { id: "monitor-1", name, params, seenIds: [], createdAt: "2026-01-01T00:00:00.000Z", lastChecked: null };
    },
    list: () => [], get: () => undefined, updateSeenIds: () => undefined, delete: () => false,
  };
}

async function connectedServer() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMarketplaceServer(service, monitorStore());
  const client = new Client({ name: "marketplace-contract-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("publishes the modern prefixed tool contract with annotations and schemas", async () => {
  const { client, server } = await connectedServer();
  try {
    const tools = await client.listTools();
    assert.equal(client.getServerVersion()?.name, "facebook-marketplace-mcp-server");
    assert.deepEqual(tools.tools.map((tool) => tool.name), [
      "facebook_marketplace_search_listings", "facebook_marketplace_get_listing",
      "facebook_marketplace_search_locations", "facebook_marketplace_create_monitor",
      "facebook_marketplace_check_monitors", "facebook_marketplace_delete_monitor",
      "facebook_marketplace_list_monitors",
    ]);
    assert.equal(tools.tools.some((tool) => tool.name === "search_listings"), false);
    for (const tool of tools.tools) {
      assert.ok(tool.description);
      assert.ok(tool.outputSchema);
      assert.ok(tool.annotations);
    }
    const deletion = tools.tools.find((tool) => tool.name === "facebook_marketplace_delete_monitor");
    assert.equal(deletion?.annotations?.destructiveHint, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("returns validated structured content and JSON text for listing search", async () => {
  const { client, server } = await connectedServer();
  try {
    const result = await client.callTool({
      name: "facebook_marketplace_search_listings",
      arguments: { query: "chair", latitude: 42.36, longitude: -71.06, response_format: "json" },
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      query: "chair", count: 1, listings: [{ id: "listing-1", title: "Desk chair", price: "$35", location: "Boston, MA", image_url: "https://image.example/chair", seller_name: "Ada", posted_date: "today", url: "https://www.facebook.com/marketplace/item/listing-1/", is_pending: false }],
      has_more: true, next_cursor: "cursor-2", truncated: false,
    });
    assert.match((result.content[0] as { type: "text"; text: string }).text, /"next_cursor": "cursor-2"/);
  } finally {
    await client.close();
    await server.close();
  }
});

test("rejects unknown properties and invalid price ranges before invoking Marketplace", async () => {
  const { client, server } = await connectedServer();
  try {
    const extraProperty = await client.callTool({ name: "facebook_marketplace_search_locations", arguments: { query: "Boston", extra: true } });
    assert.equal(extraProperty.isError, true);
    const invalidRange = await client.callTool({ name: "facebook_marketplace_search_listings", arguments: { query: "desk", latitude: 42, longitude: -71, min_price: 50, max_price: 10 } });
    assert.equal(invalidRange.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});
