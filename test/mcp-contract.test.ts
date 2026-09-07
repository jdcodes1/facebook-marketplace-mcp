import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fileURLToPath } from "node:url";
import {
  searchListingsInput,
  searchListingsOutput,
} from "../src/mcp/contracts.js";
import { createSearchListingsHandler } from "../src/tools/listing.js";
import type { MarketplaceService } from "../src/mcp/types.js";

const service: MarketplaceService = {
  async searchListings() {
    return {
      listings: [
        {
          id: "listing-1",
          title: "Desk chair",
          price: "$35",
          location: "Boston, MA",
          imageUrl: "https://image.example/chair",
          sellerName: "Ada",
          postedDate: "today",
          url: "https://www.facebook.com/marketplace/item/listing-1/",
          isPending: false,
        },
      ],
      hasNextPage: true,
      endCursor: "cursor-2",
    };
  },
  async getListingDetail() {
    throw new Error("not used in this test");
  },
  async searchLocation() {
    return [{ name: "Boston, MA", latitude: 42.36, longitude: -71.06 }];
  },
};

async function connectedServer() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts"],
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stderr: "pipe",
  });
  const client = new Client({
    name: "marketplace-contract-test",
    version: "1.0.0",
  });
  await client.connect(transport);
  return { client, server: transport };
}

async function connectedSearchServer() {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "search-test", version: "1.0.0" });
  server.registerTool(
    "facebook_marketplace_search_listings",
    {
      inputSchema: searchListingsInput,
      outputSchema: searchListingsOutput,
    },
    createSearchListingsHandler(service),
  );
  const client = new Client({
    name: "marketplace-contract-test",
    version: "1.0.0",
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("publishes the modern prefixed tool contract with annotations and schemas", async () => {
  const { client, server } = await connectedServer();
  try {
    const tools = await client.listTools();
    assert.equal(client.getServerVersion()?.name, "facebook-marketplace");
    assert.deepEqual(
      tools.tools.map((tool) => tool.name),
      [
        "facebook_marketplace_search_listings",
        "facebook_marketplace_get_listing",
        "facebook_marketplace_search_locations",
        "facebook_marketplace_create_monitor",
        "facebook_marketplace_check_monitors",
        "facebook_marketplace_delete_monitor",
        "facebook_marketplace_list_monitors",
      ],
    );
    assert.equal(
      tools.tools.some((tool) => tool.name === "search_listings"),
      false,
    );
    for (const tool of tools.tools) {
      assert.ok(tool.description);
      assert.ok(tool.outputSchema);
      assert.ok(tool.annotations);
      assert.ok(
        Object.keys(tool.inputSchema.properties ?? {}).length > 0,
        `${tool.name} must publish input fields`,
      );
      assert.equal(tool.inputSchema.additionalProperties, false);
    }
    const search = tools.tools.find(
      (tool) => tool.name === "facebook_marketplace_search_listings",
    )!;
    assert.deepEqual(Object.keys(search.inputSchema.properties ?? {}), [
      "query",
      "latitude",
      "longitude",
      "radius_km",
      "min_price",
      "max_price",
      "category",
      "sort_by",
      "delivery_method",
      "date_listed",
      "limit",
      "cursor",
      "response_format",
    ]);
    assert.deepEqual(search.inputSchema.required, [
      "query",
      "latitude",
      "longitude",
    ]);
    const monitor = tools.tools.find(
      (tool) => tool.name === "facebook_marketplace_create_monitor",
    )!;
    assert.deepEqual(monitor.inputSchema.required, [
      "name",
      "query",
      "latitude",
      "longitude",
    ]);
    const deletion = tools.tools.find(
      (tool) => tool.name === "facebook_marketplace_delete_monitor",
    );
    assert.equal(deletion?.annotations?.destructiveHint, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("returns validated structured content and JSON text for listing search", async () => {
  const { client, server } = await connectedSearchServer();
  try {
    const result = await client.callTool({
      name: "facebook_marketplace_search_listings",
      arguments: {
        query: "chair",
        latitude: 42.36,
        longitude: -71.06,
        response_format: "json",
      },
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      query: "chair",
      count: 1,
      listings: [
        {
          id: "listing-1",
          title: "Desk chair",
          price: "$35",
          location: "Boston, MA",
          image_url: "https://image.example/chair",
          seller_name: "Ada",
          posted_date: "today",
          url: "https://www.facebook.com/marketplace/item/listing-1/",
          is_pending: false,
        },
      ],
      has_more: true,
      next_cursor: "cursor-2",
      truncated: false,
    });
    assert.match(
      (result.content[0] as { type: "text"; text: string }).text,
      /"next_cursor": "cursor-2"/,
    );
  } finally {
    await client.close();
    await server.close();
  }
});

test("rejects unknown properties and invalid price ranges before invoking Marketplace", async () => {
  const { client, server } = await connectedServer();
  try {
    const extraProperty = await client.callTool({
      name: "facebook_marketplace_search_locations",
      arguments: { query: "Boston", extra: true },
    });
    assert.equal(extraProperty.isError, true);
    const invalidRange = await client.callTool({
      name: "facebook_marketplace_search_listings",
      arguments: {
        query: "desk",
        latitude: 42,
        longitude: -71,
        min_price: 50,
        max_price: 10,
      },
    });
    assert.equal(invalidRange.isError, true);
    const invalidMonitorRange = await client.callTool({
      name: "facebook_marketplace_create_monitor",
      arguments: {
        name: "invalid-range-test",
        query: "desk",
        latitude: 42,
        longitude: -71,
        min_price: 50,
        max_price: 10,
      },
    });
    assert.equal(invalidMonitorRange.isError, true);
    assert.match(
      JSON.stringify(invalidMonitorRange.content),
      /min_price must not exceed max_price/,
    );
    assert.match(
      JSON.stringify(invalidRange.content),
      /min_price must not exceed max_price/,
    );
  } finally {
    await client.close();
    await server.close();
  }
});
