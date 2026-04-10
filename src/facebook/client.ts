import type {
  FacebookSession,
  SearchParams,
  SearchResult,
  MarketplaceListingDetail,
} from "./types.js";
import {
  extractChromeCookies,
  cookiesToHeader,
  getCookieValue,
} from "./auth.js";
import {
  MARKETPLACE_SEARCH_DOC_ID,
  LOCATION_SEARCH_DOC_ID,
  LISTING_DETAIL_DOC_ID,
  buildSearchVariables,
  buildLocationSearchVariables,
} from "./queries.js";
import { parseSearchResponse, parseListingDetailFromPage } from "./parser.js";
import { RateLimiter } from "../utils/rate-limit.js";

const GRAPHQL_URL = "https://www.facebook.com/api/graphql/";
const MARKETPLACE_URL = "https://www.facebook.com/marketplace/";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "en-US,en;q=0.9",
  "sec-ch-ua": '"Chromium";v="146", "Google Chrome";v="146", "Not?A_Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
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
  private chromeProfile: string;

  constructor(
    options: {
      maxRequestsPerMinute?: number;
      chromeProfile?: string;
    } = {}
  ) {
    this.rateLimiter = new RateLimiter(options.maxRequestsPerMinute ?? 3);
    this.chromeProfile = options.chromeProfile ?? "Default";
  }

  async ensureSession(): Promise<FacebookSession> {
    if (this.session) return this.session;
    return this.initSession();
  }

  async initSession(): Promise<FacebookSession> {
    const cookies = extractChromeCookies("facebook.com", this.chromeProfile);

    if (cookies.length === 0) {
      throw new Error(
        "No Facebook cookies found in Chrome. Make sure you're logged into Facebook in Chrome."
      );
    }

    const userId = getCookieValue(cookies, "c_user");
    if (!userId) {
      throw new Error(
        "No c_user cookie found. Make sure you're logged into Facebook in Chrome."
      );
    }

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

    const res = await fetch(MARKETPLACE_URL, {
      headers: {
        ...BROWSER_HEADERS,
        Cookie: cookieHeader,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      throw new Error(
        `Failed to fetch marketplace page: ${res.status} ${res.statusText}`
      );
    }

    const html = await res.text();

    // Extract fb_dtsg from DTSGInitData or DTSGInitialData
    const dtsgMatch =
      html.match(/"DTSGInitData"\s*,\s*\[\]\s*,\s*\{"token"\s*:\s*"([^"]+)"/) ??
      html.match(/"DTSGInitialData"\s*,\s*\[\]\s*,\s*\{"token"\s*:\s*"([^"]+)"/) ??
      html.match(/"dtsg"\s*:\s*\{"token"\s*:\s*"([^"]+)"/);

    if (!dtsgMatch) {
      throw new Error(
        "Failed to extract fb_dtsg token. Session may be expired — try logging into Facebook in Chrome again."
      );
    }
    const fbDtsg = dtsgMatch[1];

    // Extract jazoest
    const jazoestMatch = html.match(/jazoest=(\d+)/);
    const jazoest = jazoestMatch ? jazoestMatch[1] : "";

    // Extract lsd
    const lsdMatch = html.match(/"LSD"\s*,\s*\[\]\s*,\s*\{"token"\s*:\s*"([^"]+)"/) ??
      html.match(/name="lsd"\s+value="([^"]+)"/);
    const lsd = lsdMatch ? lsdMatch[1] : "";

    // Extract client revision
    const revMatch = html.match(/"client_revision"\s*:\s*(\d+)/) ??
      html.match(/__spin_r:\s*(\d+)/);
    const clientRevision = revMatch ? revMatch[1] : "1";

    return { fbDtsg, lsd, jazoest, clientRevision };
  }

  private async graphqlRequest(
    docId: string,
    variables: Record<string, unknown>
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

    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
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
    });

    if (res.status === 401 || res.status === 403) {
      // Session expired — clear and retry once
      this.session = null;
      throw new Error("Session expired. Re-initializing on next request.");
    }

    if (!res.ok) {
      throw new Error(`GraphQL request failed: ${res.status} ${res.statusText}`);
    }

    let text = await res.text();

    // Strip Facebook's anti-JSONP prefix
    const jsonStart = text.indexOf("{");
    if (jsonStart > 0) {
      text = text.slice(jsonStart);
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Failed to parse GraphQL response: ${text.slice(0, 200)}`);
    }
  }

  async searchListings(params: SearchParams): Promise<SearchResult> {
    const variables = buildSearchVariables(params);
    const data = await this.graphqlRequest(MARKETPLACE_SEARCH_DOC_ID, variables);
    return parseSearchResponse(data);
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
    const res = await fetch(url, {
      headers: {
        ...BROWSER_HEADERS,
        Cookie: session.cookieHeader,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch listing ${listingId}: ${res.status}`);
    }

    const html = await res.text();
    return parseListingDetailFromPage(html, listingId);
  }

  async searchLocation(
    query: string
  ): Promise<Array<{ name: string; latitude: number; longitude: number }>> {
    const variables = buildLocationSearchVariables(query);
    const data = await this.graphqlRequest(LOCATION_SEARCH_DOC_ID, variables);

    try {
      const results = (data as any)?.data?.city_street_search?.street_results?.edges ?? [];
      return results.map((edge: any) => ({
        name: edge.node?.single_line_address ?? edge.node?.subtitle ?? "Unknown",
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
