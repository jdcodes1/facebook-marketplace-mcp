import type {
  DateListed,
  DeliveryMethod,
  SearchParams,
  SearchSortBy,
} from "./types.js";

// Known GraphQL doc_ids for Facebook Marketplace.
// These are hashed operation identifiers that Facebook rotates on deploys.
// The values below were last community-captured on 2026-08-28. Run
// `npm run capture-queries` to discover current values if these break.

export const MARKETPLACE_SEARCH_DOC_ID = "27212616558440397";
export const LOCATION_SEARCH_DOC_ID = "9660140454040174";

// Listing detail uses a different approach — we extract the doc_id dynamically
// or fall back to fetching the listing page and parsing embedded data.
export let LISTING_DETAIL_DOC_ID = "";

export function setListingDetailDocId(docId: string) {
  LISTING_DETAIL_DOC_ID = docId;
}

const SPONSORED_DATA_FIELD_NAME_PROVIDER =
  "__relay_internal__pv__GHLShouldChangeMarketplaceSponsoredDataFieldNamerelayprovider";

const SORT_VALUES: Record<Exclude<SearchSortBy, "suggested">, string> = {
  distance: "DISTANCE_ASCEND",
  date_listed: "CREATION_TIME_DESCEND",
  price_low_to_high: "PRICE_ASCEND",
  price_high_to_low: "PRICE_DESCEND",
};

const DELIVERY_VALUES: Record<DeliveryMethod, readonly [boolean, boolean]> = {
  all: [true, true],
  local_pickup: [true, false],
  shipping: [false, true],
};

const LISTED_WITHIN_DAY_COUNTS: Record<Exclude<DateListed, "all">, number> = {
  last_24_hours: 2,
  last_7_days: 8,
  last_30_days: 31,
};

export function getCurrentUtcDayIndex(now = new Date()): number {
  return Math.floor(now.getTime() / 86_400_000);
}

export function buildDateListedWindow(
  dateListed: DateListed,
  currentUtcDayIndex = getCurrentUtcDayIndex(),
): string | null {
  if (dateListed === "all") return null;

  return Array.from(
    { length: LISTED_WITHIN_DAY_COUNTS[dateListed] },
    (_, index) => String(currentUtcDayIndex - index),
  ).join(";");
}

export function buildSearchVariables(params: SearchParams) {
  const sortBy = params.sortBy ?? "suggested";
  const deliveryMethod = params.deliveryMethod ?? "all";
  const dateListed = params.dateListed ?? "all";
  const [localPickup, shipping] = DELIVERY_VALUES[deliveryMethod];
  const variables: Record<string, unknown> = {
    // Number of listings Facebook should return in this page.
    count: params.limit,
    // Marketplace's nested search-parameter payload.
    params: {
      // Basic query fields for the Marketplace browse-query flow.
      bqf: {
        // Identifies this as a search made by the desktop Marketplace web surface.
        callsite: "COMMERCE_MKTPLACE_WWW",
        // The user's Marketplace search text.
        query: params.query,
      },
      // Filters that control which Marketplace inventory is returned.
      browse_request_params: {
        // Include listings available for local collection.
        commerce_enable_local_pickup: localPickup,
        // Include listings that Facebook marks as shippable.
        commerce_enable_shipping: shipping,
        // Ask Facebook to apply its availability filter to the results.
        commerce_search_and_rp_available: true,
        // Restrict results to the selected Marketplace category, if supplied.
        commerce_search_and_rp_category_id: params.category
          ? [params.category]
          : [],
        // No condition filter is selected.
        commerce_search_and_rp_condition: null,
        // No listed-within date filter is selected.
        commerce_search_and_rp_ctime_days: buildDateListedWindow(dateListed),
        // Latitude of the requested search center.
        filter_location_latitude: params.latitude,
        // Longitude of the requested search center.
        filter_location_longitude: params.longitude,
        // Minimum price in cents; zero leaves the lower bound unfiltered.
        filter_price_lower_bound: params.minPrice
          ? params.minPrice * 100
          : 0,
        // Maximum price in cents; Facebook's observed maximum leaves the upper bound unfiltered.
        filter_price_upper_bound: params.maxPrice
          ? params.maxPrice * 100
          : 214748364700,
        // Search radius around the requested coordinates, in kilometers.
        filter_radius_km: params.radiusKm,
        // Facebook's suggested sort is represented by omitting this field.
        ...(sortBy === "suggested"
          ? {}
          : { commerce_search_sort_by: SORT_VALUES[sortBy] }),
      },
      // Web-client context retained by Facebook's persisted query contract.
      custom_request_params: {
        // No extra browse context is supplied for this direct search request.
        browse_context: null,
        // No contextual filters are selected.
        contextual_filters: [],
        // This search did not originate from a Marketplace referral.
        referral_code: null,
        // This search did not originate from a specific referral UI component.
        referral_ui_component: null,
        // This request is not associated with a saved Marketplace search.
        saved_search_strid: null,
        // Search Facebook's consumer-to-consumer Marketplace inventory.
        search_vertical: "C2C",
        // No search-engine-optimized Marketplace URL context is supplied.
        seo_url: null,
        // Do not select a virtual Marketplace category.
        serp_landing_settings: { virtual_category_id: "" },
        // Identify the request as a Marketplace search page.
        surface: "SEARCH",
        // No virtual contextual filters are selected.
        virtual_contextual_filters: [],
      },
    },
    // Request images at the desktop client's observed 2x display scale.
    scale: 2,
    // Relay feature flag observed on Marketplace search requests for sponsored-data field naming.
    [SPONSORED_DATA_FIELD_NAME_PROVIDER]: true,
  };

  if (params.cursor) {
    // Continue from the opaque cursor returned by the previous result page.
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
