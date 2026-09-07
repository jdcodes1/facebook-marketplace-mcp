#!/usr/bin/env tsx

import { createInterface } from "node:readline/promises";
import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import {
  DEFAULT_FACEBOOK_SESSION_FILE,
  saveFacebookCookiesToFile,
} from "./auth.js";
import type { FacebookCookie } from "./types.js";

const MARKETPLACE_URL = "https://www.facebook.com/marketplace/";
const DEFAULT_LOGIN_PROFILE_DIRECTORY = path.resolve(
  process.cwd(),
  ".local/facebook-login-profile",
);

interface LoginCookie {
  domain: string;
  name: string;
  value: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
}

interface LoginResponse {
  ok(): boolean;
  url(): string;
}

interface LoginPage {
  evaluate(pageFunction: () => string): Promise<string>;
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number },
  ): Promise<LoginResponse | null>;
}

interface LoginContext {
  pages(): LoginPage[];
  newPage(): Promise<LoginPage>;
  cookies(urls: string[]): Promise<LoginCookie[]>;
  close(): Promise<void>;
}

type LoginLauncher = (profileDirectory: string) => Promise<LoginContext>;

export interface FacebookLoginOptions {
  loginProfileDirectory?: string;
  sessionFile?: string;
  launch?: LoginLauncher;
  waitForConfirmation?: () => Promise<void>;
  writeOutput?: (message: string) => void;
}

function isFacebookMarketplaceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      (host === "facebook.com" || host.endsWith(".facebook.com")) &&
      parsed.pathname.startsWith("/marketplace")
    );
  } catch {
    return false;
  }
}

function ensurePrivateLoginProfile(profileDirectory: string): void {
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
  if (lstatSync(profileDirectory).isSymbolicLink()) {
    throw new Error("Facebook login profile must not be a symbolic link.");
  }
  chmodSync(profileDirectory, 0o700);
}

export function normalizeFacebookLoginCookies(
  cookies: LoginCookie[],
): FacebookCookie[] {
  return cookies
    .filter((cookie) => {
      const domain = cookie.domain.toLowerCase().replace(/^\./, "");
      return domain === "facebook.com" || domain.endsWith(".facebook.com");
    })
    .map((cookie) => ({
      host: cookie.domain,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path || "/",
      expires: cookie.expires > 0 ? Math.floor(cookie.expires) : 0,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
    }));
}

async function launchChrome(profileDirectory: string): Promise<LoginContext> {
  return chromium.launchPersistentContext(profileDirectory, {
    channel: "chrome",
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

async function waitForTerminalConfirmation(): Promise<void> {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    await terminal.question(
      "Finish Facebook login, return to Marketplace, then press Enter to save the session. ",
    );
  } finally {
    terminal.close();
  }
}

function assertHealthyMarketplace(response: LoginResponse | null): void {
  if (!response?.ok() || !isFacebookMarketplaceUrl(response.url())) {
    throw new Error(
      "Marketplace is not authenticated. Complete any Facebook login or checkpoint, return to Marketplace, then run npm run login again.",
    );
  }
}

export async function runFacebookLogin(
  options: FacebookLoginOptions = {},
): Promise<void> {
  const profileDirectory =
    options.loginProfileDirectory ?? DEFAULT_LOGIN_PROFILE_DIRECTORY;
  const sessionFile = options.sessionFile ?? DEFAULT_FACEBOOK_SESSION_FILE;
  const launch = options.launch ?? launchChrome;
  const waitForConfirmation =
    options.waitForConfirmation ?? waitForTerminalConfirmation;
  const writeOutput = options.writeOutput ?? console.log;

  ensurePrivateLoginProfile(profileDirectory);

  let context: LoginContext | undefined;
  try {
    context = await launch(profileDirectory);
    const page = context.pages()[0] ?? (await context.newPage());

    writeOutput(
      "Opening Facebook Marketplace in a dedicated Chrome profile...",
    );
    await page.goto(MARKETPLACE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await waitForConfirmation();

    const response = await page.goto(MARKETPLACE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    assertHealthyMarketplace(response);

    const cookies = normalizeFacebookLoginCookies(
      await context.cookies([MARKETPLACE_URL]),
    );
    const userAgent = await page.evaluate(() => navigator.userAgent);
    saveFacebookCookiesToFile(sessionFile, cookies, userAgent);
    writeOutput(`Saved Facebook session cookies to ${sessionFile}.`);
  } finally {
    await context?.close().catch(() => undefined);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runFacebookLogin().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`Facebook login failed: ${message}`);
    process.exitCode = 1;
  });
}
