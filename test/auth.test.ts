import assert from "node:assert/strict";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadFacebookCookies,
  loadFacebookCookiesFromFile,
  saveFacebookCookiesToFile,
} from "../src/facebook/auth.js";

function withSessionFile(
  content: string,
  run: (filePath: string) => void,
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

test("loads the login session format", () => {
  withSessionFile(JSON.stringify({ version: 1, userAgent: "Browser/150", cookies: validCookies }), (filePath) => {
    const cookies = loadFacebookCookies({ sessionFile: filePath });
    assert.deepEqual(cookies.map(cookie => cookie.name), ["c_user", "xs"]);
    assert.equal(cookies[0].httpOnly, true);
  });
});

test("refuses to overwrite a symbolic-link session file", () => {
  const directory = mkdtempSync(join(tmpdir(), "facebook-session-test-"));
  const target = join(directory, "target.json");
  const link = join(directory, "session.json");
  writeFileSync(target, "keep me", { mode: 0o600 });
  symlinkSync(target, link);
  try {
    assert.throws(
      () =>
        saveFacebookCookiesToFile(link, [
          {
            host: ".facebook.com",
            name: "c_user",
            value: "test-user",
            path: "/",
            expires: futureExpiry,
            secure: true,
            httpOnly: true,
          },
          {
            host: ".facebook.com",
            name: "xs",
            value: "test-session",
            path: "/",
            expires: futureExpiry,
            secure: true,
            httpOnly: true,
          },
        ], "Browser/150"),
      /not a symbolic link/,
    );
    assert.equal(readFileSync(target, "utf8"), "keep me");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects files with missing, expired, or non-Facebook session cookies", () => {
  withSessionFile(
    JSON.stringify({ version: 1, userAgent: "Browser/150", cookies: [{ ...validCookies[0], expirationDate: 1 }] }),
    (filePath) => {
      assert.throws(
        () => loadFacebookCookiesFromFile(filePath),
        /no active c_user cookie/,
      );
    },
  );

  withSessionFile(
    JSON.stringify({ version: 1, userAgent: "Browser/150", cookies: [
      { ...validCookies[0], domain: ".example.com" },
      validCookies[1],
    ] }),
    (filePath) => {
      assert.throws(
        () => loadFacebookCookiesFromFile(filePath),
        /not scoped to facebook\.com/,
      );
    },
  );
});

test("reports invalid sessions without exposing cookie values", () => {
  withSessionFile(JSON.stringify({ version: 1, userAgent: "Browser/150", cookies: [{ name: "c_user", value: "secret" }] }), filePath => {
    assert.throws(() => loadFacebookCookies({ sessionFile: filePath }), (error: Error) => {
      assert.match(error.message, /npm run login/);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
  });
});
