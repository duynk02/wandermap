"use client";

import { useEffect, useState } from "react";
import { Layer, Source, useMap as useReactMapGl } from "react-map-gl";
import type { Map as MapboxMap } from "mapbox-gl";

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

/**
 * Archipelagos labelled by the Vietnamese sovereignty claim. Positions are the approximate
 * centre of each group, so the label sits over the group, not on a single island.
 */
const ARCHIPELAGOS: GeoJSON.FeatureCollection<GeoJSON.Point, { label: string }> = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { label: "Quần đảo Hoàng Sa\n(Việt Nam)" },
      geometry: { type: "Point", coordinates: [112.0, 16.5] },
    },
    {
      type: "Feature",
      properties: { label: "Quần đảo Trường Sa\n(Việt Nam)" },
      geometry: { type: "Point", coordinates: [114.0, 10.0] },
    },
  ],
};

/**
 * English names the base style uses for these groups. Matching is on `name_en`, so it works
 * whatever language the map is rendered in. Extend the list if a label still shows up.
 */
const HIDDEN_BASE_LABELS = ["Paracel Islands", "Spratly Islands", "Xisha Islands", "Nansha Islands"];

type Filter = Parameters<MapboxMap["setFilter"]>[1];

/** Hides the base style's own labels for those groups so ours are the only ones. Idempotent. */
function hideBaseLabels(map: MapboxMap, names: string[]) {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type !== "symbol" || !("source-layer" in layer) || !layer["source-layer"]) continue;

    const current = map.getFilter(layer.id);
    if (current && JSON.stringify(current).includes(names[0])) continue; // already patched

    const notHidden = ["!", ["in", ["get", "name_en"], ["literal", names]]];
    map.setFilter(layer.id, (current ? ["all", current, notHidden] : notHidden) as Filter);
  }
}

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
      hideBaseLabels(map, HIDDEN_BASE_LABELS);
    };
    if (map.isStyleLoaded()) setup();
    else map.once("style.load", setup);

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

      <Source id="vn-archipelagos" type="geojson" data={ARCHIPELAGOS}>
        <Layer
          id="vn-archipelago-labels"
          type="symbol"
          minzoom={4}
          layout={{
            "text-field": ["get", "label"],
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 8, 14],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{ "text-color": VN_RED, "text-halo-color": "#ffffff", "text-halo-width": 1.6 }}
        />
      </Source>
    </>
  );
}