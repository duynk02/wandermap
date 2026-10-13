"use client";

import { useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import Supercluster from "supercluster";
import type { MapRef } from "react-map-gl";
import { useMapStore } from "@/stores/mapStore";
import { toBounds } from "@/lib/mapbox";
import { QUERY_KEYS, MAP_CLUSTER_MAX_ZOOM, MAP_PINS_LIMIT } from "@/constants";
import type { Location, MapBounds } from "@/types";

// Fetch locations for current viewport from our API
async function fetchViewportLocations(
  bounds: MapBounds,
  filters: object
): Promise<Location[]> {
  const params = new URLSearchParams({
    north: String(bounds.north),
    south: String(bounds.south),
    east: String(bounds.east),
    west: String(bounds.west),
    limit: String(MAP_PINS_LIMIT),
    ...Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])
    ),
  });

  const res = await fetch(`/api/locations?${params}`);
  if (!res.ok) throw new Error("Failed to fetch locations");
  return res.json();
}

export function useMap() {
  const mapRef = useRef<MapRef>(null);
  const { viewport, bounds, filters, setViewport, setBounds } = useMapStore();

  // Fetch pins whenever viewport changes
  const { data: locations = [], isLoading } = useQuery({
    queryKey: QUERY_KEYS.locations.viewport({ bounds, filters }),
    queryFn: () => fetchViewportLocations(bounds!, filters),
    enabled: !!bounds,
    staleTime: 30_000, // 30s — avoid refetch on minor pan
  });

  // Build supercluster index from current locations
  const clusterIndex = useRef<Supercluster | null>(null);

  const getClusteredPins = useCallback(() => {
    if (!locations.length || !bounds) return [];

    // (Re)build index when locations change
    clusterIndex.current = new Supercluster({
      radius: 60,
      maxZoom: MAP_CLUSTER_MAX_ZOOM,
    });

    clusterIndex.current.load(
      locations.map((loc) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [loc.coordinates.lng, loc.coordinates.lat] },
        properties: { id: loc.id, locationId: loc.id, ...loc },
      }))
    );

    return clusterIndex.current.getClusters(
      [bounds.west, bounds.south, bounds.east, bounds.north],
      Math.floor(viewport.zoom)
    );
  }, [locations, bounds, viewport.zoom]);

  // Handle map move end
  const onMoveEnd = useCallback(() => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    const newBounds = map.getBounds();
    setBounds(toBounds(newBounds));
    setViewport({
      longitude: map.getCenter().lng,
      latitude: map.getCenter().lat,
      zoom: map.getZoom(),
    });
  }, [setBounds, setViewport]);

  // Fly to a specific location
  const flyTo = useCallback((lng: number, lat: number, zoom = 14) => {
    mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 1200 });
  }, []);

  // Expand a cluster on click
  const expandCluster = useCallback((clusterId: number, lng: number, lat: number) => {
    if (!clusterIndex.current) return;
    const expansionZoom = Math.min(
      clusterIndex.current.getClusterExpansionZoom(clusterId),
      MAP_CLUSTER_MAX_ZOOM
    );
    mapRef.current?.flyTo({ center: [lng, lat], zoom: expansionZoom, duration: 800 });
  }, []);

  return {
    mapRef,
    viewport,
    locations,
    isLoading,
    getClusteredPins,
    onMoveEnd,
    flyTo,
    expandCluster,
  };
}
