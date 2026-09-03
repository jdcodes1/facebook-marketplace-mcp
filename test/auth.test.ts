import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadFacebookCookies,
  loadFacebookCookiesFromFile,
} from "../src/facebook/auth.js";

function withSessionFile(
  content: string,
  run: (filePath: string) => void
): void {
  const directory = mkdtempSync(join(tmpdir(), "facebook-session-test-"));
  const filePath = join(directory, "session.json");
  writeFileSync(filePath, content, { mode: 0o600 });
  try {
    run(filePath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
const validCookies = [
  {
    name: "c_user",
    value: "test-user",
    domain: ".facebook.com",
    path: "/",
    expirationDate: futureExpiry,
    secure: true,
    httpOnly: true,
  },
  {
    name: "xs",
    value: "test-session",
    domain: ".facebook.com",
    expirationDate: futureExpiry,
  },
];

test("loads a Chrome-style JSON cookie file without invoking Chrome", () => {
  withSessionFile(JSON.stringify({ cookies: validCookies }), (filePath) => {
    const cookies = loadFacebookCookies({
      sessionFile: filePath,
      extractChrome: () => {
        throw new Error("Chrome should not be read");
      },
    });

    assert.deepEqual(
      cookies.map((cookie) => cookie.name),
      ["c_user", "xs"]
    );
    assert.equal(cookies[0].host, ".facebook.com");
    assert.equal(cookies[0].httpOnly, true);
  });
});

test("falls back to Chrome when the configured cookie file is invalid", () => {
  withSessionFile("not json", (filePath) => {
    const cookies = loadFacebookCookies({
      sessionFile: filePath,
      chromeProfile: "Profile 1",
      extractChrome: (domain, profile) => {
        assert.equal(domain, "facebook.com");
        assert.equal(profile, "Profile 1");
        return [
          {
            host: ".facebook.com",
            name: "c_user",
            value: "fallback-user",
            path: "/",
            expires: 0,
            secure: true,
            httpOnly: true,
          },
        ];
      },
    });

    assert.equal(cookies[0].value, "fallback-user");
  });
});

test("rejects files with missing, expired, or non-Facebook session cookies", () => {
  withSessionFile(
    JSON.stringify([{ ...validCookies[0], expirationDate: 1 }]),
    (filePath) => {
      assert.throws(
        () => loadFacebookCookiesFromFile(filePath),
        /no active c_user cookie/
      );
    }
  );

  withSessionFile(
    JSON.stringify([
      { ...validCookies[0], domain: ".example.com" },
      validCookies[1],
    ]),
    (filePath) => {
      assert.throws(
        () => loadFacebookCookiesFromFile(filePath),
        /not scoped to facebook\.com/
      );
    }
  );
});

test("reports both sources without exposing cookie values when both fail", () => {
  withSessionFile(JSON.stringify([{ name: "c_user", value: "secret" }]), (filePath) => {
    assert.throws(
      () =>
        loadFacebookCookies({
          sessionFile: filePath,
          extractChrome: () => {
            throw new Error("Keychain unavailable");
          },
        }),
      (error: Error) => {
        assert.match(error.message, /FACEBOOK_SESSION_FILE/);
        assert.match(error.message, /Keychain unavailable/);
        assert.doesNotMatch(error.message, /secret/);
        return true;
      }
    );
  });
});
