import type { Map as MapboxMap, SymbolLayerSpecification } from "mapbox-gl";

const SOURCE_ID = "vn-archipelagos";

/** Shared labels and approximate group centres already used by the Explore map. */
export const VIETNAM_ARCHIPELAGOS: GeoJSON.FeatureCollection<
  GeoJSON.Point,
  { label: string }
> = {
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

const BASE_NAMES = [
  "Paracel Islands",
  "Spratly Islands",
  "Xisha Islands",
  "Nansha Islands",
];
type Filter = Parameters<MapboxMap["setFilter"]>[1];

/** Apply only to basemap symbols, preserving existing filters and our own GeoJSON labels. */
export function hideArchipelagoBaseLabels(map: MapboxMap) {
  const exclusion = ["!", ["in", ["get", "name_en"], ["literal", BASE_NAMES]]];
  for (const layer of map.getStyle()?.layers ?? []) {
    if (
      layer.type !== "symbol" ||
      !("source-layer" in layer) ||
      !layer["source-layer"]
    )
      continue;
    const current = map.getFilter(layer.id);
    if (current && JSON.stringify(current).includes(JSON.stringify(exclusion)))
      continue;
    map.setFilter(
      layer.id,
      (current ? ["all", current, exclusion] : exclusion) as Filter,
    );
  }
}

/** Export maps use a smaller CSS canvas at high DPR; keep physical label sizes/zoom consistent. */
export function archipelagoLabelLayer(
  pixelRatio = 1,
  textScale = 1,
): SymbolLayerSpecification {
  const zoomOffset = Math.log2(pixelRatio);
  const textUnit = textScale / pixelRatio;
  return {
    id: "vn-archipelago-labels",
    source: SOURCE_ID,
    type: "symbol",
    minzoom: 4 - zoomOffset,
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        4 - zoomOffset,
        10 * textUnit,
        8 - zoomOffset,
        14 * textUnit,
      ],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#da251d",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.6 * textUnit,
    },
  };
}

/** For the independent WebGL export map: labels are captured with its canvas, not DOM markers. */
export function installArchipelagoLabels(map: MapboxMap, pixelRatio = 1) {
  hideArchipelagoBaseLabels(map);
  if (!map.getSource(SOURCE_ID))
    map.addSource(SOURCE_ID, { type: "geojson", data: VIETNAM_ARCHIPELAGOS });
  // Match the exporter's larger physical stop labels so names remain legible when the poster shrinks.
  const layer = archipelagoLabelLayer(pixelRatio, 2);
  if (!map.getLayer(layer.id)) map.addLayer(layer);
}
