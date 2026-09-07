import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FacebookClient } from "../src/facebook/client.js";
import { captureListingPageHtml } from "../src/facebook/raw-capture.js";
import type { FacebookSession } from "../src/facebook/types.js";

async function withCaptureDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(
    join(tmpdir(), "marketplace-raw-capture-test-"),
  );
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("does not create raw captures unless explicitly enabled", async () => {
  await withCaptureDirectory(async (directory) => {
    const captureDirectory = join(directory, "captures");
    await captureListingPageHtml("listing-1", "<html>private</html>", {
      enabled: false,
      directory: captureDirectory,
    });

    await assert.rejects(stat(captureDirectory));
  });
});

test("writes exact opted-in HTML with owner-only permissions", async () => {
  await withCaptureDirectory(async (directory) => {
    const captureDirectory = join(directory, "captures");
    const html =
      "<html><body>c_user=private-cookie &amp; unchanged</body></html>";
    await captureListingPageHtml("listing/1", html, {
      enabled: true,
      directory: captureDirectory,
    });

    const files = await readdir(captureDirectory);
    assert.equal(files.length, 1);
    assert.match(files[0], /listing_1/);
    assert.equal(
      await readFile(join(captureDirectory, files[0]), "utf8"),
      html,
    );
    assert.equal((await stat(captureDirectory)).mode & 0o777, 0o700);
    assert.equal(
      (await stat(join(captureDirectory, files[0]))).mode & 0o777,
      0o600,
    );
  });
});

test("capture failures do not change the caller's control flow", async () => {
  await withCaptureDirectory(async (directory) => {
    const fileInsteadOfDirectory = join(directory, "not-a-directory");
    await writeFile(fileInsteadOfDirectory, "occupied", "utf8");

    await assert.doesNotReject(
      captureListingPageHtml("listing-1", "<html>private</html>", {
        enabled: true,
        directory: fileInsteadOfDirectory,
      }),
    );
  });
});

test("captures a non-successful listing response before returning its error", async () => {
  await withCaptureDirectory(async (directory) => {
    const previousFetch = globalThis.fetch;
    const previousCaptureEnabled = process.env.MCP_CAPTURE_LISTING_HTML;
    const previousCaptureDirectory = process.env.MCP_LISTING_CAPTURE_DIR;
    const html = "<html><body>Facebook login page</body></html>";
    process.env.MCP_CAPTURE_LISTING_HTML = "1";
    process.env.MCP_LISTING_CAPTURE_DIR = directory;
    globalThis.fetch = (async () =>
      new Response(html, { status: 403 })) as typeof fetch;

    try {
      const client = new FacebookClient();
      (client as unknown as { session: FacebookSession }).session = {
        cookies: [],
        cookieHeader: "c_user=private-user",
        fbDtsg: "",
        lsd: "",
        jazoest: "",
        clientRevision: "",
        userId: "private-user",
      };

      await assert.rejects(client.getListingDetail("listing-403"), /403/);
      const files = await readdir(directory);
      assert.equal(files.length, 1);
      assert.equal(await readFile(join(directory, files[0]), "utf8"), html);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousCaptureEnabled === undefined) delete process.env.MCP_CAPTURE_LISTING_HTML;
      else process.env.MCP_CAPTURE_LISTING_HTML = previousCaptureEnabled;
      if (previousCaptureDirectory === undefined) {
        delete process.env.MCP_LISTING_CAPTURE_DIR;
      } else {
        process.env.MCP_LISTING_CAPTURE_DIR = previousCaptureDirectory;
      }
    }
  });
});
