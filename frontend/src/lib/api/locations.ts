import type {
  Location,
  LocationCategory,
  LocationFilters,
  MapBounds,
  PaginatedResponse,
} from "@/types";
import { apiFetch, nullOn404 } from "./client";
import type { PlaceSuggestion } from "./places";

const wrapLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;
const clampLat = (lat: number) => Math.max(-90, Math.min(90, lat));

/**
 * The API validates longitudes to [-180, 180], but Mapbox reports values outside that range
 * when the world repeats (zoomed out / panned across the antimeridian). Normalise first;
 * west > east after wrapping is handled server-side as an antimeridian crossing.
 */
export function normalizeBounds(bounds: MapBounds): MapBounds {
  const spansWorld = bounds.east - bounds.west >= 360;
  return {
    north: clampLat(bounds.north),
    south: clampLat(bounds.south),
    west: spansWorld ? -180 : wrapLng(bounds.west),
    east: spansWorld ? 180 : wrapLng(bounds.east),
  };
}

/** Pins inside the current map viewport (PostGIS bounding-box query on the API). */
export function getLocationsInViewport(
  bounds: MapBounds,
  filters?: LocationFilters,
  limit = 200
): Promise<Location[]> {
  const { north, south, east, west } = normalizeBounds(bounds);
  // `searchQuery` is deliberately not sent: the viewport endpoint has no text search and
  // rejects unknown parameters.
  return apiFetch<Location[]>("/locations/in-viewport", {
    query: {
      north,
      south,
      east,
      west,
      limit,
      category: filters?.category,
      minRating: filters?.minRating,
      country: filters?.country,
    },
  });
}

export const getTrendingLocations = (limit = 50) =>
  apiFetch<Location[]>("/locations/trending", { query: { limit } });

export const getLocationById = (id: string) =>
  nullOn404(apiFetch<Location>(`/locations/${encodeURIComponent(id)}`));

/** Text search over existing locations (name / city / country). */
export const searchLocations = (search: string, pageSize = 5, signal?: AbortSignal) =>
  apiFetch<PaginatedResponse<Location>>("/locations", { query: { search, pageSize }, signal });

export interface CreateLocationInput {
  name: string;
  address?: string;
  coordinates: { lat: number; lng: number };
  country?: string;
  city?: string;
  category?: LocationCategory;
  /** Dedupe key: the API reuses the row when this value already exists. */
  google_place_id?: string;
}

/** Requires login. Creates the location, or returns the existing one with the same google_place_id. */
export const createLocation = (input: CreateLocationInput) =>
  apiFetch<Location>("/locations", { method: "POST", body: input });

/** Resolve an OSM result independently of posts; the provider key makes retries idempotent. */
export const createLocationFromPlace = (place: PlaceSuggestion) =>
  createLocation({
    name: place.name.trim().slice(0, 200),
    address: place.address.slice(0, 500),
    coordinates: place.coordinates,
    city: place.city?.slice(0, 100),
    country: place.country?.slice(0, 100),
    category: place.category,
    google_place_id: place.key,
  });
