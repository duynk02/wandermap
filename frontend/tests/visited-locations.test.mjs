// node --experimental-strip-types --test tests/visited-locations.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { isTravelDate, locationVisitSchema, visitedLocationSchema } from "../src/lib/validations/visited-locations.ts";

test("unknown travel date stays empty instead of inventing today's date", () => {
  assert.equal(visitedLocationSchema.safeParse({ visited_at: "", note: "", visibility: "private" }).success, true);
  assert.equal(locationVisitSchema.safeParse({ visited_at: "", note: "" }).success, false);
});
test("travel dates require a real date-only value, including leap-year boundaries", () => {
  assert.equal(isTravelDate("2024-02-29"), true);
  assert.equal(isTravelDate("2026-02-29"), false);
  for (const date of ["2026-02-30", "2026-13-01", "0000-01-01", "2026-1-2", "2026-01-02T00:00:00Z", "infinity"]) assert.equal(isTravelDate(date), false);
});
test("note limits and visibility match the backend contract", () => {
  assert.equal(visitedLocationSchema.safeParse({ visited_at: "", note: "x".repeat(1001), visibility: "private" }).success, false);
  assert.equal(visitedLocationSchema.safeParse({ visited_at: "", note: "", visibility: "followers" }).success, false);
  assert.equal(locationVisitSchema.parse({ visited_at: "2026-01-02", note: "  Một kỷ niệm  " }).note, "Một kỷ niệm");
});
