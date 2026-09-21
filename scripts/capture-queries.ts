#!/usr/bin/env tsx

/**
 * Query Capture Script
 *
 * Launches a browser, navigates Facebook Marketplace, and intercepts
 * GraphQL requests to discover current doc_id values.
 *
 * Prerequisites:
 *   npm install -D playwright
 *   npx playwright install chromium
 *
 * Usage:
 *   npm run capture-queries
 *
 * This will:
 * 1. Open Chrome with a dedicated capture profile (log in to Facebook on first run)
 * 2. Navigate to Facebook Marketplace
 * 3. Perform a sample search
 * 4. Log all GraphQL doc_ids it finds
 * 5. Save them to src/facebook/queries.ts
 */

import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Chrome refuses remote debugging on its default profile directory, so use a
// dedicated one. Log into Facebook once in the window it opens; the login persists.
const CHROME_USER_DATA =
  process.env.CAPTURE_PROFILE_DIR ??
  path.join(os.homedir(), ".facebook-marketplace-mcp", "capture-profile");

interface CapturedQuery {
  docId: string;
  operationName: string;
  variables: string;
  timestamp: number;
}

async function main() {
  console.log("🔍 Launching browser to capture GraphQL queries...\n");

  const captured: CapturedQuery[] = [];

  const browser = await chromium.launchPersistentContext(CHROME_USER_DATA, {
    headless: false,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = browser.pages()[0] ?? (await browser.newPage());

  // Intercept GraphQL requests (context-level so popups/new tabs are covered)
  const allPosts = new Set<string>();

  // Relay persisted queries are registered in JS bundles as
  // __d("<OperationName>_facebookRelayOperation", ..., e.exports="<doc_id>")
  // so scan loaded scripts for them; this works even when results are server-rendered.
  const relayOps = new Map<string, string>();
  browser.on("response", async (res) => {
    try {
      const ct = res.headers()["content-type"] ?? "";
      if (!ct.includes("javascript")) return;
      const body = await res.text();
      const re = /__d\("([A-Za-z0-9_]+)_facebookRelayOperation"[^"]*?"(\d{8,})"/g;
      for (const m of body.matchAll(re)) {
        if (/marketplace|location|commerce|geo/i.test(m[1])) {
          relayOps.set(m[1], m[2]);
        }
      }
    } catch {
      // response body unavailable (e.g. redirect); ignore
    }
  });
  browser.on("request", (req) => {
    const url = req.url();
    if (req.method() === "POST") {
      allPosts.add(url.split("?")[0]);
    }
    if (url.includes("graphql")) {
      const postData = req.postData() ?? "";
      const params = new URLSearchParams(postData);
      const docId = params.get("doc_id") ?? "";
      const variables = params.get("variables") ?? "{}";

      if (docId) {
        // Try to guess operation name from variables
        let opName = "unknown";
        try {
          const vars = JSON.parse(variables);
          if (vars.params?.bqf?.callsite === "COMMERCE_MKTPLACE_WWW") {
            opName = "marketplace_search";
          } else if (vars.params?.caller === "MARKETPLACE") {
            opName = "city_street_search";
          } else if (vars.targetId) {
            opName = "listing_detail";
          }
        } catch {
          // ignore parse errors
        }

        captured.push({
          docId,
          operationName: opName,
          variables: variables.slice(0, 200),
          timestamp: Date.now(),
        });

        console.log(`📡 Captured: doc_id=${docId} op=${opName}`);
      }
    }
  });

  try {
    console.log("Navigating to Facebook Marketplace...");
    await page.goto("https://www.facebook.com/marketplace/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // First run: wait (up to 5 minutes) for the user to log in.
    if (/login|checkpoint/.test(page.url())) {
      console.log("\n🔑 Not logged in. Log into Facebook in the browser window...");
      await page.waitForURL((u) => !/login|checkpoint/.test(u.toString()), {
        timeout: 300000,
      });
      await page.goto("https://www.facebook.com/marketplace/", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    }

    console.log("\nPage loaded. Performing a sample search...");
    await page.waitForTimeout(3000);

    // Go straight to a search results page and scroll to trigger follow-up queries
    await page.goto("https://www.facebook.com/marketplace/search?query=laptop", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(1500);
    }

    console.log("\n⏳ Waiting 30 seconds for more queries...");
    console.log("   Browse around Marketplace to capture more doc_ids.");
    console.log("   Click on listings, change categories, etc.\n");
    await page.waitForTimeout(30000);

  } catch (err) {
    console.error("\n⚠️  Capture step failed; saving what was collected so far:", err);
  } finally {
    await browser.close();
  }

  console.log("\nMarketplace-related Relay operations found in JS bundles:");
  for (const [name, id] of [...relayOps].sort()) console.log(`  ${id}  ${name}`);

  console.log("\nPOST endpoints seen:");
  for (const u of allPosts) console.log(`  ${u}`);

  // Deduplicate and display results
  const unique = new Map<string, CapturedQuery>();
  for (const q of captured) {
    const key = `${q.docId}-${q.operationName}`;
    if (!unique.has(key)) {
      unique.set(key, q);
    }
  }

  console.log("\n\n=== Captured GraphQL Queries ===\n");
  for (const q of unique.values()) {
    console.log(`doc_id: ${q.docId}`);
    console.log(`  operation: ${q.operationName}`);
    console.log(`  variables: ${q.variables}`);
    console.log();
  }

  // Save to a JSON file for reference
  const outputPath = path.join(
    import.meta.dirname ?? ".",
    "..",
    "captured-queries.json"
  );
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      { requests: [...unique.values()], relayOperations: Object.fromEntries(relayOps) },
      null,
      2
    )
  );
  console.log(`\nSaved to ${outputPath}`);
  console.log(
    "\nUpdate src/facebook/queries.ts with the new doc_id values if they changed."
  );
}

main().catch(console.error);
