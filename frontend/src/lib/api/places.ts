import type { Location, LocationCategory } from "@/types";
import { apiFetch } from "./client";

/** A place found on OpenStreetMap that is not a WanderMap location yet. */
export interface PlaceSuggestion {
  /** Stable id ("osm:N123"), sent as google_place_id when the place is added. */
  key: string;
  name: string;
  address: string;
  city?: string;
  country?: string;
  countryCode?: string;
  coordinates: { lat: number; lng: number };
  category: LocationCategory;
  /** Raw OSM classification, e.g. "natural:waterfall". */
  kind: string;
}

export interface PlaceSearchResult {
  existing: Location[];
  external: PlaceSuggestion[];
  /** false when the OpenStreetMap lookup failed (existing locations are still returned). */
  externalAvailable: boolean;
}

export interface PlaceSearchParams {
  q: string;
  scope: "vn" | "world";
  /** Bias results toward this point (map centre). */
  lat?: number;
  lng?: number;
  limit?: number;
}

/** Requires login. Existing locations first (accent-insensitive), then OpenStreetMap places. */
export const searchPlaces = (params: PlaceSearchParams, signal?: AbortSignal) =>
  apiFetch<PlaceSearchResult>("/places/search", { query: { ...params }, signal });