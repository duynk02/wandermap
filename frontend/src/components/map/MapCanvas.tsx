"use client";

import Map, { NavigationControl, GeolocateControl } from "react-map-gl";
import { useMap } from "@/hooks/useMap";
import { ClusterLayer } from "./ClusterLayer";
import { TrendingPins } from "./TrendingPins";
import { MAPBOX_STYLE } from "@/lib/mapbox";
import { useEffect } from "react";
import { useMapStore } from "@/stores/mapStore";
import type { Location } from "@/types";

interface MapCanvasProps {
  initialLocations: Location[];
}

export function MapCanvas({ initialLocations }: MapCanvasProps) {
  const { mapRef, viewport, getClusteredPins, onMoveEnd } = useMap();

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

      {/* Clustered dynamic pins — loads from viewport */}
      <ClusterLayer clusters={getClusteredPins()} />

      {/* Static trending pins for initial SSR data */}
      <TrendingPins locations={initialLocations} />
    </Map>
  );
}
