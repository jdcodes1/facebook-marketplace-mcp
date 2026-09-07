import type {
  FacebookSession,
  SearchParams,
  SearchResult,
  MarketplaceListingDetail,
} from "./types.js";
import {
  cookiesToHeader,
  getCookieValue,
  loadFacebookSession,
} from "./auth.js";
import {
  MARKETPLACE_SEARCH_DOC_ID,
  LOCATION_SEARCH_DOC_ID,
  LISTING_DETAIL_DOC_ID,
  buildSearchVariables,
  buildLocationSearchVariables,
} from "./queries.js";
import { parseSearchResponse, parseListingDetailFromPage } from "./parser.js";
import { captureListingPageHtml } from "./raw-capture.js";
import { RateLimiter } from "../utils/rate-limit.js";
import {
  MarketplaceRequestError,
  recordGraphqlWarning,
  type FacebookRequestContext,
} from "../utils/diagnostics.js";

const GRAPHQL_URL = "https://www.facebook.com/api/graphql/";
const MARKETPLACE_URL = "https://www.facebook.com/marketplace/";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function graphqlErrorSummary(response: Record<string, unknown>) {
  const errors = Array.isArray(response.errors)
    ? [...response.errors]
    : response.errors != null
      ? [response.errors]
      : [];
  if (
    response.error != null &&
    response.error !== false &&
    response.error !== 0
  ) {
    errors.push(response.error);
  }
  const codes: number[] = [];
  for (const error of errors) {
    const candidates = isRecord(error)
      ? [
          error.code,
          error.error_code,
          isRecord(error.extensions) ? error.extensions.code : undefined,
        ]
      : [error];
    for (const code of candidates) {
      if (typeof code === "number" && Number.isFinite(code)) codes.push(code);
    }
  }
  return { errorCount: errors.length, codes };
}

const BROWSER_HEADERS: Record<string, string> = {
  "Accept-Language": "en-US,en;q=0.9",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "Upgrade-Insecure-Requests": "1",
};

export class FacebookClient {
  private session: FacebookSession | null = null;
  private rateLimiter: RateLimiter;
  private reqCounter = 0;
  private sessionFile?: string;
  private userAgent = "";

  constructor(
    options: {
      maxRequestsPerMinute?: number;
      sessionFile?: string;
    } = {},
  ) {
    this.rateLimiter = new RateLimiter(options.maxRequestsPerMinute ?? 3);
    this.sessionFile = options.sessionFile;
  }

  async ensureSession(): Promise<FacebookSession> {
    if (this.session) return this.session;
    return this.initSession();
  }

