// node --experimental-strip-types --test tests/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  journeyRoute,
  travelBounds,
  travelFeatures,
} from "../src/lib/mapbox/travel.ts";
import {
  DEFAULT_JOURNEY_STYLE,
  journeySchema,
} from "../src/lib/validations/journey.ts";

const point = (lng, lat = 10) => ({ coordinates: { lng, lat } });
test("empty and one-point drafts never draw an invented route", () => {
  assert.equal(journeyRoute([]).features.length, 0);
  assert.equal(journeyRoute([point(106)]).features.length, 0);
  assert.equal(travelBounds([]), null);
  assert.deepEqual(travelBounds([point(106, 11)]), [
    [106, 11],
    [106, 11],
  ]);
});
test("GeoJSON keeps selection order and longitude before latitude", () => {
  const points = [
    { ...point(108, 12), location_id: "second", name: "Đà Lạt" },
    { ...point(106, 10), location_id: "first", name: "Cần Thơ" },
  ];
  assert.deepEqual(journeyRoute(points).features[0].geometry.coordinates, [
    [108, 12],
    [106, 10],
  ]);
  assert.equal(travelFeatures(points).features[0].properties.order, 1);
  assert.deepEqual(
    travelFeatures(points).features[0].geometry.coordinates,
    [108, 12],
  );
});
test("eastward and westward routes split at the date line and fit the shortest interval", () => {
  for (const points of [
    [point(179, 20), point(-179, 40)],
    [point(-179, 20), point(179, 40)],
  ]) {
    const route = journeyRoute(points).features[0].geometry;
    assert.equal(route.type, "MultiLineString");
    assert.equal(route.coordinates.length, 2);
    const edgeA = route.coordinates[0].at(-1);
    const edgeB = route.coordinates[1][0];
    assert.equal(Math.abs(edgeA[0]), 180);
    assert.equal(edgeA[0], -edgeB[0]);
    assert.equal(edgeA[1], edgeB[1]);
    assert.ok(edgeA[1] > 20 && edgeA[1] < 40);
    const bounds = travelBounds(points);
    assert.equal(bounds[1][0] - bounds[0][0], 2);
    for (const line of route.coordinates)
      for (let i = 1; i < line.length; i++)
        assert.ok(Math.abs(line[i][0] - line[i - 1][0]) <= 180);
  }
});
test("long and polar connections remain finite and never use a world-spanning edge", () => {
  for (const points of [
    [point(170, 89), point(-170, -89), point(20, 0)],
    [point(180), point(-180)],
    [point(-180), point(179), point(-179)],
  ]) {
    const bounds = travelBounds(points);
    assert.ok(bounds[0][1] >= -85.052 && bounds[1][1] <= 85.052);
    const geometry = journeyRoute(points).features[0].geometry;
    const lines =
      geometry.type === "LineString"
        ? [geometry.coordinates]
        : geometry.coordinates;
    for (const line of lines)
      for (const coordinate of line)
        assert.ok(coordinate.every(Number.isFinite));
  }
});
test("journey validation permits empty drafts, forbids duplicate stops, and restricts map styles", () => {
  const values = {
    title: "  Ký ức  ",
    description: "",
    cover_image_url: "",
    visibility: "private",
    style_config: DEFAULT_JOURNEY_STYLE,
    stops: [],
  };
  assert.equal(journeySchema.parse(values).title, "Ký ức");
  const location_id = randomUUID();
  assert.equal(
    journeySchema.safeParse({
      ...values,
      stops: [{ location_id }, { location_id }],
    }).success,
    false,
  );
  assert.equal(
    journeySchema.safeParse({
      ...values,
      stops: Array.from({ length: 101 }, () => ({ location_id: randomUUID() })),
    }).success,
    false,
  );
  assert.equal(
    journeySchema.safeParse({
      ...values,
      style_config: { ...DEFAULT_JOURNEY_STYLE, map_style: "custom" },
    }).success,
    false,
  );
  assert.equal(
    journeySchema.safeParse({
      ...values,
      style_config: { ...DEFAULT_JOURNEY_STYLE, line_style: "curved" },
    }).success,
    false,
  );
});
