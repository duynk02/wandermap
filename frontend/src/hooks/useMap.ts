"use client";

import { useCallback, useMemo, useRef } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Supercluster from "supercluster";
import type { MapRef } from "react-map-gl";
import { useMapStore } from "@/stores/mapStore";
import { toBounds } from "@/lib/mapbox";
import { getLocationsInViewport } from "@/lib/api";
import { QUERY_KEYS, MAP_CLUSTER_MAX_ZOOM, MAP_PINS_LIMIT } from "@/constants";
import type { MapBounds } from "@/types";

/** One cluster or one pin, as returned by Supercluster. */
export type MapCluster = ReturnType<Supercluster["getClusters"]>[number];

// Query area is snapped outward to ~1 km so tiny pans do not create a new query key (and a new
// request) every time, while still always covering the visible viewport.
const STEP = 0.01;
const snapDown = (n: number) => Math.floor(n / STEP) * STEP;
const snapUp = (n: number) => Math.ceil(n / STEP) * STEP;
const snapBounds = (b: MapBounds): MapBounds => ({
  south: snapDown(b.south),
  west: snapDown(b.west),
  north: snapUp(b.north),
  east: snapUp(b.east),
});

/**
 * Use ONCE per map, in MapCanvas. Every call creates its own mapRef, query observer and
 * cluster index, so a second call (e.g. in a child) is not connected to the real map.
 */
export function useMap() {
  const mapRef = useRef<MapRef>(null);

  // Selectors: subscribing to the whole store would re-render the map on every hover.
  const viewport = useMapStore((s) => s.viewport);
  const bounds = useMapStore((s) => s.bounds);
  const filters = useMapStore((s) => s.filters);
  const setViewport = useMapStore((s) => s.setViewport);
  const setBounds = useMapStore((s) => s.setBounds);

  const queryBounds = useMemo(() => (bounds ? snapBounds(bounds) : null), [bounds]);

  // Fetch pins whenever the viewport changes
  const { data: locations = [], isLoading } = useQuery({
    queryKey: QUERY_KEYS.locations.viewport({ bounds: queryBounds, filters }),
    queryFn: () => getLocationsInViewport(queryBounds!, filters, MAP_PINS_LIMIT),
    enabled: !!queryBounds,
    staleTime: 30_000,
    // Keep showing the previous pins while the next viewport loads. Without this the list
    // becomes [] on every pan, so all pins vanish and re-animate in: the main source of flicker.
    placeholderData: keepPreviousData,
  });

  // Rebuilt only when the data changes, not on every render/hover
  const clusterIndex = useMemo(() => {
    const index = new Supercluster({ radius: 60, maxZoom: MAP_CLUSTER_MAX_ZOOM });
    index.load(
      locations.map((loc) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [loc.coordinates.lng, loc.coordinates.lat] },
        properties: { locationId: loc.id, ...loc }, // `id` comes from ...loc
      }))
    );
    return index;
  }, [locations]);

  const clusters = useMemo<MapCluster[]>(
    () =>
      bounds
        ? clusterIndex.getClusters(
            [bounds.west, bounds.south, bounds.east, bounds.north],
            Math.floor(viewport.zoom)
          )
        : [],
    [clusterIndex, bounds, viewport.zoom]
  );

  const onMoveEnd = useCallback(() => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    const newBounds = map.getBounds();
    if (!newBounds) return;
    setBounds(toBounds(newBounds));
    setViewport({
      longitude: map.getCenter().lng,
      latitude: map.getCenter().lat,
      zoom: map.getZoom(),
    });
  }, [setBounds, setViewport]);

  const flyTo = useCallback((lng: number, lat: number, zoom = 14) => {
    mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 1200 });
  }, []);

  // Zoom into a cluster. Uses the same index that produced it (a different hook instance has an
  // empty index, which is why clicking clusters did nothing before).
  const expandCluster = useCallback(
    (clusterId: number, lng: number, lat: number) => {
      // +1: points are still clustered AT maxZoom, so go one level beyond to split them.
      const zoom = Math.min(clusterIndex.getClusterExpansionZoom(clusterId), MAP_CLUSTER_MAX_ZOOM + 1);
      mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 800 });
    },
    [clusterIndex]
  );

  return {
    mapRef,
    viewport,
    locations,
    clusters,
    /** True until the first viewport result arrives (show the server-rendered pins until then). */
    isInitialLoad: !bounds || isLoading,
    onMoveEnd,
    flyTo,
    expandCluster,
  };
}