  private async fetchFacebook(
    url: string,
    init: RequestInit,
    request: FacebookRequestContext,
  ): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (error) {
      throw new MarketplaceRequestError(
        "Facebook request could not be completed",
        request,
        {
          cause: error,
        },
      );
    }
  }

  async initSession(): Promise<FacebookSession> {
    const { cookies, userAgent } = loadFacebookSession({
      sessionFile: this.sessionFile,
    });

    if (cookies.length === 0) {
      throw new Error(
        "No Facebook cookies found. Provide a valid FACEBOOK_SESSION_FILE or run npm run login.",
      );
    }

    const userId = getCookieValue(cookies, "c_user");
    if (!userId) {
      throw new Error(
        "No c_user cookie found. Provide a valid FACEBOOK_SESSION_FILE or run npm run login.",
      );
    }

    this.userAgent = userAgent ?? USER_AGENT;
    const cookieHeader = cookiesToHeader(cookies);

    // Fetch marketplace page to extract tokens
    const tokens = await this.extractTokens(cookieHeader);

    this.session = {
      cookies,
      cookieHeader,
      userId,
      ...tokens,
    };

    return this.session;
  }

  private async extractTokens(cookieHeader: string): Promise<{
    fbDtsg: string;
    lsd: string;
    jazoest: string;
    clientRevision: string;
  }> {
    await this.rateLimiter.wait();

    const request = {
      operation: "marketplace-bootstrap" as const,
      method: "GET" as const,
      path: "/marketplace/",
    };
    const res = await this.fetchFacebook(
      MARKETPLACE_URL,
      {
        headers: {
          ...BROWSER_HEADERS,
          "User-Agent": this.userAgent,
          Cookie: cookieHeader,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        },
        redirect: "follow",
      },
      request,
    );

    if (!res.ok) {
      throw new MarketplaceRequestError(
        `Failed to fetch marketplace page: ${res.status} ${res.statusText}`,
        { ...request, status: res.status },
      );
    }

    const html = await res.text();

    // Extract fb_dtsg from DTSGInitData or DTSGInitialData
    const dtsgMatch =
      html.match(/"DTSGInitData"\s*,\s*\[\]\s*,\s*\{"token"\s*:\s*"([^"]+)"/) ??
      html.match(
        /"DTSGInitialData"\s*,\s*\[\]\s*,\s*\{"token"\s*:\s*"([^"]+)"/,
      ) ??
      html.match(/"dtsg"\s*:\s*\{"token"\s*:\s*"([^"]+)"/);

    if (!dtsgMatch) {
      throw new MarketplaceRequestError(
        "Failed to extract Facebook page tokens. Session may be expired — run npm run login.",
        { ...request, responseBytes: html.length },
      );
    }
    const fbDtsg = dtsgMatch[1];

    // Extract jazoest
    const jazoestMatch = html.match(/jazoest=(\d+)/);
    const jazoest = jazoestMatch ? jazoestMatch[1] : "";

    // Extract lsd
    const lsdMatch =
      html.match(/"LSD"\s*,\s*\[\]\s*,\s*\{"token"\s*:\s*"([^"]+)"/) ??
      html.match(/name="lsd"\s+value="([^"]+)"/);
    const lsd = lsdMatch ? lsdMatch[1] : "";

    // Extract client revision
    const revMatch =
      html.match(/"client_revision"\s*:\s*(\d+)/) ??
      html.match(/__spin_r:\s*(\d+)/);
    const clientRevision = revMatch ? revMatch[1] : "1";

    return { fbDtsg, lsd, jazoest, clientRevision };
  }

  private async graphqlRequest(
    docId: string,
    variables: Record<string, unknown>,
  ): Promise<unknown> {
    const session = await this.ensureSession();
    await this.rateLimiter.wait();

    this.reqCounter++;

    const body = new URLSearchParams({
      fb_dtsg: session.fbDtsg,
      lsd: session.lsd,
      jazoest: session.jazoest,
      doc_id: docId,
      variables: JSON.stringify(variables),
      __a: "1",
      __req: this.reqCounter.toString(36),
      __rev: session.clientRevision,
    });

    const request = {
      operation: "graphql" as const,
      method: "POST" as const,
      path: "/api/graphql/",
      docId,
    };
    const res = await this.fetchFacebook(
      GRAPHQL_URL,
      {
        method: "POST",
        headers: {
          ...BROWSER_HEADERS,
          "User-Agent": this.userAgent,
          Cookie: session.cookieHeader,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "*/*",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          Origin: "https://www.facebook.com",
          Referer: "https://www.facebook.com/marketplace/",
          "X-FB-LSD": session.lsd,
        },
        body: body.toString(),
      },
      request,
    );

    if (res.status === 401 || res.status === 403) {
      // Session expired — clear and retry once
      this.session = null;
      throw new MarketplaceRequestError(
        "Session expired. Re-initializing on next request.",
        {
          ...request,
          status: res.status,
        },
      );
    }

    if (!res.ok) {
      throw new MarketplaceRequestError(
        `GraphQL request failed: ${res.status} ${res.statusText}`,
        { ...request, status: res.status },
      );
    }

    const text = await res.text();
    const context = {
      ...request,
      status: res.status,
      responseBytes: Buffer.byteLength(text, "utf8"),
    };
    let data: unknown;
    try {
      // Strip only Facebook's anti-JSONP prefix, not arbitrary non-JSON content.
      data = JSON.parse(text.replace(/^\s*for\s*\(;;\);\s*/, ""));
    } catch {
      throw new MarketplaceRequestError(
        "Failed to parse GraphQL response",
        context,
      );
    }
    if (!isRecord(data)) {
      throw new MarketplaceRequestError(
        "Invalid GraphQL response envelope",
        context,
      );
    }
    const summary = graphqlErrorSummary(data);
    if (summary.errorCount > 0) {
      await recordGraphqlWarning(context, summary);
    }
    if (!isRecord(data.data)) {
      throw new MarketplaceRequestError(
        summary.errorCount > 0
          ? "Facebook returned GraphQL errors without usable data"
          : "GraphQL response is missing usable data",
        context,
      );
    }
    return data;
  }

  async searchListings(params: SearchParams): Promise<SearchResult> {
    const variables = buildSearchVariables(params);
    const data = await this.graphqlRequest(
      MARKETPLACE_SEARCH_DOC_ID,
      variables,
    );
    try {
      return parseSearchResponse(data);
    } catch (error) {
      throw new MarketplaceRequestError(
        "Failed to parse Marketplace search response",
        {
          operation: "graphql",
          method: "POST",
          path: "/api/graphql/",
          docId: MARKETPLACE_SEARCH_DOC_ID,
        },
        { cause: error },
      );
    }
  }

  async getListingDetail(listingId: string): Promise<MarketplaceListingDetail> {
    // If we have a doc_id for listing detail, use GraphQL
    if (LISTING_DETAIL_DOC_ID) {
      const data = await this.graphqlRequest(LISTING_DETAIL_DOC_ID, {
        targetId: listingId,
      });
      // Parse response (would need a dedicated parser)
      return data as MarketplaceListingDetail;
    }

    // Fallback: fetch the listing page directly and parse embedded data
    const session = await this.ensureSession();
    await this.rateLimiter.wait();

    const url = `https://www.facebook.com/marketplace/item/${listingId}/`;
    const request = {
      operation: "listing-page" as const,
      method: "GET" as const,
      path: "/marketplace/item/:listingId/",
    };
    const res = await this.fetchFacebook(
      url,
      {
        headers: {
          ...BROWSER_HEADERS,
          "User-Agent": this.userAgent,
          Cookie: session.cookieHeader,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        },
        redirect: "follow",
      },
      request,
    );

    // Capture before examining the response so opted-in diagnostics retain
    // successful pages as well as login, block, and error pages.
    const html = await res.text();
    await captureListingPageHtml(listingId, html);

    if (!res.ok) {
      throw new MarketplaceRequestError(
        `Failed to fetch listing ${listingId}: ${res.status}`,
        {
          ...request,
          status: res.status,
        },
      );
    }

    try {
      return parseListingDetailFromPage(html, listingId);
    } catch (error) {
      throw new MarketplaceRequestError(
        "Failed to parse listing response",
        {
          ...request,
          responseBytes: html.length,
        },
        { cause: error },
      );
    }
  }

  async searchLocation(
    query: string,
    viewerCoordinates?: { latitude: number; longitude: number },
  ): Promise<Array<{ name: string; latitude: number; longitude: number }>> {
    const variables = buildLocationSearchVariables(query, viewerCoordinates);
    const data = await this.graphqlRequest(LOCATION_SEARCH_DOC_ID, variables);

    try {
      const results =
        (data as any)?.data?.city_street_search?.street_results?.edges ?? [];
      return results.map((edge: any) => ({
        name:
          edge.node?.single_line_address ?? edge.node?.subtitle ?? "Unknown",
        latitude: edge.node?.location?.latitude ?? 0,
        longitude: edge.node?.location?.longitude ?? 0,
      }));
    } catch {
      return [];
    }
  }

  clearSession() {
    this.session = null;
    this.reqCounter = 0;
  }
}
