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
 * 1. Open Chromium with your Chrome profile (so you're logged in)
 * 2. Navigate to Facebook Marketplace
 * 3. Perform a sample search
 * 4. Log all GraphQL doc_ids it finds
 * 5. Save them to src/facebook/queries.ts
 */

import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const CHROME_USER_DATA = path.join(
  os.homedir(),
  "Library/Application Support/Google/Chrome"
);

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

  // Intercept GraphQL requests
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/graphql")) {
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

  console.log("Navigating to Facebook Marketplace...");
  await page.goto("https://www.facebook.com/marketplace/", {
    waitUntil: "networkidle",
    timeout: 30000,
  });

  console.log("\nPage loaded. Performing a sample search...");
  await page.waitForTimeout(3000);

  // Try to search
  try {
    const searchInput = page.locator(
      'input[placeholder*="Search"], input[aria-label*="Search"]'
    );
    if (await searchInput.isVisible({ timeout: 5000 })) {
      await searchInput.fill("laptop");
      await searchInput.press("Enter");
      await page.waitForTimeout(5000);
    }
  } catch {
    console.log("Could not find search input. Try searching manually.");
  }

  console.log("\n⏳ Waiting 30 seconds for more queries...");
  console.log("   Browse around Marketplace to capture more doc_ids.");
  console.log("   Click on listings, change categories, etc.\n");
  await page.waitForTimeout(30000);

  await browser.close();

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
    JSON.stringify([...unique.values()], null, 2)
  );
  console.log(`\nSaved to ${outputPath}`);
  console.log(
    "\nUpdate src/facebook/queries.ts with the new doc_id values if they changed."
  );
}

main().catch(console.error);
