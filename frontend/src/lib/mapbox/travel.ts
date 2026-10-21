import type {
  FeatureCollection,
  LineString,
  MultiLineString,
  Point,
} from "geojson";
import type { TravelMapPoint } from "../../types/journey";

export const wrapLongitude = (lng: number) =>
  ((((lng + 180) % 360) + 360) % 360) - 180;

/** Shortest longitudinal interval, so 179E/179W fit around the date line. */
export function travelBounds(
  points: Array<{ coordinates: { lng: number; lat: number } }>,
): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  const lngs = points
    .map((p) => ((p.coordinates.lng % 360) + 360) % 360)
    .sort((a, b) => a - b);
  let gap = -1;
  let start = 0;
  for (let i = 0; i < lngs.length; i++) {
    const size =
      (i === lngs.length - 1 ? lngs[0] + 360 : lngs[i + 1]) - lngs[i];
    if (size > gap) {
      gap = size;
      start = (i + 1) % lngs.length;
    }
  }
  const west = wrapLongitude(lngs[start]);
  const east = west + (lngs.length === 1 ? 0 : 360 - gap);
  let south = 90;
  let north = -90;
  for (const point of points) {
    const lat = Math.max(
      -85.051129,
      Math.min(85.051129, point.coordinates.lat),
    );
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [
    [west, south],
    [east, north],
  ];
}

/** Illustrative ordered connection; split at ±180 instead of drawing across the world. */
export function journeyRoute(
  points: Array<{ coordinates: { lng: number; lat: number } }>,
): FeatureCollection<LineString | MultiLineString> {
  if (points.length < 2) return { type: "FeatureCollection", features: [] };
  const segments: number[][][] = [];
  let current: number[][] = [
    [wrapLongitude(points[0].coordinates.lng), points[0].coordinates.lat],
  ];
  const mercator = (lat: number) =>
    Math.log(
      Math.tan(
        Math.PI / 4 +
          (Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI) / 360,
      ),
    );
  for (let i = 1; i < points.length; i++) {
    const a = current[current.length - 1];
    const b = [
      wrapLongitude(points[i].coordinates.lng),
      points[i].coordinates.lat,
    ];
    let lng = b[0];
    if (lng - a[0] > 180) lng -= 360;
    else if (lng - a[0] < -180) lng += 360;
    if (lng > 180 || lng < -180) {
      const boundary = lng > 180 ? 180 : -180;
      const ratio = (boundary - a[0]) / (lng - a[0]);
      const y = mercator(a[1]) + (mercator(b[1]) - mercator(a[1])) * ratio;
      const lat = ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
      current.push([boundary, lat]);
      segments.push(current);
      current = [[-boundary, lat], b];
    } else current.push(b);
  }
  segments.push(current);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry:
          segments.length === 1
            ? { type: "LineString", coordinates: segments[0] }
            : { type: "MultiLineString", coordinates: segments },
      },
    ],
  };
}

export function travelFeatures(
  points: TravelMapPoint[],
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: points.map((point, index) => ({
      type: "Feature",
      id: point.location_id,
      geometry: {
        type: "Point",
        coordinates: [point.coordinates.lng, point.coordinates.lat],
      },
      properties: {
        location_id: point.location_id,
        name: point.name,
        order: index + 1,
      },
    })),
  };
}
