import type { z } from "zod/v4";
import { responseFor, takeWithinCharacterLimit } from "../mcp/response.js";
import type {
  MarketplaceService,
  MonitorStore,
  SavedMonitor,
} from "../mcp/types.js";
import { toolErrorResponse } from "../utils/diagnostics.js";
import { listingOutput, monitorOutput } from "./shared.js";
import {
  checkMonitorsInput,
  createMonitorInput,
  deleteMonitorInput,
  listMonitorsInput,
} from "../mcp/contracts.js";

export function createCreateMonitorHandler(store: MonitorStore) {
  return async (args: z.infer<typeof createMonitorInput>) => {
    try {
      const monitor = store.add(args.name, {
        query: args.query,
        latitude: args.latitude,
        longitude: args.longitude,
        radiusKm: args.radius_km,
        minPrice: args.min_price,
        maxPrice: args.max_price,
        category: args.category,
        limit: 24,
      });
      const output = { monitor: monitorOutput(monitor) };
      return responseFor(
        output,
        args.response_format,
        `# Monitor saved\n\n**${monitor.name}** searches for "${monitor.params.query}" within ${monitor.params.radiusKm} km.`,
      );
    } catch (error) {
      return toolErrorResponse(
        "facebook_marketplace_create_monitor",
        args,
        error,
        "Unable to create monitor",
      );
    }
  };
}

export function createCheckMonitorsHandler(
  service: MarketplaceService,
  store: MonitorStore,
) {
  return async (args: z.infer<typeof checkMonitorsInput>) => {
    try {
      const monitors = args.monitor_name
        ? [store.get(args.monitor_name)].filter(
            (monitor): monitor is SavedMonitor => Boolean(monitor),
          )
        : store.list();
      const results: Array<{
        name: string;
        found: boolean;
        new_listings: ReturnType<typeof listingOutput>[];
      }> = [];
      for (const monitor of monitors) {
        const search = await service.searchListings(monitor.params);
        const newListings = search.listings.filter(
          (listing) => !monitor.seenIds.includes(listing.id),
        );
        store.updateSeenIds(
          monitor.name,
          newListings.map((listing) => listing.id),
        );
        results.push({
          name: monitor.name,
          found: true,
          new_listings: newListings.map(listingOutput),
        });
      }
      if (args.monitor_name && results.length === 0)
        results.push({
          name: args.monitor_name,
          found: false,
          new_listings: [],
        });
      const bounded = takeWithinCharacterLimit(results, (result) =>
        JSON.stringify(result),
      );
      const output = {
        count: bounded.items.length,
        results: bounded.items,
        truncated: bounded.truncated,
        ...(bounded.truncated
          ? {
              truncation_message:
                "Response truncated. Check one monitor at a time.",
            }
          : {}),
      };
      const markdown = output.results.length
        ? output.results
            .map((result) =>
              !result.found
                ? `## ${result.name}\n\nMonitor not found.`
                : `## ${result.name}\n\n${result.new_listings.length ? result.new_listings.map((listing) => `- **${listing.title}** — ${listing.price}\n  ${listing.url}`).join("\n") : "No new listings."}`,
            )
            .join("\n\n")
        : "No monitors saved. Create one before checking for new listings.";
      return responseFor(output, args.response_format, markdown);
    } catch (error) {
      return toolErrorResponse(
        "facebook_marketplace_check_monitors",
        args,
        error,
        "Unable to check monitors",
      );
    }
  };
}

export function createDeleteMonitorHandler(store: MonitorStore) {
  return async (args: z.infer<typeof deleteMonitorInput>) => {
    try {
      const output = { name: args.name, deleted: store.delete(args.name) };
      return responseFor(
        output,
        args.response_format,
        output.deleted
          ? `Monitor "${args.name}" deleted.`
          : `Monitor "${args.name}" was not found.`,
      );
    } catch (error) {
      return toolErrorResponse(
        "facebook_marketplace_delete_monitor",
        args,
        error,
        "Unable to delete monitor",
      );
    }
  };
}

export function createListMonitorsHandler(store: MonitorStore) {
  return async (args: z.infer<typeof listMonitorsInput>) => {
    try {
      const bounded = takeWithinCharacterLimit(
        store.list().map(monitorOutput),
        (monitor) => JSON.stringify(monitor),
      );
      const output = {
        count: bounded.items.length,
        monitors: bounded.items,
        truncated: bounded.truncated,
        ...(bounded.truncated
          ? {
              truncation_message:
                "Response truncated. Delete inactive monitors or inspect monitor storage locally.",
            }
          : {}),
      };
      const markdown = bounded.items.length
        ? `# Saved monitors\n\n${bounded.items.map((monitor) => `- **${monitor.name}** — "${monitor.query}" (${monitor.radius_km} km)\n  Seen: ${monitor.seen_count} listings`).join("\n")}`
        : "No monitors saved.";
      return responseFor(output, args.response_format, markdown);
    } catch (error) {
      return toolErrorResponse(
        "facebook_marketplace_list_monitors",
        args,
        error,
        "Unable to list monitors",
      );
    }
  };
}
