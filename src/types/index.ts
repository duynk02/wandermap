// ─────────────────────────────────────────
//  WanderMap — Core Domain Types
// ─────────────────────────────────────────

// ── Enums ──────────────────────────────────────────────────────────────────
export type LocationCategory =
  | "camping"
  | "cafe"
  | "heritage"
  | "beach"
  | "mountain"
  | "street_food"
  | "waterfall"
  | "village"
  | "other";

export type PostVisibility = "public" | "followers" | "private";

export type PinStatus = "visited" | "wishlist";

// ── Core Entities ───────────────────────────────────────────────────────────
export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  country_count: number;
  total_posts: number;
  followers_count: number;
  following_count: number;
  created_at: string;
}

export interface Location {
  id: string;
  name: string;
  address: string | null;
  // PostGIS geometry → parsed to lat/lng on the client
  coordinates: { lat: number; lng: number };
  country: string | null;
  city: string | null;
  category: LocationCategory;
  google_place_id: string | null;
  post_count: number;
  avg_rating: number | null;
  trending_score: number;
  created_at: string;
}

export interface Post {
  id: string;
  author_id: string;
  location_id: string;
  content: string;
  images: string[];
  rating: number; // 1-5
  visited_at: string; // ISO date
  visibility: PostVisibility;
  likes_count: number;
  saves_count: number;
  created_at: string;
  // Joined fields (when fetched with relations)
  author?: Profile;
  location?: Location;
  is_liked?: boolean;
  is_saved?: boolean;
}

export interface Itinerary {
  id: string;
  author_id: string;
  title: string;
  description: string | null;
  cover_image: string | null;
  is_public: boolean;
  total_days: number;
  created_at: string;
  author?: Profile;
  stops?: ItineraryStop[];
}

export interface ItineraryStop {
  id: string;
  itinerary_id: string;
  location_id: string;
  day_number: number;
  order_in_day: number;
  note: string | null;
  location?: Location;
}

// ── Map Types ───────────────────────────────────────────────────────────────
export interface MapViewport {
  longitude: number;
  latitude: number;
  zoom: number;
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface MapPin extends Location {
  status?: PinStatus; // Only present on personal map
}

// ── API Response Wrappers ───────────────────────────────────────────────────
export interface PaginatedResponse<T> {
  data: T[];
  count: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ApiError {
  message: string;
  code?: string;
  status?: number;
}

// ── Filter & Search ─────────────────────────────────────────────────────────
export interface LocationFilters {
  category?: LocationCategory | null;
  minRating?: number | null;
  country?: string | null;
  searchQuery?: string | null;
}

export interface FeedFilters {
  following?: boolean;
  location_id?: string;
  author_id?: string;
}
