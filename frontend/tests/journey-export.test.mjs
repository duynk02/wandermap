import assert from "node:assert/strict";
import test from "node:test";
import {
  journeyImageFilename,
  journeyPeriod,
  posterDimensions,
  posterTextLines,
  validatePoster,
} from "../src/lib/journey-export/model.ts";

const point = (id, date = null, lng = 106, lat = 10) => ({
  id,
  location_id: id,
  name: "Địa điểm",
  last_visited_at: date,
  coordinates: { lng, lat },
});
const input = {
  title: "Một dải ký ức",
  points: [point("a")],
  style: {
    map_style: "outdoors-v12",
    line_color: "#22c55e",
    line_style: "solid",
  },
};

test("fixed physical PNG dimensions do not depend on the device display", () => {
  assert.deepEqual(posterDimensions("1:1"), { width: 1600, height: 1600 });
  assert.deepEqual(posterDimensions("4:5"), { width: 1600, height: 2000 });
  assert.throws(() => posterDimensions("16:9"));
});
test("period needs a valid date for every stop and does not assume chronological stop order", () => {
  assert.equal(journeyPeriod([]), null);
  assert.equal(journeyPeriod([point("a", "2026-01-01"), point("b")]), null);
  assert.equal(journeyPeriod([point("a", "2026-02-30")]), null);
  assert.equal(journeyPeriod([point("a", "2024-02-29")]), "29/02/2024");
  assert.equal(
    journeyPeriod([point("a", "2026-01-01"), point("b", "2024-02-29")]),
    "29/02/2024 – 01/01/2026",
  );
});
test("reject incomplete, duplicate and invalid data before allocating a WebGL map", () => {
  assert.doesNotThrow(() => validatePoster(input));
  for (const change of [
    { title: " " },
    { points: [] },
    { points: [point("a"), point("a")] },
    { points: [point("a", null, Infinity)] },
    { points: [point("a", null, 181)] },
    { points: [point("a", null, 106, -91)] },
    { style: { ...input.style, map_style: "https://evil.test/style.json" } },
    { style: { ...input.style, line_color: "red" } },
  ])
    assert.throws(() => validatePoster({ ...input, ...change }));
  assert.doesNotThrow(() =>
    validatePoster({
      ...input,
      points: [point("a", null, 179), point("b", null, -179)],
    }),
  );
});
test("download names preserve Vietnamese meaning without unsafe file characters", () => {
  assert.equal(
    journeyImageFilename("Đà Lạt / Ký ức?", "4:5"),
    "wandermap-da-lat-ky-uc-4x5.png",
  );
  assert.equal(
    journeyImageFilename("🗺️", "1:1"),
    "wandermap-hanh-trinh-1x1.png",
  );
  assert.ok(journeyImageFilename("a".repeat(200), "1:1").length < 100);
});
test("poster typography wraps unbroken text and truncates long names within its area", () => {
  const measure = (v) => Array.from(v).length;
  for (const text of [
    "Miền Trung những ngày nắng và gió",
    "A".repeat(200),
    "🗺️".repeat(100),
  ]) {
    const lines = posterTextLines(text, 15, 2, measure);
    assert.ok(lines.length <= 2);
    assert.ok(lines.every((line) => measure(line) <= 15));
    assert.ok(lines.at(-1).endsWith("…"));
  }
  assert.deepEqual(posterTextLines("Hà Nội", 15, 2, measure), ["Hà Nội"]);
});
