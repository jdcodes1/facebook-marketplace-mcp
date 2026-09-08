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
        const node = edge?.node;
        const listing = node?.listing;

        // The search doc_id currently returns skeleton feed units — story_key
        // and tracking only, with no `listing` object. story_key IS the listing
        // id, so emit a stub the client can hydrate from the listing page
        // rather than dropping the result.
        if (!listing) {
          const id = node?.story_key ?? node?.top_level_post_id;
          if (!id) return null;
          return {
            id: String(id),
            title: "",
            price: "N/A",
            location: "Unknown",
            imageUrl: "",
            sellerName: "Unknown",
            postedDate: "",
            url: `https://www.facebook.com/marketplace/item/${id}/`,
            isPending: false,
            needsHydration: true,
          };
        }

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

  // Facebook serves og: meta tags only to logged-out requests. For an
  // authenticated session the listing data is in the embedded Relay payload,
  // where the target listing is the first occurrence of each field (later ones
  // belong to the "related items" rail). Meta tags stay as a fallback.
  detail.title =
    matchJsonString(html, /"marketplace_listing_title"\s*:\s*"((?:[^"\\]|\\.)*)"/) ??
    matchJsonString(html, /"custom_title"\s*:\s*"((?:[^"\\]|\\.)*)"/) ??
    metaTag(html, "og:title") ??
    "";

  detail.description =
    matchJsonString(
      html,
      /"redacted_description"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/
    ) ??
    matchJsonString(html, /"listing_description"\s*:\s*"((?:[^"\\]|\\.)*)"/) ??
    metaTag(html, "og:description") ??
    "";

  // listing_price carries a display string plus raw amount/currency. Prefer the
  // preformatted string; fall back to composing one.
  const priceBlob = html.match(/"listing_price"\s*:\s*\{[^}]*\}/);
  if (priceBlob) {
    const blob = priceBlob[0];
    const formatted =
      matchJsonString(blob, /"formatted_amount_zeros_stripped"\s*:\s*"([^"]*)"/) ??
      matchJsonString(blob, /"formatted_amount"\s*:\s*"([^"]*)"/);
    const amount = matchJsonString(blob, /"amount"\s*:\s*"([^"]*)"/);
    const currency = matchJsonString(blob, /"currency"\s*:\s*"([^"]*)"/);

    detail.price =
      formatted ??
      (amount ? [amount, currency].filter(Boolean).join(" ") : "");
  }

  detail.location =
    matchJsonString(
      html,
      /"location_text"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/
    ) ??
    matchJsonString(html, /"reverse_geocode_city"\s*:\s*"((?:[^"\\]|\\.)*)"/) ??
    "";

  const seller =
    matchJsonString(
      html,
      /"marketplace_listing_seller"\s*:\s*\{[^{]*?"name"\s*:\s*"((?:[^"\\]|\\.)*)"/
    ) ??
    matchJsonString(
      html,
      /"story_seller"\s*:\s*\{[^{]*?"name"\s*:\s*"((?:[^"\\]|\\.)*)"/
    );
  if (seller) {
    detail.sellerName = seller;
    detail.seller.name = seller;
  }

  const creationTime = html.match(/"creation_time"\s*:\s*(\d+)/);
  if (creationTime) {
    detail.postedDate = new Date(Number(creationTime[1]) * 1000).toISOString();
  }

  // Condition is exposed as a localized attribute, e.g.
  // "attribute_data":[{"attribute_name":"\u00c9tat","value":"new","label":"Neuf"}].
  // The bare /"condition":"..."/ pattern used previously matched unrelated
  // Relay keys, so key off attribute_data and prefer its display label.
  detail.condition =
    matchJsonString(
      html,
      /"attribute_data"\s*:\s*\[\s*\{[^}]*?"label"\s*:\s*"((?:[^"\\]|\\.)*)"/
    ) ??
    matchJsonString(
      html,
      /"attribute_data"\s*:\s*\[\s*\{[^}]*?"value"\s*:\s*"((?:[^"\\]|\\.)*)"/
    ) ??
    matchJsonString(html, /"condition_text"\s*:\s*"((?:[^"\\]|\\.)*)"/) ??
    "";

  detail.isPending = /"is_pending"\s*:\s*true/.test(html);

  const primaryPhoto =
    matchJsonString(
      html,
      /"primary_listing_photo"\s*:\s*\{[^{]*?"uri"\s*:\s*"([^"]+)"/
    ) ?? metaTag(html, "og:image");
  if (primaryPhoto) {
    detail.imageUrl = primaryPhoto;
    detail.images.push(primaryPhoto);
  }

  // listing_photos is an array of { image: { uri } }, so collect every uri
  // inside the array rather than just the first.
  for (const uri of extractPhotoUris(html)) {
    if (!detail.images.includes(uri)) detail.images.push(uri);
  }

  return detail;
}

function metaTag(html: string, property: string): string | null {
  const m = html.match(
    new RegExp(`<meta\\s+property="${property}"\\s+content="([^"]*)"`)
  );
  return m ? decodeHtmlEntities(m[1]) : null;
}

function matchJsonString(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? unescapeJsonString(m[1]) : null;
}

/**
 * The Relay payload is JSON embedded in HTML, so values arrive double-escaped:
 * \uXXXX for non-ASCII (Arabic place names, emoji), \n, \/ and \".
 */
function unescapeJsonString(str: string): string {
  return str
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function extractPhotoUris(html: string): string[] {
  const key = '"listing_photos":[';
  const start = html.indexOf(key);
  if (start === -1) return [];

  // Walk the bracket depth to find the end of the array instead of guessing a
  // window size, since a listing can carry many large photo objects.
  let depth = 0;
  let end = -1;
  for (let i = start + key.length - 1; i < html.length; i++) {
    const ch = html[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];

  const block = html.slice(start, end);
  const uris: string[] = [];
  const re = /"uri"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    uris.push(unescapeJsonString(m[1]));
  }
  return uris;
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
