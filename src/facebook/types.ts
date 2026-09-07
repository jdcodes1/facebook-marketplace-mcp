export interface FacebookCookie {
  host: string;
  name: string;
  value: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
}

export interface FacebookSession {
  cookies: FacebookCookie[];
  cookieHeader: string;
  fbDtsg: string;
  lsd: string;
  jazoest: string;
  clientRevision: string;
  userId: string;
}

export interface MarketplaceListing {
  id: string;
  title: string;
  price: string;
  location: string;
  imageUrl: string;
  sellerName: string;
  postedDate: string;
  url: string;
  isPending: boolean;
}

export interface MarketplaceListingDetail extends MarketplaceListing {
  description: string;
  images: string[];
  condition: string;
  seller: {
    name: string;
    profileUrl: string;
  };
}

export type SearchSortBy =
  | "suggested"
  | "distance"
  | "date_listed"
  | "price_low_to_high"
  | "price_high_to_low";

export type DeliveryMethod = "all" | "local_pickup" | "shipping";

export type DateListed =
  | "all"
  | "last_24_hours"
  | "last_7_days"
  | "last_30_days";

export interface SearchParams {
  query: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  minPrice?: number;
  maxPrice?: number;
  category?: string;
  sortBy?: SearchSortBy;
  deliveryMethod?: DeliveryMethod;
  dateListed?: DateListed;
  limit: number;
  cursor?: string;
}

export interface SearchResult {
  listings: MarketplaceListing[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface SavedMonitor {
  id: string;
  name: string;
  params: Omit<SearchParams, "cursor">;
  seenIds: string[];
  createdAt: string;
  lastChecked: string | null;
}
