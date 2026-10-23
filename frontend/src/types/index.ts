// ─────────────────────────────────────────
//  WanderMap — Core Domain Types
// ─────────────────────────────────────────

// ── Enums ──────────────────────────────────────────────────────────────────
export type * from "./journey";
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
  home_city: string | null;
  country_count: number;
  /** Unique visited locations visible to the viewer (independent of post count). */
  visited_location_count?: number;
  total_posts: number;
  followers_count: number;
  following_count: number;
  created_at: string;
  /** Only present on GET /users/:username when the viewer is logged in. */
  is_following?: boolean;
}

/** Authenticated profile as returned by login/register and GET /users/me. */
export interface CurrentUser extends Profile {
  email: string;
}

/** Minimal identity kept in the auth store. */
export interface AuthUser {
  id: string;
  email: string;
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

interface PostBase {
  id: string;
  author_id: string;
  content: string;
  images: string[];
  visibility: PostVisibility;
  likes_count: number;
  saves_count: number;
  comments_count: number;
  created_at: string;
  updated_at?: string;
  // Joined fields (when fetched with relations)
  author?: Profile & { is_following?: boolean };
  is_liked?: boolean;
  is_saved?: boolean;
}

export interface LocationPost extends PostBase {
  post_type?: "location"; // Older location-post responses remain supported.
  location_id: string;
  rating: number;
  visited_at: string;
  location?: Location;
  journey_id?: null;
}

export interface JourneyPost extends PostBase {
  post_type: "journey";
  location_id: null;
  rating: null;
  visited_at: null;
  location: null;
  journey_id: string;
  preview_revision: number;
  journey: Pick<import("./journey").JourneySummary, "id" | "title" | "revision" | "status" | "visibility" | "stop_count" | "preview_names">;
}

export type Post = LocationPost | JourneyPost;

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

/** A location on the user's personal map (GET /users/me/pins). */
export interface UserPin extends Location {
  status: PinStatus;
  pinned_at: string;
}

export type TravelVisibility = "public" | "private";

export interface VisitedLocation {
  id: string;
  user_id: string;
  location_id: string;
  note: string | null;
  visibility: TravelVisibility;
  created_at: string;
  updated_at: string;
  visit_count: number;
  last_visited_at: string | null;
  location: Pick<Location, "id" | "name" | "address" | "country" | "city" | "category" | "coordinates">;
}

export interface LocationVisit {
  id: string;
  visited_location_id: string;
  visited_at: string;
  note: string | null;
  created_at: string;
  updated_at: string;
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


//Comments
export type CommentAuthor = Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'>;
/** Named Postcomment to avoid shadowing the DOM `Comment` type. One reply level only. */
export interface PostComment {
  id: string;
  post_id: string;
  parent_id: string | null;
  content: string;
  likes_count: number;
  reply_count: number;
  created_at: string;
  edited_at: string | null;
  author: CommentAuthor;
  is_liked: boolean;
}

/** Comment/reply creation; older clients may omit the idempotency key. */
export interface CreateCommentInput {
  content: string;
  parent_id?: string;
  /** One UUID per user action; retries reuse it to avoid duplicate comments/notifications. */
  client_request_id?: string;
}

/** Authoritative counters returned when a comment/reply is created. */
export interface CreateCommentResult {
  comment: PostComment;
  post: { id: string; comments_count: number };
  parent: { id: string; reply_count: number } | null;
}

/** Authoritative counters returned when a comment is deleted. */
export interface DeleteCommentResult {
  deleted: number;
  post: { id: string; comments_count: number };
  parent: { id: string; reply_count: number } | null;
}



// Notifications
export type NotificationType = 'follow' | 'like' | 'comment' | 'comment_like' | 'reply';

/** One line of the notification list. All likes (or comments) on one post are a single item. */
export interface NotificationItem {
  id: string;
  type: NotificationType;
  /** The most recent distinct people (at most 2), newest first. */
  actors: CommentAuthor[];
  /** Total number of distinct people in the group. */
  actor_count: number;
  post: { id: string; excerpt: string; image: string | null } | null;
  is_unread: boolean;
  created_at: string;
}
