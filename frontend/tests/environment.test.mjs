import assert from "node:assert/strict";
import test from "node:test";
import { validateFrontendEnvironment, serverApiUrl, realtimeUrl, browserApiUrl } from "../src/lib/config/environment.mjs";

const production = { NODE_ENV: "production", API_INTERNAL_URL: "https://api.example.com/api/v1", NEXT_PUBLIC_REALTIME_URL: "https://api.example.com", NEXT_PUBLIC_MAPBOX_TOKEN: "pk.unit-test-fixture" };
test("production has no localhost fallback and preserves the same-origin REST strategy", () => {
  assert.deepEqual(validateFrontendEnvironment(production), { api: production.API_INTERNAL_URL, realtime: production.NEXT_PUBLIC_REALTIME_URL });
  for (const api of [undefined, "http://api.example.com/api/v1", "https://localhost/api/v1", "https://user:secret@api.example.com/api/v1", "https://api.example.com"]) {
    assert.throws(() => serverApiUrl(api, true), /API_INTERNAL_URL/);
  }
  assert.throws(() => browserApiUrl("https://api.example.com/api/v1", true), /same-origin/);
  assert.throws(() => realtimeUrl("https://api.example.com/realtime", true), /NEXT_PUBLIC_REALTIME_URL/);
  assert.throws(() => validateFrontendEnvironment({ ...production, NEXT_PUBLIC_MAPBOX_TOKEN: "sk.secret" }), /pk/);
});
test("development retains localhost defaults; URL validation errors never echo credentials", () => {
  assert.equal(serverApiUrl(undefined, false), "http://localhost:4000/api/v1");
  assert.equal(realtimeUrl(undefined, false), "http://localhost:4000");
  assert.throws(() => serverApiUrl("https://user:do-not-log@api.example.com/api/v1", true), (error) => !error.message.includes("do-not-log"));
});
