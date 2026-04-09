import { z } from "zod";
import type { FacebookClient } from "../facebook/client.js";
import {
  addMonitor,
  loadMonitors,
  getMonitor,
  updateMonitorSeenIds,
  deleteMonitor,
} from "../storage/monitors.js";

export const monitorSearchSchema = {
  name: z.string().describe("Name for this saved search monitor"),
  query: z.string().describe("Search query"),
  latitude: z.number().describe("Latitude of search center"),
  longitude: z.number().describe("Longitude of search center"),
  radius_km: z.number().default(50).describe("Search radius in km"),
  min_price: z.number().optional().describe("Min price filter in dollars"),
  max_price: z.number().optional().describe("Max price filter in dollars"),
  category: z.string().optional().describe("Category ID"),
};

export const checkMonitorsSchema = {
  monitor_name: z
    .string()
    .optional()
    .describe("Check a specific monitor by name, or omit to check all"),
};

export const deleteMonitorSchema = {
  name: z.string().describe("Name of the monitor to delete"),
};

export const listMonitorsSchema = {};

export function createMonitorSearchHandler() {
  return async (args: {
    name: string;
    query: string;
    latitude: number;
    longitude: number;
    radius_km: number;
    min_price?: number;
    max_price?: number;
    category?: string;
  }) => {
    try {
      const monitor = addMonitor(args.name, {
        query: args.query,
        latitude: args.latitude,
        longitude: args.longitude,
        radiusKm: args.radius_km,
        minPrice: args.min_price,
        maxPrice: args.max_price,
        category: args.category,
        limit: 24,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Monitor "${monitor.name}" saved.\nID: ${monitor.id}\nQuery: "${args.query}" within ${args.radius_km}km\nUse check_monitors to check for new listings.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  };
}

export function createCheckMonitorsHandler(client: FacebookClient) {
  return async (args: { monitor_name?: string }) => {
    try {
      const monitors = args.monitor_name
        ? [getMonitor(args.monitor_name)].filter(Boolean)
        : loadMonitors();

      if (monitors.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: args.monitor_name
                ? `Monitor "${args.monitor_name}" not found.`
                : "No monitors saved. Use monitor_search to create one.",
            },
          ],
        };
      }

      const results: string[] = [];

      for (const monitor of monitors) {
        if (!monitor) continue;

        const searchResult = await client.searchListings(monitor.params);
        const newListings = searchResult.listings.filter(
          (l) => !monitor.seenIds.includes(l.id)
        );

        if (newListings.length > 0) {
          updateMonitorSeenIds(
            monitor.name,
            newListings.map((l) => l.id)
          );

          const listingSummary = newListings
            .map(
              (l, i) =>
                `  ${i + 1}. **${l.title}** — ${l.price}\n     📍 ${l.location}\n     🔗 ${l.url}`
            )
            .join("\n\n");

          results.push(
            `### 🔔 ${monitor.name} — ${newListings.length} new listing(s)\n\n${listingSummary}`
          );
        } else {
          updateMonitorSeenIds(monitor.name, []);
          results.push(`### ${monitor.name} — no new listings`);
        }
      }

      return {
        content: [{ type: "text" as const, text: results.join("\n\n---\n\n") }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error checking monitors: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  };
}

export function createDeleteMonitorHandler() {
  return async (args: { name: string }) => {
    const deleted = deleteMonitor(args.name);
    return {
      content: [
        {
          type: "text" as const,
          text: deleted
            ? `Monitor "${args.name}" deleted.`
            : `Monitor "${args.name}" not found.`,
        },
      ],
    };
  };
}

export function createListMonitorsHandler() {
  return async () => {
    const monitors = loadMonitors();
    if (monitors.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No monitors saved. Use monitor_search to create one.",
          },
        ],
      };
    }

    const list = monitors
      .map(
        (m) =>
          `- **${m.name}** — "${m.params.query}" (${m.params.radiusKm}km)\n  Created: ${m.createdAt}${m.lastChecked ? ` | Last checked: ${m.lastChecked}` : ""}\n  Seen: ${m.seenIds.length} listings`
      )
      .join("\n\n");

    return {
      content: [{ type: "text" as const, text: `## Saved Monitors\n\n${list}` }],
    };
  };
}
