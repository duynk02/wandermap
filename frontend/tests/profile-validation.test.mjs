// Node.js 22+: node --experimental-strip-types --test tests/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { updateProfileSchema } from "../src/lib/validations/index.ts";

const profile = {
  username: "traveler",
  display_name: "Traveler",
  bio: "",
  home_city: "",
};

test("profile validation trims input and allows empty optional details", () => {
  assert.deepEqual(
    updateProfileSchema.parse({
      ...profile,
      display_name: "  Quốc Anh  ",
      home_city: "   ",
    }),
    {
      ...profile,
      display_name: "Quốc Anh",
    },
  );
});

test("profile display names cannot be blank or whitespace", () => {
  for (const display_name of ["", "   ", "\n\t"]) {
    assert.equal(
      updateProfileSchema.safeParse({ ...profile, display_name }).success,
      false,
    );
  }
});

test("username format matches the backend and existing case-insensitive index", () => {
  for (const username of ["valid_name", "Mixed_Case123", "abc"]) {
    assert.equal(
      updateProfileSchema.safeParse({ ...profile, username }).success,
      true,
    );
  }
  for (const username of [
    "ab",
    "has space",
    "has-dash",
    "người_dùng",
    "a/b",
    "x".repeat(31),
  ]) {
    assert.equal(
      updateProfileSchema.safeParse({ ...profile, username }).success,
      false,
    );
  }
});

test("all profile field length boundaries match the API", () => {
  for (const [field, max] of [
    ["display_name", 80],
    ["bio", 500],
    ["home_city", 120],
    ["username", 30],
  ]) {
    assert.equal(
      updateProfileSchema.safeParse({ ...profile, [field]: "x".repeat(max) })
        .success,
      true,
    );
    assert.equal(
      updateProfileSchema.safeParse({
        ...profile,
        [field]: "x".repeat(max + 1),
      }).success,
      false,
    );
  }
});
