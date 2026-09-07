import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadFacebookCookiesFromFile, loadFacebookSessionFromFile } from "../src/facebook/auth.js";
import {
  normalizeFacebookLoginCookies,
  runFacebookLogin,
} from "../src/facebook/login.js";

const futureExpiry = Math.floor(Date.now() / 1000) + 3600;

function loginCookies() {
  return [
    {
      domain: ".facebook.com",
      name: "c_user",
      value: "test-user",
      path: "/",
      expires: futureExpiry,
      secure: true,
      httpOnly: true,
    },
    {
      domain: ".facebook.com",
      name: "xs",
      value: "test-session",
      path: "/",
      expires: -1,
      secure: true,
      httpOnly: true,
    },
  ];
}

test("normalizes browser session-cookie expiry and ignores non-Facebook cookies", () => {
  const cookies = normalizeFacebookLoginCookies([
    ...loginCookies(),
    {
      domain: ".example.com",
      name: "unrelated",
      value: "ignored",
      path: "/",
      expires: futureExpiry,
      secure: true,
      httpOnly: true,
    },
  ]);

  assert.equal(cookies.length, 2);
  assert.equal(cookies[1].expires, 0);
});

test("saves cookies only after a healthy Marketplace validation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "facebook-login-test-"));
  const profileDirectory = join(directory, "profile");
  const sessionFile = join(directory, "session.json");
  let closeCalls = 0;
  const page = {
    async evaluate() { return "TestBrowser/150.0"; },
    async goto() {
      return {
        ok: () => true,
        url: () => "https://www.facebook.com/marketplace/",
      };
    },
  };

  try {
    await runFacebookLogin({
      loginProfileDirectory: profileDirectory,
      sessionFile,
      launch: async () => ({
        pages: () => [page],
        newPage: async () => page,
        cookies: async () => loginCookies(),
        close: async () => {
          closeCalls += 1;
        },
      }),
      waitForConfirmation: async () => undefined,
      writeOutput: () => undefined,
    });

    assert.equal(loadFacebookSessionFromFile(sessionFile).userAgent, "TestBrowser/150.0");
    assert.equal(closeCalls, 1);
    assert.deepEqual(
      loadFacebookCookiesFromFile(sessionFile).map((cookie) => cookie.name),
      ["c_user", "xs"],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not save cookies after an unhealthy Marketplace response", async () => {
  const directory = mkdtempSync(join(tmpdir(), "facebook-login-test-"));
  const profileDirectory = join(directory, "profile");
  const sessionFile = join(directory, "session.json");
  let closeCalls = 0;
  const page = {
    async evaluate() { return "TestBrowser/150.0"; },
    async goto() {
      return {
        ok: () => true,
        url: () => "https://www.facebook.com/checkpoint/",
      };
    },
  };

  try {
    await assert.rejects(
      () =>
        runFacebookLogin({
          loginProfileDirectory: profileDirectory,
          sessionFile,
          launch: async () => ({
            pages: () => [page],
            newPage: async () => page,
            cookies: async () => loginCookies(),
            close: async () => {
              closeCalls += 1;
            },
          }),
          waitForConfirmation: async () => undefined,
          writeOutput: () => undefined,
        }),
      /Marketplace is not authenticated/,
    );

    assert.equal(closeCalls, 1);
    assert.equal(existsSync(sessionFile), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
