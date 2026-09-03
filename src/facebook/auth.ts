import crypto from "node:crypto";
import { execSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import type { FacebookCookie } from "./types.js";

const CHROME_SALT = "saltysalt";
const CHROME_ITERATIONS = 1003;
const CHROME_KEY_LENGTH = 16;
const CHROME_IV = Buffer.alloc(16, " ");
const CHROME_EPOCH_OFFSET_SECONDS = 11_644_473_600;

export const DEFAULT_FACEBOOK_SESSION_FILE = path.resolve(
  process.cwd(),
  ".local/facebook-session.json",
);

type CookieExtractor = (domain: string, profile?: string) => FacebookCookie[];

interface CookieFileEntry {
  name?: unknown;
  value?: unknown;
  host?: unknown;
  domain?: unknown;
  path?: unknown;
  expires?: unknown;
  expirationDate?: unknown;
  secure?: unknown;
  httpOnly?: unknown;
  is_secure?: unknown;
  is_httponly?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFacebookDomain(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\./, "");
  return normalized === "facebook.com" || normalized.endsWith(".facebook.com");
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1;
}

function getExpiry(entry: CookieFileEntry): number {
  const raw = entry.expirationDate ?? entry.expires;
  if (raw === undefined || raw === null || raw === "") return 0;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    throw new Error("cookie expiry must be a non-negative number");
  }
  return raw;
}

function requireSessionCookies(cookies: FacebookCookie[]): FacebookCookie[] {
  const nowInSeconds = Date.now() / 1000;
  const activeCookies = cookies.filter(
    (cookie) => cookie.expires === 0 || cookie.expires > nowInSeconds,
  );

  for (const name of ["c_user", "xs"]) {
    if (!getCookieValue(activeCookies, name)) {
      throw new Error(`session file has no active ${name} cookie`);
    }
  }

  return activeCookies;
}

function chromeExpiryToUnixSeconds(expiresUtc: number): number {
  if (!expiresUtc) return 0;
  return Math.max(
    0,
    Math.floor(expiresUtc / 1_000_000 - CHROME_EPOCH_OFFSET_SECONDS),
  );
}

function getChromePassword(): string {
  try {
    return execSync(
      'security find-generic-password -w -s "Chrome Safe Storage" -a "Chrome"',
      { stdio: ["pipe", "pipe", "pipe"] },
    )
      .toString()
      .trim();
  } catch {
    throw new Error(
      "Failed to get Chrome password from Keychain. " +
        "Make sure Chrome is installed and you approve the Keychain prompt.",
    );
  }
}

function deriveChromeKey(password: string): Buffer {
  return crypto.pbkdf2Sync(
    password,
    CHROME_SALT,
    CHROME_ITERATIONS,
    CHROME_KEY_LENGTH,
    "sha1",
  );
}

function decryptCookieValue(encrypted: Buffer, key: Buffer): string {
  if (encrypted.length === 0) return "";

  // Check for v10 prefix (macOS Chrome encryption)
  const prefix = encrypted.slice(0, 3).toString("ascii");
  if (prefix !== "v10") {
    // Not encrypted or unknown format
    return encrypted.toString("utf8");
  }

  const data = encrypted.slice(3);
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, CHROME_IV);
  decipher.setAutoPadding(false);

  let decoded = Buffer.concat([decipher.update(data), decipher.final()]);

  // Remove PKCS7 padding
  const padding = decoded[decoded.length - 1];
  if (padding && padding > 0 && padding <= 16) {
    decoded = decoded.slice(0, decoded.length - padding);
  }

  // Chrome prepends a 32-byte header to cookie values before encrypting.
  // Skip it to get the actual value.
  if (decoded.length > 32) {
    decoded = decoded.slice(32);
  }

  return decoded.toString("utf8");
}

function getCookieDbPath(profile = "Default"): string {
  return path.join(
    os.homedir(),
    "Library/Application Support/Google/Chrome",
    profile,
    "Cookies",
  );
}

