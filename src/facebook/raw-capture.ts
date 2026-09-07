import { chmod, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const DEFAULT_CAPTURE_DIRECTORY = ".local/listing-page-captures";

export type ListingPageCaptureOptions = {
  enabled?: boolean;
  directory?: string;
};

function captureEnabled(options: ListingPageCaptureOptions): boolean {
  return options.enabled ?? process.env.MCP_CAPTURE_LISTING_HTML === "1";
}

function captureDirectory(options: ListingPageCaptureOptions): string {
  return resolve(
    options.directory ??
      process.env.MCP_LISTING_CAPTURE_DIR ??
      DEFAULT_CAPTURE_DIRECTORY,
  );
}

function filenamePart(value: string): string {
  const safeValue = value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return safeValue || "listing";
}

/**
 * Saves an exact listing-page response only when explicitly enabled. Captures
 * are deliberately separate from sanitized MCP diagnostics and never affect a
 * Marketplace request when local storage is unavailable.
 */
export async function captureListingPageHtml(
  listingId: string,
  html: string,
  options: ListingPageCaptureOptions = {},
): Promise<void> {
  if (!captureEnabled(options)) return;

  try {
    const directory = captureDirectory(options);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = resolve(
      directory,
      `${timestamp}-${filenamePart(listingId)}-${randomUUID()}.html`,
    );
    await writeFile(path, html, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch {
    process.stderr.write(
      "[facebook-marketplace-mcp] could not capture listing page HTML\n",
    );
  }
}
