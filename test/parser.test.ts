import assert from "node:assert/strict";
import test from "node:test";
import {
  parseListingDetailFromPage,
  parseSearchResponse,
} from "../src/facebook/parser.js";
import {
  buildLocationSearchVariables,
  buildSearchVariables,
} from "../src/facebook/queries.js";

test("uses the current Marketplace query shapes", () => {
  const search = buildSearchVariables({
    query: "desk",
    latitude: 42.36,
    longitude: -71.06,
    radiusKm: 50,
    category: "123",
    limit: 20,
  }) as {
    cursor?: string;
    params: {
      browse_request_params: { commerce_search_and_rp_category_id: string[] };
    };
  };
  const location = buildLocationSearchVariables("02108", {
    latitude: 42.36,
    longitude: -71.06,
  });

  assert.deepEqual(
    search.params.browse_request_params.commerce_search_and_rp_category_id,
    ["123"]
  );
  assert.equal(search.cursor, undefined);
  assert.deepEqual(location.params.page_category, [
    "CITY",
    "SUBCITY",
    "NEIGHBORHOOD",
    "POSTAL_CODE",
  ]);
  assert.deepEqual(location.params.viewer_coordinates, {
    latitude: 42.36,
    longitude: -71.06,
  });
});

test("parses a Marketplace feed when Facebook moves the listing connection", () => {
  const result = parseSearchResponse({
    data: {
      viewer: {
        marketplace_feed_stories: {
          edges: [
            {
              node: {
                id: "listing-1",
                marketplace_listing_title: "Desk chair",
                listing_price: { formatted_amount: "$35" },
                primary_listing_photo: {
                  image: { uri: "https://image.example/chair" },
                },
              },
            },
          ],
          page_info: { has_next_page: true, end_cursor: "next" },
        },
      },
    },
  });

  assert.deepEqual(result, {
    listings: [
      {
        id: "listing-1",
        title: "Desk chair",
        price: "$35",
        location: "Unknown",
        imageUrl: "https://image.example/chair",
        sellerName: "Unknown",
        postedDate: "",
        url: "https://www.facebook.com/marketplace/item/listing-1/",
        isPending: false,
      },
    ],
    hasNextPage: true,
    endCursor: "next",
  });
});

function searchPage(edges: unknown, pageInfo: unknown = {}) {
  return { data: { marketplace_search: { feed_units: { edges, page_info: pageInfo } } } };
}

test("distinguishes a valid empty search from missing or malformed data", () => {
  assert.deepEqual(parseSearchResponse(searchPage([])), {
    listings: [], hasNextPage: false, endCursor: null,
  });
  for (const response of [
    null, [], {}, { data: null }, { data: [] }, { data: {} },
    { data: { marketplace_search: { feed_units: {} } } },
    { data: { marketplace_search: { feed_units: "invalid" } } },
    searchPage(undefined), searchPage(null), searchPage({}), searchPage("invalid"),
  ]) {
    assert.throws(() => parseSearchResponse(response), /Marketplace/);
  }
});

test("finds listing connections inside nested arrays and ignores unrelated connections", () => {
  const connection = {
    edges: [{ node: { listing: { id: "nested", marketplace_listing_title: "Desk" } } }],
    page_info: { has_next_page: true, end_cursor: "cursor" },
  };
  const result = parseSearchResponse({ data: {
    unrelated: { edges: [], page_info: {} },
    other: { edges: [{ node: { id: "seller" } }] },
    wrappers: [[null, "ignore", { payload: [connection] }]],
  } });
  assert.deepEqual(result.listings.map((listing) => listing.id), ["nested"]);
  assert.equal(result.hasNextPage, true);
  assert.equal(result.endCursor, "cursor");
  assert.throws(() => parseSearchResponse({ data: { unrelated: { edges: [] } } }), /missing a listing connection/);
});

test("prefers the canonical connection even when it is empty", () => {
  const response = searchPage([]);
  Object.assign(response.data, {
    fallback: { edges: [{ node: { id: "other", marketplace_listing_title: "Other" } }] },
  });
  assert.deepEqual(parseSearchResponse(response).listings, []);
  response.data.marketplace_search.feed_units.edges = {};
  assert.throws(() => parseSearchResponse(response), /invalid edges/);
});

test("fallback traversal terminates for cyclic objects and arrays", () => {
  const values: unknown[] = [];
  const data = { values };
  values.push(data, values);
  assert.throws(() => parseSearchResponse({ data }), /missing a listing connection/);
  values.push({ edges: [{ node: { id: "found", marketplace_listing_title: "Desk" } }] });
  assert.equal(parseSearchResponse({ data }).listings[0].id, "found");
});

test("keeps listings with invalid dates and preserves siblings and pagination", () => {
  const invalidDates = ["invalid", "", null, undefined, {}, true, NaN, Infinity, 1e20];
  const edges = invalidDates.map((creation_time, index) => ({ node: {
    id: `invalid-date-${index}`, marketplace_listing_title: "Desk", creation_time,
  } }));
  const result = parseSearchResponse(searchPage([
    ...edges,
    { node: { listing: { id: "valid", creation_time: 1700000000 } } },
    { node: { id: "epoch", creation_time: 0 } },
    { node: { id: "numeric-string", creation_time: "1700000000" } },
  ], { has_next_page: true, end_cursor: "next" }));
  assert.equal(result.listings.length, invalidDates.length + 3);
  assert.ok(result.listings.slice(0, invalidDates.length).every((listing) => listing.postedDate === ""));
  assert.equal(result.listings[invalidDates.length].postedDate, "2023-11-14T22:13:20.000Z");
  assert.equal(result.listings[invalidDates.length + 1].postedDate, "1970-01-01T00:00:00.000Z");
  assert.equal(result.listings.at(-1)?.postedDate, "2023-11-14T22:13:20.000Z");
  assert.equal(result.hasNextPage, true);
  assert.equal(result.endCursor, "next");
});

