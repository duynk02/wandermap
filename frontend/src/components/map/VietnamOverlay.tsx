"use client";

import { useEffect, useState } from "react";
import { Layer, Source, useMap as useReactMapGl } from "react-map-gl";
import type { Map as MapboxMap } from "mapbox-gl";
import { ArchipelagoOverlay } from "./ArchipelagoOverlay";

const VN_RED = "#da251d";

/** Country polygons from Mapbox's public tileset (included with any access token). */
const COUNTRIES_TILESET = "mapbox://mapbox.country-boundaries-v1";
const SOURCE_LAYER = "country_boundaries";

// The tileset ships one polygon per worldview; keep the shared ("all") ones plus the US view so
// a country is never drawn twice.
const ISO = ["get", "iso_3166_1"];
const WORLDVIEW = ["any", ["==", ["get", "worldview"], "all"], ["in", "US", ["get", "worldview"]]];
const IS_VIETNAM = ["all", ["==", ISO, "VN"], WORLDVIEW];
const IS_OTHER_COUNTRY = ["all", ["!=", ISO, "VN"], WORLDVIEW];

/** Inserting below the first label layer keeps road/place names readable above our fills. */
function firstSymbolLayerId(map: MapboxMap): string | undefined {
  return map.getStyle()?.layers?.find((layer) => layer.type === "symbol")?.id;
}

/**
 * Makes Vietnam stand out (tinted fill, glowing outline, everything else faded) and labels
 * Hoàng Sa / Trường Sa. Render as a child of <Map>.
 */
export function VietnamOverlay() {
  const { current: mapRef } = useReactMapGl();
  // null = style not ready yet; "" = no symbol layer found (add on top)
  const [beforeId, setBeforeId] = useState<string | null>(null);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const setup = () => {
      setBeforeId(firstSymbolLayerId(map) ?? "");
    };
    // Keep country fills below basemap labels when the UI switches map styles.
    map.on("style.load", setup);
    if (map.isStyleLoaded()) setup();

    return () => {
      map.off("style.load", setup);
    };
  }, [mapRef]);

  if (beforeId === null) return null;
  const below = beforeId || undefined;

  return (
    <>
      <Source id="vn-countries" type="vector" url={COUNTRIES_TILESET}>
        {/* Fade the rest of the world so Vietnam reads as raised */}
        <Layer
          id="vn-others-fade"
          type="fill"
          source-layer={SOURCE_LAYER}
          filter={IS_OTHER_COUNTRY as never}
          beforeId={below}
          paint={{ "fill-color": "#ffffff", "fill-opacity": 0.38 }}
        />
        <Layer
          id="vn-fill"
          type="fill"
          source-layer={SOURCE_LAYER}
          filter={IS_VIETNAM as never}
          beforeId={below}
          paint={{ "fill-color": VN_RED, "fill-opacity": 0.07 }}
        />
        {/* Soft glow under the crisp outline */}
        <Layer
          id="vn-outline-glow"
          type="line"
          source-layer={SOURCE_LAYER}
          filter={IS_VIETNAM as never}
          beforeId={below}
          paint={{ "line-color": VN_RED, "line-width": 7, "line-blur": 5, "line-opacity": 0.35 }}
        />
        <Layer
          id="vn-outline"
          type="line"
          source-layer={SOURCE_LAYER}
          filter={IS_VIETNAM as never}
          beforeId={below}
          paint={{ "line-color": VN_RED, "line-width": 1.6, "line-opacity": 0.9 }}
        />
      </Source>

      <ArchipelagoOverlay />
    </>
  );
}
