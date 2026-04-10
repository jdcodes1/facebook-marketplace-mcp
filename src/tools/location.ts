import { z } from "zod";
import type { FacebookClient } from "../facebook/client.js";

export const searchLocationSchema = {
  query: z
    .string()
    .describe(
      "Location search query (e.g. 'Dedham MA', 'Boston', 'Brooklyn NY')"
    ),
};

export function createLocationHandler(client: FacebookClient) {
  return async (args: { query: string }) => {
    try {
      const results = await client.searchLocation(args.query);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No locations found for "${args.query}". Try a city or town name with state abbreviation.`,
            },
          ],
        };
      }

      const lines = results.map(
        (r, i) =>
          `${i + 1}. **${r.name}** — lat: ${r.latitude}, lng: ${r.longitude}`
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${results.length} location(s) for "${args.query}":\n\n${lines.join("\n")}\n\nUse these coordinates with search_listings.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error searching locations: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  };
}
