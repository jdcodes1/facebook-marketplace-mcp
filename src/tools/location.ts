import type { z } from "zod";
import { searchLocationsInput } from "../mcp/contracts.js";
import { responseFor, takeWithinCharacterLimit } from "../mcp/response.js";
import type { MarketplaceService } from "../mcp/types.js";
import { toolErrorResponse } from "../utils/diagnostics.js";

export function createSearchLocationsHandler(service: MarketplaceService) {
  return async (args: z.infer<typeof searchLocationsInput>) => {
    try {
      const bounded = takeWithinCharacterLimit(
        await service.searchLocation(args.query),
        (location) => JSON.stringify(location),
      );
      const output = {
        query: args.query,
        count: bounded.items.length,
        locations: bounded.items,
        truncated: bounded.truncated,
        ...(bounded.truncated
          ? {
              truncation_message:
                "Response truncated. Use a more specific location query.",
            }
          : {}),
      };
      const markdown = bounded.items.length
        ? `# Locations for "${args.query}"\n\n${bounded.items.map((location, index) => `${index + 1}. **${location.name}** — lat: ${location.latitude}, lng: ${location.longitude}`).join("\n")}`
        : `No locations found for "${args.query}". Try a city, town, or ZIP code.`;
      return responseFor(output, args.response_format, markdown);
    } catch (error) {
      return toolErrorResponse(
        "facebook_marketplace_search_locations",
        args,
        error,
        "Unable to search Marketplace locations",
      );
    }
  };
}
