"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Search, X } from "lucide-react";
import { searchLocations } from "@/lib/api";
import { geocodeSearch, type GeocodingResult } from "@/lib/mapbox";
import { LOCATION_CATEGORIES } from "@/constants";
import type { Location } from "@/types";

export type PickedLocation =
  | { kind: "existing"; location: Location }
  | { kind: "new"; result: GeocodingResult };

/** Stored in locations.google_place_id so the same Mapbox place is never inserted twice. */
export const mapboxPlaceKey = (placeId: string) => `mapbox:${placeId}`;

interface LocationPickerProps {
  value: PickedLocation | null;
  onChange: (value: PickedLocation | null) => void;
  error?: string;
}

const iconOf = (category: string) =>
  LOCATION_CATEGORIES.find((c) => c.value === category)?.icon ?? "📍";

export function LocationPicker({ value, onChange, error }: LocationPickerProps) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 350);
    return () => clearTimeout(timer);
  }, [input]);

  const enabled = !value && query.length >= 2;

  const existing = useQuery({
    queryKey: ["location-picker", "existing", query],
    queryFn: ({ signal }) => searchLocations(query, 5, signal),
    enabled,
    staleTime: 60_000,
  });

  const geo = useQuery({
    queryKey: ["location-picker", "geo", query],
    queryFn: () => geocodeSearch(query),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (value) {
    const name = value.kind === "existing" ? value.location.name : value.result.name;
    const sub =
      value.kind === "existing"
        ? [value.location.city, value.location.country].filter(Boolean).join(", ")
        : value.result.address;
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-brand-500 bg-surface-muted px-4 py-3">
        <MapPin className="h-4 w-4 shrink-0 text-brand-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{name}</p>
          {sub && <p className="truncate text-xs text-ink-muted">{sub}</p>}
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Chọn địa điểm khác"
          className="rounded-full p-1 text-ink-muted hover:bg-surface hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const existingItems = existing.data?.data ?? [];
  const takenKeys = new Set(existingItems.map((l) => l.google_place_id));
  const geoItems = (geo.data ?? []).filter((g) => !takenKeys.has(mapboxPlaceKey(g.place_id)));
  const searching = enabled && (existing.isLoading || geo.isLoading);
  const nothing = enabled && !searching && !existingItems.length && !geoItems.length;

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Tìm địa điểm (vd: Thác Bản Giốc)"
          className="w-full rounded-2xl border border-border bg-surface-muted py-3 pl-10 pr-4 text-sm text-ink outline-none transition-colors placeholder:text-ink-subtle focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}

      {enabled && (
        <div className="mt-2 max-h-72 overflow-y-auto rounded-2xl border border-border bg-surface-elevated p-1.5">
          {searching && <p className="px-3 py-2 text-xs text-ink-muted">Đang tìm...</p>}

          {existingItems.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                Đã có trên WanderMap
              </p>
              {existingItems.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => onChange({ kind: "existing", location: loc })}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-muted"
                >
                  <span>{iconOf(loc.category)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">{loc.name}</span>
                    <span className="block truncate text-xs text-ink-muted">
                      {[loc.city, loc.country].filter(Boolean).join(", ") || loc.address}
                    </span>
                  </span>
                </button>
              ))}
            </>
          )}

          {geoItems.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                Thêm địa điểm mới từ bản đồ
              </p>
              {geoItems.map((g) => (
                <button
                  key={g.place_id}
                  type="button"
                  onClick={() => onChange({ kind: "new", result: g })}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-muted"
                >
                  <MapPin className="h-4 w-4 shrink-0 text-ink-subtle" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">{g.name}</span>
                    <span className="block truncate text-xs text-ink-muted">{g.address}</span>
                  </span>
                </button>
              ))}
            </>
          )}

          {geo.isError && !existingItems.length && (
            <p className="px-3 py-2 text-xs text-red-500">
              Không tìm được trên bản đồ. Kiểm tra NEXT_PUBLIC_MAPBOX_TOKEN.
            </p>
          )}
          {nothing && !geo.isError && (
            <p className="px-3 py-2 text-xs text-ink-muted">Không tìm thấy địa điểm phù hợp.</p>
          )}
        </div>
      )}
    </div>
  );
}
