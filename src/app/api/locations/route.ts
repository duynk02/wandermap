import { NextRequest, NextResponse } from "next/server";
import { getLocationsInViewport, getTrendingLocations } from "@/lib/supabase/queries.locations";
import type { LocationFilters, MapBounds } from "@/types";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const north = searchParams.get("north");
  const south = searchParams.get("south");
  const east = searchParams.get("east");
  const west = searchParams.get("west");

  // If no bounds provided, return global trending
  if (!north || !south || !east || !west) {
    const trending = await getTrendingLocations(50);
    return NextResponse.json(trending);
  }

  const bounds: MapBounds = {
    north: parseFloat(north),
    south: parseFloat(south),
    east: parseFloat(east),
    west: parseFloat(west),
  };

  const filters: LocationFilters = {
    category: (searchParams.get("category") as LocationFilters["category"]) ?? null,
    minRating: searchParams.get("minRating") ? Number(searchParams.get("minRating")) : null,
    country: searchParams.get("country") ?? null,
    searchQuery: searchParams.get("q") ?? null,
  };

  const limit = Math.min(parseInt(searchParams.get("limit") ?? "200"), 500);

  try {
    const locations = await getLocationsInViewport(bounds, filters, limit);
    return NextResponse.json(locations, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error("[GET /api/locations]", error);
    return NextResponse.json({ error: "Failed to fetch locations" }, { status: 500 });
  }
}
