#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FacebookClient } from "./facebook/client.js";
import { DEFAULT_FACEBOOK_SESSION_FILE } from "./facebook/auth.js";
import {
  createCheckMonitorsHandler,
  createCreateMonitorHandler,
  createDeleteMonitorHandler,
  createListMonitorsHandler,
} from "./tools/monitor.js";
import {
  checkMonitorsInput,
  checkMonitorsOutput,
  createMonitorInput,
  createMonitorOutput,
  deleteMonitorInput,
  deleteMonitorOutput,
  getListingInput,
  listingOutput,
  listMonitorsInput,
  listMonitorsOutput,
  locationsOutput,
  searchListingsInput,
  searchListingsOutput,
  searchLocationsInput,
} from "./mcp/contracts.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createGetListingHandler,
  createSearchListingsHandler,
} from "./tools/listing.js";
import { createSearchLocationsHandler } from "./tools/location.js";
import { localMonitorStore } from "./mcp/monitor-store.js";

const client = new FacebookClient({
  maxRequestsPerMinute: 3,
  chromeProfile: process.env.CHROME_PROFILE ?? "Profile 1",
  sessionFile: process.env.FACEBOOK_SESSION_FILE ?? DEFAULT_FACEBOOK_SESSION_FILE,
});

const monitorStore = localMonitorStore;

const server = new McpServer({
  name: "facebook-marketplace",
  version: "1.0.0",
});

// Search listings
server.registerTool(
  "facebook_marketplace_search_listings",
  {
    title: "Search Facebook Marketplace listings",
    description:
      "Search Marketplace listings by text, location, filters, and an optional continuation cursor.",
    inputSchema: searchListingsInput,
    outputSchema: searchListingsOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  createSearchListingsHandler(client),
);

// Get listing details
server.registerTool(
  "facebook_marketplace_get_listing",
  {
    title: "Get a Facebook Marketplace listing",
    description:
      "Get details, seller information, and images for one Marketplace listing.",
    inputSchema: getListingInput,
    outputSchema: listingOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  createGetListingHandler(client),
);

// Search for a location (get coordinates)
server.registerTool(
  "facebook_marketplace_search_locations",
  {
    title: "Search Marketplace locations",
    description:
      "Resolve a city, neighborhood, or ZIP code to coordinates for a Marketplace search.",
    inputSchema: searchLocationsInput,
    outputSchema: locationsOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  createSearchLocationsHandler(client),
);

// Save a search monitor
server.registerTool(
  "facebook_marketplace_create_monitor",
  {
    title: "Create a Marketplace monitor",
    description:
      "Persist a Marketplace search locally and use it to detect new listings later.",
    inputSchema: createMonitorInput,
    outputSchema: createMonitorOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  createCreateMonitorHandler(monitorStore),
);

// Check monitors for new listings
server.registerTool(
  "facebook_marketplace_check_monitors",
  {
    title: "Check Marketplace monitors",
    description:
      "Search saved monitors and record newly observed listing IDs locally.",
    inputSchema: checkMonitorsInput,
    outputSchema: checkMonitorsOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  createCheckMonitorsHandler(client, monitorStore),
);

// Delete a monitor
server.registerTool(
  "facebook_marketplace_delete_monitor",
  {
    title: "Delete a Marketplace monitor",
    description: "Permanently delete one locally saved Marketplace monitor.",
    inputSchema: deleteMonitorInput,
    outputSchema: deleteMonitorOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  createDeleteMonitorHandler(monitorStore),
);

// List all monitors
server.registerTool(
  "facebook_marketplace_list_monitors",
  {
    title: "List Marketplace monitors",
    description:
      "List locally saved Marketplace monitors and their check state.",
    inputSchema: listMonitorsInput,
    outputSchema: listMonitorsOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  createListMonitorsHandler(monitorStore),
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