export function extractChromeCookies(
  domain: string,
  profile = "Default",
): FacebookCookie[] {
  const cookiePath = getCookieDbPath(profile);

  // Chrome locks the DB while running — copy it first
  const tmpPath = path.join(os.tmpdir(), `chrome_cookies_${Date.now()}`);
  try {
    execSync(`cp "${cookiePath}" "${tmpPath}"`, {
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      `Failed to copy Chrome cookie DB from ${cookiePath}. ` +
        "Make sure Chrome is installed and the profile exists.",
    );
  }

  const password = getChromePassword();
  const key = deriveChromeKey(password);

  let db: Database.Database;
  try {
    db = new Database(tmpPath, { readonly: true });
  } catch {
    throw new Error(`Failed to open cookie database at ${tmpPath}`);
  }

  try {
    const rows = db
      .prepare(
        `SELECT host_key, name, value, encrypted_value, path, expires_utc,
                is_secure, is_httponly
         FROM cookies
         WHERE host_key LIKE ?`,
      )
      .all(`%${domain}`) as Array<{
      host_key: string;
      name: string;
      value: string;
      encrypted_value: Buffer;
      path: string;
      expires_utc: number;
      is_secure: number;
      is_httponly: number;
    }>;

    return rows.map((row) => {
      let value = row.value;
      if (!value && row.encrypted_value && row.encrypted_value.length > 0) {
        value = decryptCookieValue(row.encrypted_value, key);
      }
      return {
        host: row.host_key,
        name: row.name,
        value,
        path: row.path,
        expires: chromeExpiryToUnixSeconds(row.expires_utc),
        secure: !!row.is_secure,
        httpOnly: !!row.is_httponly,
      };
    });
  } finally {
    db.close();
    try {
      execSync(`rm -f "${tmpPath}"`, { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      // cleanup failure is non-fatal
    }
  }
}

/**
 * Persists normalized Facebook cookies in the same JSON envelope accepted by
 * loadFacebookCookiesFromFile. The snapshot is private to the current user.
 */
export function saveFacebookCookiesToFile(
  filePath: string,
  cookies: FacebookCookie[],
): void {
  const activeCookies = requireSessionCookies(cookies);
  const directory = path.dirname(filePath);

  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (lstatSync(directory).isSymbolicLink()) {
      throw new Error("session directory is a symbolic link");
    }
    if (existsSync(filePath) && lstatSync(filePath).isSymbolicLink()) {
      throw new Error("session file is a symbolic link");
    }

    const temporaryDirectory = mkdtempSync(
      path.join(directory, ".facebook-session-"),
    );
    const temporaryFile = path.join(temporaryDirectory, "snapshot.json");
    try {
      chmodSync(temporaryDirectory, 0o700);
      writeFileSync(
        temporaryFile,
        `${JSON.stringify(
          {
            version: 1,
            exportedAt: new Date().toISOString(),
            cookies: activeCookies.map((cookie) => ({
              name: cookie.name,
              value: cookie.value,
              domain: cookie.host,
              path: cookie.path,
              expirationDate: cookie.expires,
              secure: cookie.secure,
              httpOnly: cookie.httpOnly,
            })),
          },
          null,
          2,
        )}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      chmodSync(temporaryFile, 0o600);
      renameSync(temporaryFile, filePath);
      chmodSync(filePath, 0o600);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  } catch {
    throw new Error(
      `Could not persist Facebook cookies to ${filePath}. Check that the session path is writable and not a symbolic link.`,
    );
  }
}

/**
 * Loads cookies from a user-managed JSON file. The file may be a cookie array
 * or an object with a `cookies` array, matching common Chrome-export layouts.
 */
export function loadFacebookCookiesFromFile(
  filePath: string,
): FacebookCookie[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("could not read valid JSON from FACEBOOK_SESSION_FILE");
  }

  const entries = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.cookies)
      ? parsed.cookies
      : null;

  if (!entries) {
    throw new Error(
      "session file must be a cookie array or an object with a cookies array",
    );
  }

  const cookies = entries.map((entry, index): FacebookCookie => {
    if (!isRecord(entry)) {
      throw new Error(`cookie ${index + 1} must be an object`);
    }

    const cookie = entry as CookieFileEntry;
    if (typeof cookie.name !== "string" || !cookie.name) {
      throw new Error(`cookie ${index + 1} must have a name`);
    }
    if (typeof cookie.value !== "string" || !cookie.value) {
      throw new Error(`cookie ${index + 1} must have a value`);
    }

    const host =
      typeof cookie.domain === "string"
        ? cookie.domain
        : typeof cookie.host === "string"
          ? cookie.host
          : ".facebook.com";
    if (!isFacebookDomain(host)) {
      throw new Error(`cookie ${index + 1} is not scoped to facebook.com`);
    }

    return {
      host,
      name: cookie.name,
      value: cookie.value,
      path: typeof cookie.path === "string" ? cookie.path : "/",
      expires: getExpiry(cookie),
      secure: toBoolean(cookie.secure ?? cookie.is_secure),
      httpOnly: toBoolean(cookie.httpOnly ?? cookie.is_httponly),
    };
  });

  return requireSessionCookies(cookies);
}

export function loadFacebookCookies(options: {
  sessionFile?: string;
  chromeProfile?: string;
  extractChrome?: CookieExtractor;
}): FacebookCookie[] {
  const extractChrome = options.extractChrome ?? extractChromeCookies;

  if (!options.sessionFile) {
    return extractChrome("facebook.com", options.chromeProfile);
  }

  try {
    return loadFacebookCookiesFromFile(options.sessionFile);
  } catch (fileError) {
    try {
      const cookies = requireSessionCookies(
        extractChrome("facebook.com", options.chromeProfile),
      );
      saveFacebookCookiesToFile(options.sessionFile, cookies);
      return cookies;
    } catch (chromeError) {
      const fileMessage =
        fileError instanceof Error ? fileError.message : "unknown file error";
      const chromeMessage =
        chromeError instanceof Error
          ? chromeError.message
          : "unknown Chrome error";
      throw new Error(
        `Could not load Facebook cookies from FACEBOOK_SESSION_FILE (${fileMessage}) or Chrome (${chromeMessage}). Run npm run login after signing in to Facebook.`,
      );
    }
  }
}

export function cookiesToHeader(cookies: FacebookCookie[]): string {
  return cookies
    .map((c) => {
      // Strip non-Latin1 chars — fetch rejects them in Cookie headers
      const safe = c.value.replace(/[^\x00-\xFF]/g, "");
      return `${c.name}=${safe}`;
    })
    .join("; ");
}

export function getCookieValue(
  cookies: FacebookCookie[],
  name: string,
): string | undefined {
  return cookies.find((c) => c.name === name)?.value;
}
