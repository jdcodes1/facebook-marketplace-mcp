// Zod 4 keeps refinements on object schemas so the MCP SDK can publish their fields.
import { z } from "zod/v4";
import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT } from "./constants.js";

// Keep nullable strings constrained for JSON Schema converters that otherwise
// collapse nullable strings into an array-valued `type`.
const nullableStringSchema = z.string().min(0).nullable();

export const responseFormatSchema = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe(
    "Output format: markdown for readability or json for machine processing.",
  );

const listingSchema = z.object({
  id: z.string(),
  title: z.string(),
  price: z.string(),
  location: z.string(),
  image_url: z.string(),
  seller_name: z.string(),
  posted_date: z.string(),
  url: z.string(),
  is_pending: z.boolean(),
});

const monitorSchema = z.object({
  id: z.string(),
  name: z.string(),
  query: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  radius_km: z.number(),
  min_price: z.number().optional(),
  max_price: z.number().optional(),
  category: z.string().optional(),
  created_at: z.string(),
  last_checked: nullableStringSchema,
  seen_count: z.number().int().nonnegative(),
});

const searchFields = {
  query: z.string().trim().min(1).max(200).describe("Marketplace search text."),
  latitude: z.number().min(-90).max(90).describe("Search-center latitude."),
  longitude: z.number().min(-180).max(180).describe("Search-center longitude."),
  radius_km: z
    .number()
    .positive()
    .max(1_000)
    .default(50)
    .describe("Search radius in kilometers."),
  min_price: z
    .number()
    .nonnegative()
    .optional()
    .describe("Minimum price in dollars."),
  max_price: z
    .number()
    .nonnegative()
    .optional()
    .describe("Maximum price in dollars."),
  category: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Marketplace category ID."),
};

export const searchListingsInput = z
  .object({
    ...searchFields,
    sort_by: z
      .enum([
        "suggested",
        "distance",
        "date_listed",
        "price_low_to_high",
        "price_high_to_low",
      ])
      .default("suggested")
      .describe("Result order (default: suggested)."),
    delivery_method: z
      .enum(["all", "local_pickup", "shipping"])
      .default("all")
      .describe("Listing delivery method (default: all)."),
    date_listed: z
      .enum(["all", "last_24_hours", "last_7_days", "last_30_days"])
      .default("all")
      .describe("When listings were posted (default: all)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_SEARCH_LIMIT)
      .default(DEFAULT_SEARCH_LIMIT)
      .describe("Maximum listings to return."),
    cursor: z
      .string()
      .min(1)
      .max(2_000)
      .optional()
      .describe("Cursor returned by a prior search."),
    response_format: responseFormatSchema,
  })
  .strict()
  .superRefine(({ min_price, max_price }, context) => {
    if (
      min_price !== undefined &&
      max_price !== undefined &&
      min_price > max_price
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "min_price must not exceed max_price",
        path: ["max_price"],
      });
    }
  });

export const getListingInput = z
  .object({
    listing_id: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe("Facebook Marketplace listing ID."),
    response_format: responseFormatSchema,
  })
  .strict();

export const searchLocationsInput = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("City, neighborhood, or ZIP code."),
    response_format: responseFormatSchema,
  })
  .strict();

export const createMonitorInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe("Unique saved-monitor name."),
    ...searchFields,
    response_format: responseFormatSchema,
  })
  .strict()
  .superRefine(({ min_price, max_price }, context) => {
    if (
      min_price !== undefined &&
      max_price !== undefined &&
      min_price > max_price
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "min_price must not exceed max_price",
        path: ["max_price"],
      });
    }
  });

export const checkMonitorsInput = z
  .object({
    monitor_name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe("One monitor name; omit to check all."),
    response_format: responseFormatSchema,
  })
  .strict();

export const deleteMonitorInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe("Saved-monitor name to delete."),
    response_format: responseFormatSchema,
  })
  .strict();

export const listMonitorsInput = z
  .object({ response_format: responseFormatSchema })
  .strict();

const truncationFields = {
  truncated: z.boolean(),
  truncation_message: z.string().optional(),
};

export const searchListingsOutput = z.object({
  query: z.string(),
  count: z.number().int().nonnegative(),
  listings: z.array(listingSchema),
  has_more: z.boolean(),
  next_cursor: nullableStringSchema,
  ...truncationFields,
});
export const listingOutput = z.object({
  listing: listingSchema.extend({
    description: z.string(),
    images: z.array(z.string()),
    condition: z.string(),
    seller: z.object({ name: z.string(), profile_url: nullableStringSchema }),
  }),
  ...truncationFields,
});
export const locationsOutput = z.object({
  query: z.string(),
  count: z.number().int().nonnegative(),
  locations: z.array(
    z.object({ name: z.string(), latitude: z.number(), longitude: z.number() }),
  ),
  ...truncationFields,
});
export const createMonitorOutput = z.object({ monitor: monitorSchema });
export const checkMonitorsOutput = z.object({
  count: z.number().int().nonnegative(),
  results: z.array(
    z.object({
      name: z.string(),
      found: z.boolean(),
      new_listings: z.array(listingSchema),
    }),
  ),
  ...truncationFields,
});
export const deleteMonitorOutput = z.object({
  name: z.string(),
  deleted: z.boolean(),
});
export const listMonitorsOutput = z.object({
  count: z.number().int().nonnegative(),
  monitors: z.array(monitorSchema),
  ...truncationFields,
});
