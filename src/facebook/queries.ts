// Known GraphQL doc_ids for Facebook Marketplace.
// These are hashed operation identifiers that Facebook rotates on deploys.
// Run `npm run capture-queries` to discover current values if these break.
//
// Last verified: 2026-08-28 (captured from live www.facebook.com traffic)
//   marketplace search   -> CometMarketplaceSearchContentPaginationQuery
//   location typeahead   -> MarketplaceSearchAddressDataSourceQuery

export const MARKETPLACE_SEARCH_DOC_ID = "27212616558440397";
export const LOCATION_SEARCH_DOC_ID = "9660140454040174";

// Listing detail uses a different approach — we extract the doc_id dynamically
// or fall back to fetching the listing page and parsing embedded data.
export let LISTING_DETAIL_DOC_ID = "";

export function setListingDetailDocId(docId: string) {
  LISTING_DETAIL_DOC_ID = docId;
}

// Relay provider flag the web client sends with the search query. Facebook
// rejects/ignores the query shape without it.
const SPONSORED_DATA_FIELD_NAME_PROVIDER =
  "__relay_internal__pv__GHLShouldChangeMarketplaceSponsoredDataFieldNamerelayprovider";

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
        // Facebook sends an array here, not a scalar.
        commerce_search_and_rp_category_id: params.category
          ? [params.category]
          : [],
        commerce_search_and_rp_condition: null,
        commerce_search_and_rp_ctime_days: null,
        filter_location_latitude: params.latitude,
        filter_location_longitude: params.longitude,
        filter_price_lower_bound: params.minPrice ? params.minPrice * 100 : 0,
        filter_price_upper_bound: params.maxPrice
          ? params.maxPrice * 100
          : 214748364700,
        filter_radius_km: params.radiusKm,
      },
      custom_request_params: {
        browse_context: null,
        contextual_filters: [],
        referral_code: null,
        referral_ui_component: null,
        saved_search_strid: null,
        search_vertical: "C2C",
        seo_url: null,
        serp_landing_settings: { virtual_category_id: "" },
        surface: "SEARCH",
        virtual_contextual_filters: [],
      },
    },
    scale: 2,
    [SPONSORED_DATA_FIELD_NAME_PROVIDER]: true,
  };

  // Only send a cursor when paginating — the search query treats an explicit
  // null cursor as "past the end" and returns a NoResults feed story.
  if (params.cursor) {
    variables.cursor = params.cursor;
  }

  return variables;
}

export function buildLocationSearchVariables(
  query: string,
  viewerCoordinates?: { latitude: number; longitude: number }
) {
  return {
    params: {
      caller: "MARKETPLACE",
      country_filter: null,
      integration_strategy: "STRING_MATCH",
      page_category: ["CITY", "SUBCITY", "NEIGHBORHOOD", "POSTAL_CODE"],
      query,
      search_type: "PLACE_TYPEAHEAD",
      viewer_coordinates: viewerCoordinates ?? null,
    },
  };
}
