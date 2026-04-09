import type {
  MarketplaceListing,
  MarketplaceListingDetail,
  SearchResult,
} from "./types.js";

export function parseSearchResponse(data: unknown): SearchResult {
  try {
    const root = data as any;
    const feedUnits =
      root?.data?.marketplace_search?.feed_units ??
      root?.data?.marketplace_search?.feed_units;

    if (!feedUnits) {
      return { listings: [], hasNextPage: false, endCursor: null };
    }

    const edges = feedUnits.edges ?? [];
    const pageInfo = feedUnits.page_info ?? {};

    const listings: MarketplaceListing[] = edges
      .map((edge: any) => {
        const listing = edge?.node?.listing;
        if (!listing) return null;

        return {
          id: listing.id ?? "",
          title: listing.marketplace_listing_title ?? "",
          price:
            listing.listing_price?.formatted_amount ??
            listing.listing_price?.amount ??
            "N/A",
          location:
            listing.location?.reverse_geocode?.city_page?.display_name ??
            listing.location?.reverse_geocode?.city ??
            "Unknown",
          imageUrl: listing.primary_listing_photo?.image?.uri ?? "",
          sellerName: listing.marketplace_listing_seller?.name ?? "Unknown",
          postedDate: listing.creation_time
            ? new Date(listing.creation_time * 1000).toISOString()
            : "",
          url: `https://www.facebook.com/marketplace/item/${listing.id}/`,
          isPending: listing.is_pending ?? false,
        };
      })
      .filter(Boolean) as MarketplaceListing[];

    return {
      listings,
      hasNextPage: pageInfo.has_next_page ?? false,
      endCursor: pageInfo.end_cursor ?? null,
    };
  } catch {
    return { listings: [], hasNextPage: false, endCursor: null };
  }
}

export function parseListingDetailFromPage(
  html: string,
  listingId: string
): MarketplaceListingDetail {
  // Facebook embeds listing data as JSON in script tags.
  // Look for structured data or relay-style data payloads.

  const detail: MarketplaceListingDetail = {
    id: listingId,
    title: "",
    description: "",
    price: "",
    location: "",
    imageUrl: "",
    images: [],
    sellerName: "",
    postedDate: "",
    url: `https://www.facebook.com/marketplace/item/${listingId}/`,
    isPending: false,
    condition: "",
    seller: { name: "", profileUrl: "" },
  };

  // Try to extract from meta tags first (most reliable)
  const titleMatch = html.match(
    /<meta\s+property="og:title"\s+content="([^"]*)"/
  );
  if (titleMatch) detail.title = decodeHtmlEntities(titleMatch[1]);

  const descMatch = html.match(
    /<meta\s+property="og:description"\s+content="([^"]*)"/
  );
  if (descMatch) detail.description = decodeHtmlEntities(descMatch[1]);

  const imageMatch = html.match(
    /<meta\s+property="og:image"\s+content="([^"]*)"/
  );
  if (imageMatch) {
    detail.imageUrl = decodeHtmlEntities(imageMatch[1]);
    detail.images.push(detail.imageUrl);
  }

  // Try to extract price from embedded JSON
  const priceMatch =
    html.match(/"formatted_amount"\s*:\s*"([^"]+)"/) ??
    html.match(/"price"\s*:\s*"([^"]+)"/) ??
    html.match(/\"amount\"\s*:\s*"([^"]+)"/);
  if (priceMatch) detail.price = priceMatch[1];

  // Extract additional images
  const imageRegex = /marketplace_listing_photos.*?"uri"\s*:\s*"([^"]+)"/g;
  let imgMatch;
  while ((imgMatch = imageRegex.exec(html)) !== null) {
    const url = imgMatch[1].replace(/\\\//g, "/");
    if (!detail.images.includes(url)) {
      detail.images.push(url);
    }
  }

  // Extract seller name
  const sellerMatch = html.match(
    /"marketplace_listing_seller"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/
  );
  if (sellerMatch) {
    detail.sellerName = sellerMatch[1];
    detail.seller.name = sellerMatch[1];
  }

  // Extract condition
  const conditionMatch = html.match(
    /"condition_text"\s*:\s*"([^"]+)"/
  ) ?? html.match(/"condition"\s*:\s*"([^"]+)"/);
  if (conditionMatch) detail.condition = conditionMatch[1];

  // Extract location
  const locationMatch = html.match(
    /"location_text"\s*:\s*\{[^}]*"text"\s*:\s*"([^"]+)"/
  ) ?? html.match(/"reverse_geocode_city"\s*:\s*"([^"]+)"/);
  if (locationMatch) detail.location = locationMatch[1];

  return detail;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}
