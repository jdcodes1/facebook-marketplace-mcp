#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FacebookClient } from "./facebook/client.js";
import { searchListingsSchema, createSearchHandler } from "./tools/search.js";
import { getListingSchema, createListingHandler } from "./tools/listing.js";
import {
  searchLocationSchema,
  createLocationHandler,
} from "./tools/location.js";
import {
  monitorSearchSchema,
  checkMonitorsSchema,
  deleteMonitorSchema,
  listMonitorsSchema,
  createMonitorSearchHandler,
  createCheckMonitorsHandler,
  createDeleteMonitorHandler,
  createListMonitorsHandler,
} from "./tools/monitor.js";

const client = new FacebookClient({
  maxRequestsPerMinute: 3,
  chromeProfile: process.env.CHROME_PROFILE ?? "Default",
});

const server = new McpServer({
  name: "facebook-marketplace",
  version: "1.0.0",
});

// Search listings
server.tool(
  "search_listings",
  "Search Facebook Marketplace listings by query, location, and filters",
  searchListingsSchema,
  createSearchHandler(client)
);

// Get listing details
server.tool(
  "get_listing",
  "Get full details for a specific Facebook Marketplace listing",
  getListingSchema,
  createListingHandler(client)
);

// Search for a location (get coordinates)
server.tool(
  "search_location",
  "Look up a city/town name to get coordinates for use with search_listings",
  searchLocationSchema,
  createLocationHandler(client)
);

// Save a search monitor
server.tool(
  "monitor_search",
  "Save a search query as a monitor to track new listings over time",
  monitorSearchSchema,
  createMonitorSearchHandler()
);

// Check monitors for new listings
server.tool(
  "check_monitors",
  "Check saved monitors for new listings since last check",
  checkMonitorsSchema,
  createCheckMonitorsHandler(client)
);

// Delete a monitor
server.tool(
  "delete_monitor",
  "Delete a saved search monitor",
  deleteMonitorSchema,
  createDeleteMonitorHandler()
);

// List all monitors
server.tool(
  "list_monitors",
  "List all saved search monitors",
  listMonitorsSchema,
  createListMonitorsHandler()
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
