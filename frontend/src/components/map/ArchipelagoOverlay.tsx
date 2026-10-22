"use client";

import { useEffect } from "react";
import { Layer, Source, useMap as useReactMapGl } from "react-map-gl";
import {
  archipelagoLabelLayer,
  hideArchipelagoBaseLabels,
  VIETNAM_ARCHIPELAGOS,
} from "@/lib/mapbox/archipelagos";

/** Map-local context only; do not call the application's Explore useMap hook here. */
export function ArchipelagoOverlay() {
  const { current: mapRef } = useReactMapGl();
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const setup = () => hideArchipelagoBaseLabels(map);
    map.on("style.load", setup);
    if (map.isStyleLoaded()) setup();
    return () => {
      map.off("style.load", setup);
    };
  }, [mapRef]);
  return (
    <Source id="vn-archipelagos" type="geojson" data={VIETNAM_ARCHIPELAGOS}>
      <Layer {...archipelagoLabelLayer()} />
    </Source>
  );
}
