import { z } from "zod";
import type { FacebookClient } from "../facebook/client.js";

export const searchListingsSchema = {
  query: z.string().describe("Search query (e.g. 'macbook pro', 'couch')"),
  latitude: z.number().describe("Latitude of search center"),
  longitude: z.number().describe("Longitude of search center"),
  radius_km: z
    .number()
    .default(50)
    .describe("Search radius in kilometers (default: 50)"),
  min_price: z
    .number()
    .optional()
    .describe("Minimum price filter in dollars"),
  max_price: z
    .number()
    .optional()
    .describe("Maximum price filter in dollars"),
  category: z
    .string()
    .optional()
    .describe("Category ID to filter by"),
  limit: z
    .number()
    .default(20)
    .describe("Max number of results (default: 20)"),
};

export function createSearchHandler(client: FacebookClient) {
  return async (args: {
    query: string;
    latitude: number;
    longitude: number;
    radius_km: number;
    min_price?: number;
    max_price?: number;
    category?: string;
    limit: number;
  }) => {
    try {
      const result = await client.searchListings({
        query: args.query,
        latitude: args.latitude,
        longitude: args.longitude,
        radiusKm: args.radius_km,
        minPrice: args.min_price,
        maxPrice: args.max_price,
        category: args.category,
        limit: args.limit,
      });

      if (result.listings.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No listings found for "${args.query}" within ${args.radius_km}km.`,
            },
          ],
        };
      }

      const summary = result.listings
        .map(
          (l, i) =>
            `${i + 1}. **${l.title}** — ${l.price}\n   📍 ${l.location} | 👤 ${l.sellerName}${l.isPending ? " ⏳ PENDING" : ""}\n   🔗 ${l.url}`
        )
        .join("\n\n");

      const text = `Found ${result.listings.length} listings for "${args.query}":\n\n${summary}${result.hasNextPage ? "\n\n_More results available._" : ""}`;

      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error searching listings: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  };
}
