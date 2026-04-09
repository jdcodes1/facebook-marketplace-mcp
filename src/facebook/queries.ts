// Known GraphQL doc_ids for Facebook Marketplace.
// These are hashed operation identifiers that Facebook rotates on deploys.
// Run `npm run capture-queries` to discover current values if these break.

export const MARKETPLACE_SEARCH_DOC_ID = "7111939778879383";
export const LOCATION_SEARCH_DOC_ID = "5585904654783609";

// Listing detail uses a different approach — we extract the doc_id dynamically
// or fall back to fetching the listing page and parsing embedded data.
export let LISTING_DETAIL_DOC_ID = "";

export function setListingDetailDocId(docId: string) {
  LISTING_DETAIL_DOC_ID = docId;
}

export function buildSearchVariables(params: {
  query: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  minPrice?: number;
  maxPrice?: number;
  category?: string;
  limit: number;
  cursor?: string;
}) {
  const variables: Record<string, unknown> = {
    count: params.limit,
    params: {
      bqf: {
        callsite: "COMMERCE_MKTPLACE_WWW",
        query: params.query,
      },
      browse_request_params: {
        commerce_enable_local_pickup: true,
        commerce_enable_shipping: true,
        commerce_search_and_rp_available: true,
        commerce_search_and_rp_condition: null,
        commerce_search_and_rp_ctime_days: null,
        filter_location_latitude: params.latitude,
        filter_location_longitude: params.longitude,
        filter_price_lower_bound: params.minPrice
          ? params.minPrice * 100
          : 0,
        filter_price_upper_bound: params.maxPrice
          ? params.maxPrice * 100
          : 214748364700,
        filter_radius_km: params.radiusKm,
      },
      custom_request_params: {
        surface: "SEARCH",
      },
    },
  };

  if (params.cursor) {
    variables.cursor = params.cursor;
  }

  if (params.category) {
    (
      variables.params as Record<string, unknown>
    ).browse_request_params = {
      ...(
        (variables.params as Record<string, unknown>)
          .browse_request_params as Record<string, unknown>
      ),
      commerce_search_and_rp_category_id: params.category,
    };
  }

  return variables;
}

export function buildLocationSearchVariables(query: string) {
  return {
    params: {
      caller: "MARKETPLACE",
      page_category: ["CITY", "SUBCITY", "NEIGHBORHOOD"],
      query,
    },
  };
}
