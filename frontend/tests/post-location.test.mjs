// node --experimental-strip-types --test tests/post-location.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { parsePostLocation, postLocationHref } from "../src/lib/post-location.ts";

const id = "4e730d96-e0d4-44ee-a31a-e513cad3283b";
const place = {
  key: "osm:W123456",
  name: 'Hồ & Quán "Bình yên" #1?',
  address: "Đường ven hồ, Đà Lạt",
  city: "Đà Lạt",
  country: "Việt Nam",
  coordinates: { lat: 11.9067, lng: 108.4378 },
  category: "cafe",
  kind: "amenity:cafe",
};
const params = (href) => Object.fromEntries(new URL(href, "https://wandermap.test").searchParams);

test("existing location links carry its ID, not a stale location snapshot", () => {
  const href = postLocationHref({ kind: "existing", location: { id, name: "Old name" } });
  assert.deepEqual(params(href), { location_id: id });
  assert.deepEqual(parsePostLocation(params(href)), { kind: "existing", locationId: id });
});

test("external places preserve Unicode, special characters, category and coordinates across a login return URL", () => {
  const href = postLocationHref({ kind: "new", place });
  const login = new URL(`/auth/login?${new URLSearchParams({ next: href })}`, "https://wandermap.test");
  const destination = login.searchParams.get("next");
  assert.equal(destination, href);
  assert.equal(new URL(destination, "https://wandermap.test").pathname, "/post/new");
  assert.equal(new URL(destination, "https://wandermap.test").hash, "");
  assert.deepEqual(parsePostLocation(params(destination)), { kind: "new", place });
});

test("invalid, duplicate and ambiguous parameters never prefill an unintended location", () => {
  for (const input of [
    {}, { location_id: "bad-id" }, { location_id: [id, id] },
    { place: [JSON.stringify(place)] }, { place: "{" }, { place: "null" },
    { place: "x".repeat(4001) }, { place: "" },
    { location_id: id, place: JSON.stringify(place) },
  ]) assert.equal(parsePostLocation(input), null);
});

test("URL places require a provider key, finite in-range coordinates and a known category", () => {
  for (const patch of [
    { key: "https://example.test/place" }, { name: "   " },
    { category: "unknown" }, { coordinates: { lat: 91, lng: 108 } },
    { coordinates: { lat: 11, lng: -181 } }, { coordinates: { lat: "11", lng: 108 } },
    { coordinates: { lat: null, lng: 108 } }, { coordinates: { lat: 11 } },
  ]) assert.equal(parsePostLocation({ place: JSON.stringify({ ...place, ...patch }) }), null);
  assert.throws(() => postLocationHref({ kind: "new", place: { ...place, coordinates: { lat: NaN, lng: 108 } } }));
});

test("unknown ownership and nested coordinate fields are rejected", () => {
  for (const patch of [
    { user_id: id }, { owner: id },
    { coordinates: { ...place.coordinates, user_id: id } },
  ]) assert.equal(parsePostLocation({ place: JSON.stringify({ ...place, ...patch }) }), null);
});

test("long provider metadata is bounded to the existing create-location contract", () => {
  const href = postLocationHref({ kind: "new", place: {
    ...place, name: "N".repeat(201), address: "A".repeat(501),
    city: "C".repeat(101), country: "V".repeat(101), countryCode: "vn",
  } });
  const parsed = parsePostLocation(params(href));
  assert.equal(parsed.place.name.length, 200);
  assert.equal(parsed.place.address.length, 500);
  assert.equal(parsed.place.city.length, 100);
  assert.equal(parsed.place.country.length, 100);
  assert.equal(parsed.place.key, place.key);
  assert.equal(parsed.place.countryCode, undefined);
});