test("skips malformed entries but rejects nonempty pages without usable listings", () => {
  const malformed = [null, [], {}, { node: null }, { node: [] },
    { node: { listing: "invalid" } }, { node: { id: {} } },
    { node: { marketplace_listing_title: "Missing ID" } }];
  assert.throws(() => parseSearchResponse(searchPage(malformed)), /no usable listings/);
  const result = parseSearchResponse(searchPage([
    ...malformed,
    { node: { id: "good", marketplace_listing_title: "Desk" } },
    { node: { listing: { id: 42, listing_price: { amount: 0 },
      location: [], primary_listing_photo: "invalid", is_pending: "invalid" } } },
  ], { has_next_page: true, end_cursor: "next" }));
  assert.deepEqual(result.listings.map((listing) => listing.id), ["good", "42"]);
  assert.equal(result.listings[1].price, "0");
  assert.equal(result.listings[1].isPending, false);
  assert.equal(result.endCursor, "next");
});

test("uses only the requested listing when page data includes related items", () => {
  const related = {
    id: "related-id",
    marketplace_listing_title: "Wrong item",
    listing_price: { formatted_amount: "$999" },
    marketplace_listing_seller: { name: "Wrong seller" },
  };
  const requestedTitle = {
    id: "requested-id",
    marketplace_listing_title: "Correct item",
    listing_price: { formatted_amount_zeros_stripped: "$42" },
    location_text: { text: "Boston, MA" },
    marketplace_listing_seller: { id: "seller-id", name: "Correct seller" },
  };
  const requestedDetails = {
    id: "requested-id",
    redacted_description: { text: "Correct description" },
    condition_text: "Used - Good",
    is_pending: true,
    primary_listing_photo: {
      image: { uri: "https://image.example/primary" },
    },
    listing_photos: [
      { image: { uri: "https://image.example/primary" } },
      { image: { uri: "https://image.example/second" } },
    ],
  };
  const html =
    '<script type="application/json">' +
    JSON.stringify({ related, requestedTitle }) +
    "</script>" +
    '<script type="application/json">' +
    JSON.stringify({ requestedDetails }) +
    "</script>";

  const result = parseListingDetailFromPage(html, "requested-id");

  assert.equal(result.title, "Correct item");
  assert.equal(result.price, "$42");
  assert.equal(result.location, "Boston, MA");
  assert.equal(result.description, "Correct description");
  assert.equal(result.sellerName, "Correct seller");
  assert.equal(result.seller.profileUrl, "https://www.facebook.com/seller-id");
  assert.equal(result.condition, "Used - Good");
  assert.equal(result.isPending, true);
  assert.deepEqual(result.images, [
    "https://image.example/primary",
    "https://image.example/second",
  ]);
});

test("merges array-wrapped Relay fragments linked by the product item ID", () => {
  // Synthetic version of Facebook's script envelope; no captured page data.
  const script = (data: unknown) =>
    '<script type="application/json">' +
    JSON.stringify({
      require: [["ScheduledServerJS", "handle", null, [{
        __bbox: { require: [["RelayPrefetchedStreamCache", "next", [], [{
          __bbox: { result: { data } },
        }]]] },
      }]]],
    }) +
    "</script>";
  const page = (target: unknown) => ({
    viewer: { marketplace_product_details_page: { target } },
  });
  const photo = "https://image.example/desk";
  const html =
    script({ related: [{
      id: "unrelated-internal-id",
      product_item: { id: "unrelated-public-id" },
      marketplace_listing_title: "Wrong item",
      listing_price: { formatted_amount: "$999" },
    }] }) +
    // The photo fragment arrives before the fragment linking the two IDs.
    script(page({
      id: "internal-id",
      listing_photos: [{ image: { uri: photo } }],
    })) +
    script(page({
      id: "internal-id",
      product_item: { id: "public-id" },
      marketplace_listing_title: "Desk",
      listing_price: { formatted_amount_zeros_stripped: "$42" },
      location_text: { text: "Boston, MA" },
      redacted_description: { text: "A small desk." },
      marketplace_listing_seller: { id: "seller-id", name: "Example seller" },
      creation_time: 1700000000,
      is_pending: true,
      attribute_data: [{
        attribute_name: "Condition",
        value: "used_like_new",
        label: "Used - like new",
      }],
    }));

  assert.deepEqual(parseListingDetailFromPage(html, "public-id"), {
    id: "public-id",
    title: "Desk",
    price: "$42",
    location: "Boston, MA",
    description: "A small desk.",
    imageUrl: photo,
    images: [photo],
    sellerName: "Example seller",
    seller: { name: "Example seller", profileUrl: "https://www.facebook.com/seller-id" },
    postedDate: "2023-11-14T22:13:20.000Z",
    url: "https://www.facebook.com/marketplace/item/public-id/",
    isPending: true,
    condition: "Used - like new",
  });

  const missing = parseListingDetailFromPage(html, "missing-id");
  assert.equal(missing.title, "");
  assert.deepEqual(missing.images, []);
});

test("finds the requested listing ID directly inside JSON arrays", () => {
  const html = '<script type="application/json">' + JSON.stringify([[
    { id: "requested-id", marketplace_listing_title: "Desk" },
  ]]) + "</script>";

  assert.equal(parseListingDetailFromPage(html, "requested-id").title, "Desk");
});
