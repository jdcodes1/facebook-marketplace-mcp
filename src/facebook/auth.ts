import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import type { FacebookCookie } from "./types.js";

const CHROME_SALT = "saltysalt";
const CHROME_ITERATIONS = 1003;
const CHROME_KEY_LENGTH = 16;
const CHROME_IV = Buffer.alloc(16, " ");

export type BrowserName = "chrome" | "edge" | "brave";

interface BrowserConfig {
  /** Directory name under "~/Library/Application Support" on macOS. */
  macDirName: string;
  /** macOS Keychain service/account names for the cookie-encryption password. */
  macKeychainService: string;
  macKeychainAccount: string;
  /** Path segments under %LOCALAPPDATA% on Windows, ending in "User Data". */
  winDirParts: string[];
  label: string;
}

const BROWSER_CONFIGS: Record<BrowserName, BrowserConfig> = {
  chrome: {
    macDirName: "Google/Chrome",
    macKeychainService: "Chrome Safe Storage",
    macKeychainAccount: "Chrome",
    winDirParts: ["Google", "Chrome", "User Data"],
    label: "Google Chrome",
  },
  edge: {
    macDirName: "Microsoft Edge",
    macKeychainService: "Microsoft Edge Safe Storage",
    macKeychainAccount: "Microsoft Edge",
    winDirParts: ["Microsoft", "Edge", "User Data"],
    label: "Microsoft Edge",
  },
  brave: {
    macDirName: "BraveSoftware/Brave-Browser",
    macKeychainService: "Brave Safe Storage",
    macKeychainAccount: "Brave",
    winDirParts: ["BraveSoftware", "Brave-Browser", "User Data"],
    label: "Brave",
  },
};

function isBrowserName(value: string): value is BrowserName {
  return value in BROWSER_CONFIGS;
}

export function resolveBrowserName(value: string | undefined): BrowserName {
  const normalized = (value ?? "chrome").toLowerCase();
  if (!isBrowserName(normalized)) {
    throw new Error(
      `Unsupported browser "${value}". Supported browsers: ${Object.keys(BROWSER_CONFIGS).join(", ")}.`
    );
  }
  return normalized;
}

function getChromePassword(config: BrowserConfig): string {
  try {
    return execSync(
      `security find-generic-password -w -s "${config.macKeychainService}" -a "${config.macKeychainAccount}"`,
      { stdio: ["pipe", "pipe", "pipe"] }
    )
      .toString()
      .trim();
  } catch {
    throw new Error(
      `Failed to get ${config.label} password from Keychain. ` +
        `Make sure ${config.label} is installed and you approve the Keychain prompt.`
    );
  }
}

function deriveChromeKey(password: string): Buffer {
  return crypto.pbkdf2Sync(
    password,
    CHROME_SALT,
    CHROME_ITERATIONS,
    CHROME_KEY_LENGTH,
    "sha1"
  );
}

