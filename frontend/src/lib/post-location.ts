import { z } from "zod";
import type { Location } from "@/types";
import type { PlaceSuggestion } from "@/lib/api/places";

export type PickedLocation =
  | { kind: "existing"; location: Location }
  | { kind: "new"; place: PlaceSuggestion };

export type PostLocationPrefill =
  | { kind: "existing"; locationId: string }
  | { kind: "new"; place: PlaceSuggestion };

export type PostLocationParams = Record<string, string | string[] | undefined>;

// URL input is untrusted. Keep the same field and coordinate limits as the API.
const placeSchema = z.object({
  key: z.string().regex(/^osm:[NWR]\d+$/).max(255),
  name: z.string().trim().min(1).max(200),
  address: z.string().max(500),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  coordinates: z.object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
  }).strict(),
  category: z.enum([
    "camping", "cafe", "heritage", "beach", "mountain",
    "street_food", "waterfall", "village", "other",
  ]),
  kind: z.string().max(100),
}).strict();

/** A reloadable link; existing locations are always read back from the API by ID. */
export function postLocationHref(selection: PickedLocation): string {
  if (selection.kind === "existing") {
    return `/post/new?${new URLSearchParams({ location_id: selection.location.id })}`;
  }
  const place = selection.place;
  const payload = placeSchema.parse({
    key: place.key,
    name: place.name.trim().slice(0, 200),
    address: place.address.slice(0, 500),
    city: place.city?.slice(0, 100),
    country: place.country?.slice(0, 100),
    coordinates: place.coordinates,
    category: place.category,
    kind: place.kind.slice(0, 100),
  });
  return `/post/new?${new URLSearchParams({ place: JSON.stringify(payload) })}`;
}

export function parsePostLocation(params: PostLocationParams): PostLocationPrefill | null {
  if (params.location_id !== undefined && params.place === undefined) {
    const id = z.string().uuid().safeParse(params.location_id);
    return id.success ? { kind: "existing", locationId: id.data } : null;
  }
  if (params.location_id !== undefined || typeof params.place !== "string" || params.place.length > 4000) {
    return null;
  }
  try {
    const place = placeSchema.safeParse(JSON.parse(params.place));
    return place.success ? { kind: "new", place: place.data } : null;
  } catch {
    return null;
  }
}
