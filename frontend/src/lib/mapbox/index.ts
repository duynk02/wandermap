import type { MapBounds, LocationCategory } from "@/types";
import type { LngLatBounds } from "mapbox-gl";

// ── Map Config ───────────────────────────────────────────────────────────────
export const MAPBOX_STYLE = "mapbox://styles/mapbox/outdoors-v12"; // Good for travel
export const MAPBOX_STYLE_DARK = "mapbox://styles/mapbox/dark-v11";

export const DEFAULT_VIEWPORT = {
  longitude: 105.8412, // Vietnam center
  latitude: 15.0,
  zoom: 5.5,
};

// ── Bounds Conversion ────────────────────────────────────────────────────────
// Convert Mapbox LngLatBounds → our MapBounds type
export function toBounds(bounds: LngLatBounds): MapBounds {
  return {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest(),
  };
}

// ── Category → Marker Color ─────────────────────────────────────────────────
export const CATEGORY_COLORS: Record<LocationCategory, string> = {
  camping: "#22c55e",
  cafe: "#f59e0b",
  heritage: "#8b5cf6",
  beach: "#06b6d4",
  mountain: "#64748b",
  street_food: "#ef4444",
  waterfall: "#0ea5e9",
  village: "#d97706",
  other: "#6b7280",
};

export const CATEGORY_ICONS: Record<LocationCategory, string> = {
  camping: "⛺",
  cafe: "☕",
  heritage: "🏛️",
  beach: "🏖️",
  mountain: "⛰️",
  street_food: "🍜",
  waterfall: "💧",
  village: "🏘️",
  other: "📍",
};

// ── Geocoding ────────────────────────────────────────────────────────────────
export interface GeocodingResult {
  place_id: string;
  name: string;
  address: string;
  coordinates: { lat: number; lng: number };
  category?: string;
}

export async function geocodeSearch(query: string): Promise<GeocodingResult[]> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&language=vi,en&limit=5&types=poi,place,locality`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Geocoding request failed");

  const data = await res.json();

  return data.features.map((feature: any) => ({
    place_id: feature.id,
    name: feature.text,
    address: feature.place_name,
    coordinates: {
      lng: feature.center[0],
      lat: feature.center[1],
    },
  }));
}

// ── Distance ─────────────────────────────────────────────────────────────────
// Haversine formula — calculate km between two coordinates
export function getDistanceKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
