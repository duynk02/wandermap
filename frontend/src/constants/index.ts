import type { LocationCategory } from "@/types";

export const APP_NAME = "WanderMap";
export const APP_DESCRIPTION = "Khám phá thế giới qua lăng kính của những người đã đi";

// Map defaults
export const MAP_DEFAULT_ZOOM = 5.5;
export const MAP_MIN_ZOOM = 2;
export const MAP_MAX_ZOOM = 18;
export const MAP_CLUSTER_MAX_ZOOM = 14; // Zoom level to stop clustering

// Pagination
export const DEFAULT_PAGE_SIZE = 12;
export const MAP_PINS_LIMIT = 200; // Max pins to fetch per viewport

// Trending — minimum post count before a location shows as a pin
export const TRENDING_MIN_POSTS = 3;

// Upload limits
export const MAX_POST_IMAGES = 10;
export const MAX_IMAGE_SIZE_MB = 10;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

// Location categories with display labels
export const LOCATION_CATEGORIES: {
  value: LocationCategory;
  label: string;
  icon: string;
}[] = [
  { value: "camping", label: "Cắm trại", icon: "⛺" },
  { value: "cafe", label: "Cafe", icon: "☕" },
  { value: "heritage", label: "Di tích", icon: "🏛️" },
  { value: "beach", label: "Biển", icon: "🏖️" },
  { value: "mountain", label: "Núi", icon: "⛰️" },
  { value: "street_food", label: "Ẩm thực đường phố", icon: "🍜" },
  { value: "waterfall", label: "Thác nước", icon: "💧" },
  { value: "village", label: "Làng bản", icon: "🏘️" },
  { value: "other", label: "Khác", icon: "📍" },
];

// Query keys for TanStack Query
export const QUERY_KEYS = {
  messaging: {
    all: ["messaging"] as const,
    viewer: (viewer: string) => ["messaging", viewer] as const,
    conversations: (viewer: string) => ["messaging", viewer, "conversations"] as const,
    conversation: (viewer: string, id: string) => ["messaging", viewer, "conversation", id] as const,
    messages: (viewer: string, id: string) => ["messaging", viewer, "messages", id] as const,
    unreadCount: (viewer: string) => ["messaging", viewer, "unread-count"] as const,
    contacts: (viewer: string, search: string, kind: "friends" | "followers" = "friends") => ["messaging", viewer, "contacts", kind, search] as const,
  },
  travelMap: {
    all: ["travel-map"] as const,
    data: (username: string, viewer: string, filters: object) => ["travel-map", username, viewer, filters] as const,
  },
  journeys: {
    all: ["journeys"] as const,
    list: (username: string, viewer: string) => ["journeys", "list", username, viewer] as const,
    byId: (id: string, viewer: string) => ["journeys", "detail", id, viewer] as const,
  },
  visitedLocations: {
    all: ["visited-locations"] as const,
    mine: (viewer: string, filters: object = {}) => ["visited-locations", "mine", viewer, filters] as const,
    visits: (viewer: string, id: string) => ["visited-locations", "visits", viewer, id] as const,
    public: (username: string, viewer: string, filters: object = {}) => ["visited-locations", "profile", username, viewer, filters] as const,
  },
  locations: {
    all: ["locations"] as const,
    viewport: (bounds: object) => ["locations", "viewport", bounds] as const,
    trending: ["locations", "trending"] as const,
    byId: (id: string) => ["locations", id] as const,
  },
  posts: {
    all: ["posts"] as const,
    saved: (viewer: string) => ["posts", "saved", viewer] as const,
    byJourney: (id: string, viewer: string) => ["posts", "journey", id, viewer] as const,
    feed: (filters: object) => ["posts", "feed", filters] as const,
    byLocation: (locationId: string) => ["posts", "location", locationId] as const,
    byId: (id: string) => ["posts", id] as const,
  },
  notifications: {
    all: ["notifications"] as const,
    list: (viewer: string) => ["notifications", "list", viewer] as const,
    unreadCount: (viewer: string) => ["notifications", "unread-count", viewer] as const,
  },
  comments: {
    all: ["comments"] as const,
    /** Authoritative counters returned when a comment/reply is created. */
    byPost: (postId: string, viewer: string) => ["comments", "post", postId, viewer] as const,
    replies: (commentId: string, viewer: string) => ["comments", "replies", commentId, viewer] as const,
  },

  profiles: {
    relations: (username: string, relation: string, viewer: string) => ["profiles", username, "relations", viewer, relation] as const,
    byUsername: (username: string) => ["profiles", username] as const,
    me: ["profiles", "me"] as const,
  },
} as const;

// Routes
export const ROUTES = {
  home: "/",
  explore: "/explore",
  feed: "/feed",
  messages: "/messages",
  conversation: (id: string) => `/messages/${id}`,
  notifications: "/notifications",
  login: "/auth/login",
  register: "/auth/register",
  profile: (username: string) => `/profile/${username}`,
  location: (id: string) => `/location/${id}`,
  post: (id: string) => `/post/${id}`,
  itinerary: (id: string) => `/itinerary/${id}`,
  journey: (id: string) => `/journey/${id}`,
  newPost: "/post/new",
} as const;


// Comments. Keep COMMENT_MAX_LENGTH in sync with the API (backend/src/comments/dto/create-comment.dto.ts).
export const COMMENT_MAX_LENGTH = 2000;
export const COMMENTS_PAGE_SIZE = 10; // Number of top-level comments to fetch per page
