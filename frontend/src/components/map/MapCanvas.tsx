"use client";

import Map, { NavigationControl, GeolocateControl } from "react-map-gl";
import { useMap } from "@/hooks/useMap";
import { ClusterLayer } from "./ClusterLayer";
import { TrendingPins } from "./TrendingPins";
import { VietnamOverlay } from "./VietnamOverlay";
import { SearchPin } from "./SearchPin";
import { MAPBOX_STYLE } from "@/lib/mapbox";
import { useEffect } from "react";
import { useMapStore } from "@/stores/mapStore";
import type { Location } from "@/types";

interface MapCanvasProps {
  initialLocations: Location[];
}

export function MapCanvas({ initialLocations }: MapCanvasProps) {
  const { mapRef, viewport, clusters, isInitialLoad, expandCluster, onMoveEnd } = useMap();

  const flyToTarget = useMapStore((s) => s.flyToTarget);
  const clearFlyToTarget = useMapStore((s) => s.clearFlyToTarget);

  useEffect(() => {
    if (!flyToTarget || !mapRef.current) return;

    mapRef.current.flyTo({
      center: [
        flyToTarget.longitude,
        flyToTarget.latitude,
      ],
      zoom: flyToTarget.zoom,
      duration: 1200,
    });

    clearFlyToTarget();
  }, [flyToTarget, mapRef, clearFlyToTarget]);

  return (
    <Map
      ref={mapRef}
      mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
      mapStyle={MAPBOX_STYLE}
      initialViewState={viewport}
      onMoveEnd={onMoveEnd}
      style={{ width: "100%", height: "100%" }}
      // Performance
      renderWorldCopies={false}
      maxPitch={0}
      attributionControl={false}
    >
      {/* Zoom / compass controls */}
      <NavigationControl position="bottom-right" visualizePitch={false} />

      {/* "Find me" button */}
      <GeolocateControl
        position="bottom-right"
        trackUserLocation={false}
        showAccuracyCircle={false}
      />

      {/* Vietnam outline */}
      <VietnamOverlay />

      {/* Clustered dynamic pins — loads from viewport */}
      <ClusterLayer clusters={clusters} onExpandCluster={expandCluster} />

      {/* Server-rendered trending pins, only until the first viewport query returns */}
      {isInitialLoad && <TrendingPins locations={initialLocations} />}

      {/* Pin on the place chosen in the search box */}
      <SearchPin />
    </Map>
  );
}
