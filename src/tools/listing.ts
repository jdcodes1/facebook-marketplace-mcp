import type { z } from "zod";
import { getListingInput, searchListingsInput } from "../mcp/contracts.js";
import {
  responseFor,
  takeWithinCharacterLimit,
  truncateText,
} from "../mcp/response.js";
import type { MarketplaceService } from "../mcp/types.js";
import { toolErrorResponse } from "../utils/diagnostics.js";
import { listingOutput, listingsMarkdown } from "./shared.js";

export function createSearchListingsHandler(service: MarketplaceService) {
  return async (args: z.infer<typeof searchListingsInput>) => {
    try {
      const result = await service.searchListings({
        query: args.query,
        latitude: args.latitude,
        longitude: args.longitude,
        radiusKm: args.radius_km,
        minPrice: args.min_price,
        maxPrice: args.max_price,
        category: args.category,
        sortBy: args.sort_by,
        deliveryMethod: args.delivery_method,
        dateListed: args.date_listed,
        limit: args.limit,
        cursor: args.cursor,
      });
      const bounded = takeWithinCharacterLimit(
        result.listings.map(listingOutput),
        (listing) => JSON.stringify(listing),
      );
      const output = {
        query: args.query,
        count: bounded.items.length,
        listings: bounded.items,
        has_more: result.hasNextPage || bounded.truncated,
        next_cursor: result.endCursor,
        truncated: bounded.truncated,
        ...(bounded.truncated
          ? {
              truncation_message:
                "Response truncated. Use a lower limit, narrower filters, or the returned cursor.",
            }
          : {}),
      };
      return responseFor(
        output,
        args.response_format,
        listingsMarkdown(args.query, bounded.items, output.has_more),
      );
    } catch (error) {
      return toolErrorResponse(
        "facebook_marketplace_search_listings",
        args,
        error,
        "Unable to search Marketplace",
      );
    }
  };
}

export function createGetListingHandler(service: MarketplaceService) {
  return async (args: z.infer<typeof getListingInput>) => {
    try {
      const listing = await service.getListingDetail(args.listing_id);
      const description = truncateText(listing.description);
      const output = {
        listing: {
          ...listingOutput(listing),
          description: description.text,
          images: listing.images,
          condition: listing.condition,
          seller: {
            name: listing.seller.name,
            profile_url: listing.seller.profileUrl ?? null,
          },
        },
        truncated: description.truncated,
        ...(description.truncated
          ? {
              truncation_message:
                "Description truncated; fetch the listing directly for its full text.",
            }
          : {}),
      };
      const markdown = [
        `# ${listing.title}`,
        "",
        `**Price:** ${listing.price}`,
        listing.condition ? `**Condition:** ${listing.condition}` : null,
        `**Location:** ${listing.location}`,
        listing.isPending ? "**Status:** Pending" : null,
        listing.description ? `\n## Description\n${description.text}` : null,
        `\n**Seller:** ${listing.seller.name}`,
        listing.seller.profileUrl
          ? `**Profile:** ${listing.seller.profileUrl}`
          : null,
        listing.images.length
          ? `\n**Images:** ${listing.images.length} photo(s)\n${listing.images.map((url, index) => `${index + 1}. ${url}`).join("\n")}`
          : null,
        `\n🔗 ${listing.url}`,
      ]
        .filter(Boolean)
        .join("\n");
      return responseFor(output, args.response_format, markdown);
    } catch (error) {
      return toolErrorResponse(
        "facebook_marketplace_get_listing",
        args,
        error,
        "Unable to fetch Marketplace listing",
      );
    }
  };
}
