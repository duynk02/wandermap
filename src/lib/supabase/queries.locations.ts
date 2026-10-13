import { createClient } from "./server";
import type { Location, MapBounds, LocationFilters } from "@/types";

// Fetch pins visible in current map viewport
// Uses PostGIS ST_MakeEnvelope for efficient spatial query
export async function getLocationsInViewport(
  bounds: MapBounds,
  filters?: LocationFilters,
  limit = 200
): Promise<Location[]> {
  const supabase = await createClient();

  let query = supabase.rpc("get_locations_in_viewport", {
    min_lng: bounds.west,
    min_lat: bounds.south,
    max_lng: bounds.east,
    max_lat: bounds.north,
    result_limit: limit,
  });

  // Apply optional filters
  if (filters?.category) query = query.eq("category", filters.category);
  if (filters?.minRating) query = query.gte("avg_rating", filters.minRating);
  if (filters?.country) query = query.eq("country", filters.country);

  const { data, error } = await query;
  if (error) throw new Error(`getLocationsInViewport: ${error.message}`);
  return data ?? [];
}

// Fetch trending locations globally (homepage initial load)
export async function getTrendingLocations(limit = 50): Promise<Location[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("locations")
    .select("*")
    .gt("post_count", 3) // Only show locations with real content
    .order("trending_score", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getTrendingLocations: ${error.message}`);
  return data ?? [];
}

// Fetch single location with aggregated stats
export async function getLocationById(id: string): Promise<Location | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("locations")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return null;
  return data;
}

// Upsert location — used when user creates a post at a new or existing location
export async function upsertLocation(
  payload: Pick<Location, "name" | "address" | "coordinates" | "category" | "google_place_id">
) {
  const supabase = await createClient();

  // If google_place_id exists, try to find existing location first
  if (payload.google_place_id) {
    const { data: existing } = await supabase
      .from("locations")
      .select("id")
      .eq("google_place_id", payload.google_place_id)
      .single();

    if (existing) return existing.id;
  }

  const { data, error } = await supabase
    .from("locations")
    .insert({
      ...payload,
      // Convert lat/lng back to PostGIS point string
      coordinates: `POINT(${payload.coordinates.lng} ${payload.coordinates.lat})`,
    })
    .select("id")
    .single();

  if (error) throw new Error(`upsertLocation: ${error.message}`);
  return data.id;
}
