import type {
  MarketplaceListing,
  MarketplaceListingDetail,
  SearchResult,
} from "./types.js";

/**
 * Locate the connection holding marketplace listings.
 *
 * Facebook moves this container between deploys (marketplace_search.feed_units,
 * viewer.marketplace_feed_stories, ...), so rather than hardcoding one path we
 * walk the response for the first `edges` array whose nodes carry a listing.
 */
function findListingConnection(root: any): any | null {
  const seen = new Set<any>();
  const queue: any[] = [root];

  while (queue.length) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
    seen.add(cur);

    if (Array.isArray(cur.edges)) {
      const hasListing = cur.edges.some(
        (e: any) => e?.node?.listing ?? e?.node?.marketplace_listing_title
      );
      if (hasListing) return cur;
    }

    for (const value of Object.values(cur)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return null;
}

export function parseSearchResponse(data: unknown): SearchResult {
  try {
    const root = data as any;
    const feedUnits =
      root?.data?.marketplace_search?.feed_units ??
      findListingConnection(root?.data);

    if (!feedUnits) {
      return { listings: [], hasNextPage: false, endCursor: null };
    }

    const edges = feedUnits.edges ?? [];
    const pageInfo = feedUnits.page_info ?? {};

    const listings: MarketplaceListing[] = edges
      .map((edge: any) => {
        // Some feed shapes nest the listing under `node.listing`, others put
        // the listing fields directly on the node.
        const listing = edge?.node?.listing ?? edge?.node;
        if (!listing?.marketplace_listing_title && !listing?.id) return null;

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

/**
 * Pull the listing's own object out of the relay payloads embedded in the page.
 *
 * The page carries data for many listings (suggestions, related items), so a
 * bare regex over the whole document reliably picks up the wrong one. Instead
 * we parse each embedded JSON block and walk it for the node whose `id` matches
 * the listing we asked for.
 */
/** Fill gaps in `target` from `source` without overwriting values already set. */
function mergeInto(target: any, source: any): any {
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) continue;
    const existing = target[key];
    if (
      existing &&
      typeof existing === "object" &&
      typeof value === "object" &&
      !Array.isArray(existing) &&
      !Array.isArray(value)
    ) {
      mergeInto(existing, value);
    } else if (
      existing === undefined ||
      existing === null ||
      existing === "" ||
      (Array.isArray(existing) && existing.length === 0)
    ) {
      target[key] = value;
    }
  }
  return target;
}

function findListingNodeInHtml(html: string, listingId: string): any | null {
  const blocks = html.matchAll(
    /<script[^>]+type="application\/json"[^>]*>(.*?)<\/script>/gs
  );

  // Relay splits one listing across several partial nodes that share the same
  // id (one carries the title, another the price, another the seller...), so
  // collect every node for this id and merge them into a single object.
  const merged: any = {};
  let matched = false;
  let fallback: any = null;

  for (const block of blocks) {
    let payload: unknown;
    try {
      payload = JSON.parse(block[1]);
    } catch {
      continue;
    }

    const seen = new Set<any>();
    const queue: any[] = [payload];

    while (queue.length) {
      const cur = queue.shift();
      if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
      seen.add(cur);

      if (String(cur.id) === String(listingId)) {
        mergeInto(merged, cur);
        matched = true;
      } else if (!fallback && cur.marketplace_listing_title !== undefined) {
        // Keep the first complete-looking listing as a last resort.
        fallback = cur;
      }

      for (const value of Object.values(cur)) {
        if (value && typeof value === "object") queue.push(value);
      }
    }
  }

  return matched ? merged : fallback;
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

  // Prefer the listing's own embedded JSON node — the regex fallbacks below
  // match the first hit anywhere in the page, which is often a different
  // (suggested/related) listing.
  const node = findListingNodeInHtml(html, listingId);
  // Set FB_MCP_DEBUG=1 to see what was matched when Facebook changes the page
  // shape and fields start coming back empty.
  if (process.env.FB_MCP_DEBUG) {
    console.error(
      `[fb-mcp] listing ${listingId}: ` +
        (node
          ? `matched id=${node.id} fields=${Object.keys(node).length}`
          : "no embedded node found")
    );
  }
  if (node) {
    detail.title = node.marketplace_listing_title ?? "";
    detail.price =
      node.listing_price?.formatted_amount_zeros_stripped ??
      node.listing_price?.formatted_amount ??
      (node.listing_price?.amount != null
        ? String(node.listing_price.amount)
        : "");
    detail.location =
      node.location_text?.text ??
      node.location?.reverse_geocode?.city_page?.display_name ??
      node.location?.reverse_geocode?.city ??
      "";
    detail.description =
      node.redacted_description?.text ?? node.description?.text ?? "";
    detail.sellerName = node.marketplace_listing_seller?.name ?? "";
    detail.seller.name = detail.sellerName;
    if (node.marketplace_listing_seller?.id) {
      detail.seller.profileUrl = `https://www.facebook.com/${node.marketplace_listing_seller.id}`;
    }
    detail.condition = node.condition ?? node.condition_text ?? "";
    detail.isPending = node.is_pending ?? false;
    if (node.creation_time) {
      detail.postedDate = new Date(node.creation_time * 1000).toISOString();
    }
    const primary = node.primary_listing_photo?.image?.uri;
    if (primary) {
      detail.imageUrl = primary;
      detail.images.push(primary);
    }
    for (const photo of node.listing_photos ?? []) {
      const uri = photo?.image?.uri;
      if (uri && !detail.images.includes(uri)) detail.images.push(uri);
    }
  }

  // Try to extract from meta tags first (most reliable)
  const titleMatch = html.match(
    /<meta\s+property="og:title"\s+content="([^"]*)"/
  );
  if (!detail.title && titleMatch) detail.title = decodeHtmlEntities(titleMatch[1]);

  const descMatch = html.match(
    /<meta\s+property="og:description"\s+content="([^"]*)"/
  );
  if (!detail.description && descMatch)
    detail.description = decodeHtmlEntities(descMatch[1]);

  const imageMatch = html.match(
    /<meta\s+property="og:image"\s+content="([^"]*)"/
  );
  if (!detail.imageUrl && imageMatch) {
    detail.imageUrl = decodeHtmlEntities(imageMatch[1]);
    detail.images.push(detail.imageUrl);
  }

  // Try to extract price from embedded JSON
  const priceMatch =
    html.match(/"formatted_amount"\s*:\s*"([^"]+)"/) ??
    html.match(/"price"\s*:\s*"([^"]+)"/) ??
    html.match(/\"amount\"\s*:\s*"([^"]+)"/);
  if (!detail.price && priceMatch) detail.price = priceMatch[1];

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
  if (!detail.sellerName && sellerMatch) {
    detail.sellerName = sellerMatch[1];
    detail.seller.name = sellerMatch[1];
  }

  // Extract condition
  const conditionMatch = html.match(
    /"condition_text"\s*:\s*"([^"]+)"/
  ) ?? html.match(/"condition"\s*:\s*"([^"]+)"/);
  if (!detail.condition && conditionMatch) detail.condition = conditionMatch[1];

  // Extract location
  const locationMatch = html.match(
    /"location_text"\s*:\s*\{[^}]*"text"\s*:\s*"([^"]+)"/
  ) ?? html.match(/"reverse_geocode_city"\s*:\s*"([^"]+)"/);
  if (!detail.location && locationMatch) detail.location = locationMatch[1];

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
