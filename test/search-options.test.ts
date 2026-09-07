import assert from "node:assert/strict";
import test from "node:test";
import { buildDateListedWindow, buildSearchVariables } from "../src/facebook/queries.js";
import { searchListingsInput } from "../src/mcp/contracts.js";
import type { MarketplaceService } from "../src/mcp/types.js";
import { createSearchListingsHandler } from "../src/tools/listing.js";

const requiredSearch = {
  query: "desk",
  latitude: 42.36,
  longitude: -71.06,
};

function browseRequest(params: Parameters<typeof buildSearchVariables>[0]) {
  return (
    buildSearchVariables(params) as {
      params: { browse_request_params: Record<string, unknown> };
    }
  ).params.browse_request_params;
}

test("listing-search options validate with readable defaults", () => {
  const parsed = searchListingsInput.parse(requiredSearch);
  assert.equal(parsed.sort_by, "suggested");
  assert.equal(parsed.delivery_method, "all");
  assert.equal(parsed.date_listed, "all");
  assert.throws(() =>
    searchListingsInput.parse({ ...requiredSearch, sort_by: "best_match" }),
  );
  assert.throws(() =>
    searchListingsInput.parse({ ...requiredSearch, delivery_method: "pickup" }),
  );
  assert.throws(() =>
    searchListingsInput.parse({ ...requiredSearch, date_listed: "today" }),
  );
});

test("listing-search handler forwards the new options to Marketplace", async () => {
  let received: Parameters<MarketplaceService["searchListings"]>[0] | undefined;
  const service: MarketplaceService = {
    async searchListings(params) {
      received = params;
      return { listings: [], hasNextPage: false, endCursor: null };
    },
    async getListingDetail() {
      throw new Error("not used");
    },
    async searchLocation() {
      return [];
    },
  };

  const args = searchListingsInput.parse({
    ...requiredSearch,
    sort_by: "price_high_to_low",
    delivery_method: "shipping",
    date_listed: "last_24_hours",
  });
  await createSearchListingsHandler(service)(args);

  assert.equal(received?.sortBy, "price_high_to_low");
  assert.equal(received?.deliveryMethod, "shipping");
  assert.equal(received?.dateListed, "last_24_hours");
});

test("search variables reproduce captured sort and delivery mappings", () => {
  const base = { ...requiredSearch, radiusKm: 50, limit: 20 };
  const expectedSorts = {
    distance: "DISTANCE_ASCEND",
    date_listed: "CREATION_TIME_DESCEND",
    price_low_to_high: "PRICE_ASCEND",
    price_high_to_low: "PRICE_DESCEND",
  } as const;

  const suggested = browseRequest({ ...base, sortBy: "suggested" });
  assert.equal(suggested.commerce_search_sort_by, undefined);

  for (const [sortBy, expected] of Object.entries(expectedSorts)) {
    const request = browseRequest({
      ...base,
      sortBy: sortBy as keyof typeof expectedSorts,
    });
    assert.equal(request.commerce_search_sort_by, expected);
  }

  assert.deepEqual(
    [
      "all",
      "local_pickup",
      "shipping",
    ].map((deliveryMethod) => {
      const request = browseRequest({
        ...base,
        deliveryMethod: deliveryMethod as "all" | "local_pickup" | "shipping",
      });
      return [
        request.commerce_enable_local_pickup,
        request.commerce_enable_shipping,
      ];
    }),
    [
      [true, true],
      [true, false],
      [false, true],
    ],
  );
});

test("date-listed filters create inclusive UTC-day windows", () => {
  assert.equal(buildDateListedWindow("all", 20_699), null);
  assert.equal(buildDateListedWindow("last_24_hours", 20_699), "20699;20698");
  assert.equal(
    buildDateListedWindow("last_7_days", 20_699),
    "20699;20698;20697;20696;20695;20694;20693;20692",
  );
  assert.equal(
    buildDateListedWindow("last_30_days", 20_699),
    Array.from({ length: 31 }, (_, index) => String(20_699 - index)).join(";"),
  );
});
