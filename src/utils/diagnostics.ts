import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const REDACTED = "[REDACTED]";
const MAX_STRING_LENGTH = 500;
const MAX_DEPTH = 4;

export type FacebookRequestContext = {
  operation: "marketplace-bootstrap" | "graphql" | "listing-page";
  method: "GET" | "POST";
  path: string;
  status?: number;
  docId?: string;
  responseBytes?: number;
};

export class MarketplaceRequestError extends Error {
  readonly request: FacebookRequestContext;

  constructor(
    message: string,
    request: FacebookRequestContext,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MarketplaceRequestError";
    this.request = request;
  }
}

export type ToolFailureRecord = {
  timestamp: string;
  correlationId: string;
  tool: string;
  input: unknown;
  error: {
    name: string;
    message: string;
    request?: FacebookRequestContext;
  };
};

function isSensitiveKey(key: string): boolean {
  return /(authorization|cookie|csrf|dtsg|lsd|jazoest|token|secret|password|session|header|body|html|response)/i.test(
    key,
  );
}

function sanitizeString(value: string): string {
  const truncated = value.slice(0, MAX_STRING_LENGTH);
  if (/(?:<!doctype|<html|<body|<script|^\s*[\[{]\s*\")/i.test(truncated)) {
    return "[REDACTED RAW CONTENT]";
  }
  return truncated
    .replace(
      /\b(authorization|cookie|csrf|token|secret|password)\s*([:=])\s*[^\s,;]+/gi,
      (_match, key: string, separator: string) =>
        `${key}${separator}${REDACTED}`,
    )
    .replace(
      /\b(?:c_user|xs|datr|fr|sb)=[^;\s]+/gi,
      (match) => `${match.split("=")[0]}=${REDACTED}`,
    );
}

function sanitizeValue(value: unknown, key?: string, depth = 0): unknown {
  if (key && isSensitiveKey(key)) return REDACTED;
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null)
    return value;
  if (Array.isArray(value))
    return value
      .slice(0, 50)
      .map((item) => sanitizeValue(item, undefined, depth + 1));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = sanitizeValue(childValue, childKey, depth + 1);
    }
    return result;
  }
  return String(value);
}

function normalizeError(error: unknown): ToolFailureRecord["error"] {
  if (error instanceof MarketplaceRequestError) {
    return {
      name: error.name,
      message: sanitizeString(error.message),
      request: error.request,
    };
  }

  if (error instanceof Error) {
    return { name: error.name, message: sanitizeString(error.message) };
  }

  return { name: "UnknownError", message: sanitizeString(String(error)) };
}

function diagnosticLogPath(): string {
  return resolve(process.env.MCP_ERROR_LOG_PATH ?? ".local/mcp-errors.jsonl");
}

export async function recordToolFailure(
  tool: string,
  input: unknown,
  error: unknown,
  options: { logPath?: string } = {},
): Promise<string> {
  const correlationId = randomUUID();
  const record: ToolFailureRecord = {
    timestamp: new Date().toISOString(),
    correlationId,
    tool,
    input: sanitizeValue(input),
    error: normalizeError(error),
  };
  const logPath = options.logPath
    ? resolve(options.logPath)
    : diagnosticLogPath();

  try {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");
  } catch (logError) {
    const message =
      logError instanceof Error
        ? sanitizeString(logError.message)
        : "unknown error";
    process.stderr.write(
      `[facebook-marketplace-mcp] could not record diagnostic: ${message}\n`,
    );
  }

  return correlationId;
}

export async function toolErrorResponse(
  tool: string,
  input: unknown,
  error: unknown,
  prefix = "Error",
) {
  const correlationId = await recordToolFailure(tool, input, error);
  const message =
    error instanceof Error
      ? sanitizeString(error.message)
      : sanitizeString(String(error));

  return {
    content: [
      {
        type: "text" as const,
        text: `${prefix}: ${message} (diagnostic ID: ${correlationId})`,
      },
    ],
    isError: true,
  };
}
