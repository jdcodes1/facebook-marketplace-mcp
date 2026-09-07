import type { MarketplaceListing, SavedMonitor } from "../mcp/types.js";

export function listingOutput(listing: MarketplaceListing) {
  return {
    id: listing.id,
    title: listing.title,
    price: listing.price,
    location: listing.location,
    image_url: listing.imageUrl,
    seller_name: listing.sellerName,
    posted_date: listing.postedDate,
    url: listing.url,
    is_pending: listing.isPending,
  };
}

export function monitorOutput(monitor: SavedMonitor) {
  return {
    id: monitor.id,
    name: monitor.name,
    query: monitor.params.query,
    latitude: monitor.params.latitude,
    longitude: monitor.params.longitude,
    radius_km: monitor.params.radiusKm,
    min_price: monitor.params.minPrice,
    max_price: monitor.params.maxPrice,
    category: monitor.params.category,
    created_at: monitor.createdAt,
    last_checked: monitor.lastChecked,
    seen_count: monitor.seenIds.length,
  };
}

export function listingsMarkdown(
  query: string,
  listings: ReturnType<typeof listingOutput>[],
  hasMore: boolean,
) {
  if (listings.length === 0) return `No listings found for "${query}".`;
  const rows = listings.map(
    (listing, index) =>
      `${index + 1}. **${listing.title}** — ${listing.price}\n   📍 ${listing.location} | 👤 ${listing.seller_name}${listing.is_pending ? " ⏳ PENDING" : ""}\n   🔗 ${listing.url}`,
  );
  return `# Marketplace listings for "${query}"\n\n${rows.join("\n\n")}${hasMore ? "\n\n_More results are available with the returned cursor._" : ""}`;
}
