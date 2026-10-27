import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".")) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });
const { visitFieldsFromPost } = await import("../src/lib/visited-post.ts");
const { visitedLocationSchema } = await import("../src/lib/validations/visited-locations.ts");
hooks.deregister();

test("visit prefill copies the trip date and text without shifting the day or importing visibility", () => {
  const fields = visitFieldsFromPost({ visited_at: "2024-02-29", content: "  Buổi sáng ở Huế.\nMột lần ghé thăm đáng nhớ.  ", visibility: "public", created_at: "2026-10-27" });
  assert.deepEqual(fields, { visited_at: "2024-02-29", note: "Buổi sáng ở Huế.\nMột lần ghé thăm đáng nhớ.", truncated: false });
  assert.equal("visibility" in fields, false);
});

test("ISO responses preserve their original travel day across timezone boundaries", () => {
  assert.equal(visitFieldsFromPost({ visited_at: "2024-01-01T00:00:00+07:00", content: "Kỷ niệm" }).visited_at, "2024-01-01");
});

test("invalid or missing travel dates stay blank rather than using the publication date", () => {
  for (const visited_at of ["", "2026-02-30", "0000-01-01", "not-a-date"]) {
    assert.equal(visitFieldsFromPost({ visited_at, content: "Kỷ niệm", created_at: "2026-10-27" }).visited_at, "");
  }
});

test("long post text becomes a valid 1000-character note with an explicit truncation signal", () => {
  const fields = visitFieldsFromPost({ visited_at: "2026-01-02", content: "a".repeat(1300) });
  assert.equal(fields.note.length, 1000);
  assert.equal(fields.truncated, true);
  assert.equal(visitedLocationSchema.safeParse({ ...fields, visibility: "private" }).success, true);
  assert.equal(visitFieldsFromPost({ visited_at: "2026-01-02", content: "a".repeat(1000) }).truncated, false);
});

test("note truncation never leaves half an emoji at the UTF-16 length boundary", () => {
  const fields = visitFieldsFromPost({ visited_at: "2026-01-02", content: "a".repeat(999) + "🙂" });
  assert.equal(fields.note, "a".repeat(999));
  assert.equal(fields.truncated, true);
  assert.equal(fields.note.isWellFormed(), true);
});