function decryptCookieValueMac(encrypted: Buffer, key: Buffer): string {
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

function getLocalAppData(): string {
  return (
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local")
  );
}

function getWinUserDataDir(config: BrowserConfig): string {
  return path.join(getLocalAppData(), ...config.winDirParts);
}

// Shells out to PowerShell's DPAPI binding since Node has no built-in
// CryptUnprotectData — Chrome's Windows master key and (on very old
// versions) cookie values are protected with it.
function decryptDPAPI(data: Buffer): Buffer {
  const inputB64 = data.toString("base64");
  try {
    const outputB64 = execSync(
      `powershell -NoProfile -NonInteractive -Command "$b=[Convert]::FromBase64String('${inputB64}'); $d=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($d)"`,
      { stdio: ["pipe", "pipe", "pipe"] }
    )
      .toString()
      .trim();
    return Buffer.from(outputB64, "base64");
  } catch {
    throw new Error(
      "Failed to decrypt DPAPI-protected data via PowerShell. " +
        "Make sure PowerShell is available on PATH."
    );
  }
}

function getWindowsMasterKey(config: BrowserConfig): Buffer {
  const localStatePath = path.join(getWinUserDataDir(config), "Local State");

  let localState: { os_crypt?: { encrypted_key?: string } };
  try {
    localState = JSON.parse(fs.readFileSync(localStatePath, "utf8"));
  } catch {
    throw new Error(
      `Failed to read ${config.label}'s Local State file at ${localStatePath}. ` +
        `Make sure ${config.label} is installed.`
    );
  }

  const encryptedKeyB64 = localState.os_crypt?.encrypted_key;
  if (!encryptedKeyB64) {
    throw new Error(
      `Could not find os_crypt.encrypted_key in ${localStatePath}`
    );
  }

  const encryptedKey = Buffer.from(encryptedKeyB64, "base64");
  const dpapiPrefix = encryptedKey.subarray(0, 5).toString("ascii");
  if (dpapiPrefix !== "DPAPI") {
    throw new Error(
      `Unexpected ${config.label} master key format (missing DPAPI prefix).`
    );
  }

  return decryptDPAPI(encryptedKey.subarray(5));
}

function decryptCookieValueWindows(encrypted: Buffer, key: Buffer): string {
  if (encrypted.length === 0) return "";

  const prefix = encrypted.subarray(0, 3).toString("ascii");
  if (prefix !== "v10" && prefix !== "v11") {
    // Pre-Chrome-80: the value itself is DPAPI-protected directly.
    try {
      return decryptDPAPI(encrypted).toString("utf8");
    } catch {
      return encrypted.toString("utf8");
    }
  }

  // v10/v11: AES-256-GCM with a 12-byte nonce and 16-byte auth tag.
  const nonce = encrypted.subarray(3, 15);
  const authTag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(15, encrypted.length - 16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(authTag);
  const decoded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decoded.toString("utf8");
}

function getCookieDbPath(config: BrowserConfig, profile: string): string {
  if (process.platform === "win32") {
    const base = path.join(getWinUserDataDir(config), profile);
    // Modern Chromium keeps cookies under Network\Cookies; older versions
    // kept them directly in the profile directory.
    const networkPath = path.join(base, "Network", "Cookies");
    if (fs.existsSync(networkPath)) return networkPath;
    return path.join(base, "Cookies");
  }

  return path.join(
    os.homedir(),
    "Library/Application Support",
    config.macDirName,
    profile,
    "Cookies"
  );
}

function listAvailableProfiles(config: BrowserConfig): string[] {
  const userDataDir =
    process.platform === "win32"
      ? getWinUserDataDir(config)
      : path.join(os.homedir(), "Library/Application Support", config.macDirName);

  try {
    return fs
      .readdirSync(userDataDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          (entry.name === "Default" || /^Profile \d+$/.test(entry.name))
      )
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export function extractChromeCookies(
  domain: string,
  profile = "Default",
  browser: BrowserName = "chrome"
): FacebookCookie[] {
  const isWindows = process.platform === "win32";
  const config = BROWSER_CONFIGS[browser];
  const cookiePath = getCookieDbPath(config, profile);

  if (!fs.existsSync(cookiePath)) {
    const available = listAvailableProfiles(config);
    const hint =
      available.length > 0
        ? ` Available profiles for ${config.label}: ${available.join(", ")}.`
        : ` Make sure ${config.label} is installed and has been run at least once.`;
    throw new Error(
      `Could not find ${config.label} cookie database at ${cookiePath} (profile "${profile}").${hint}`
    );
  }

  // Chrome locks the DB while running — copy it first
  const tmpPath = path.join(os.tmpdir(), `${browser}_cookies_${Date.now()}`);
  try {
    fs.copyFileSync(cookiePath, tmpPath);
  } catch {
    throw new Error(
      `Failed to copy ${config.label} cookie DB from ${cookiePath}. ` +
        `Make sure ${config.label} isn't blocking access to its profile files.`
    );
  }

  const key = isWindows
    ? getWindowsMasterKey(config)
    : deriveChromeKey(getChromePassword(config));
  const decryptCookieValue = isWindows
    ? decryptCookieValueWindows
    : decryptCookieValueMac;

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
         WHERE host_key LIKE ?`
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
      if (
        !value &&
        row.encrypted_value &&
        row.encrypted_value.length > 0
      ) {
        value = decryptCookieValue(row.encrypted_value, key);
      }
      return {
        host: row.host_key,
        name: row.name,
        value,
        path: row.path,
        expires: row.expires_utc,
        secure: !!row.is_secure,
        httpOnly: !!row.is_httponly,
      };
    });
  } finally {
    db.close();
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // cleanup failure is non-fatal
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
  name: string
): string | undefined {
  return cookies.find((c) => c.name === name)?.value;
}
