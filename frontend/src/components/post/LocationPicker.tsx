"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2, MapPin, Search, X } from "lucide-react";
import { searchPlaces, type PlaceSuggestion } from "@/lib/api";
import { useMapStore } from "@/stores/mapStore";
import { LOCATION_CATEGORIES } from "@/constants";
import { cn } from "@/lib/utils";
import type { Location } from "@/types";

export type PickedLocation =
  | { kind: "existing"; location: Location }
  | { kind: "new"; place: PlaceSuggestion };

interface LocationPickerProps {
  value: PickedLocation | null;
  onChange: (value: PickedLocation | null) => void;
  error?: string;
}

const iconOf = (category: string) => LOCATION_CATEGORIES.find((c) => c.value === category)?.icon ?? "📍";

export function LocationPicker({ value, onChange, error }: LocationPickerProps) {
  const viewport = useMapStore((s) => s.viewport);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"vn" | "world">("vn");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);

  const enabled = !value && query.length >= 2;
  // One decimal (~11 km) keeps the cache effective while still biasing results toward where the user is looking.
  const lat = Number(viewport.latitude.toFixed(1));
  const lng = Number(viewport.longitude.toFixed(1));

  const { data, isFetching, isError } = useQuery({
    queryKey: ["place-search", scope, query, lat, lng],
    queryFn: ({ signal }) => searchPlaces({ q: query, scope, lat, lng }, signal),
    enabled,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });

  if (value) {
    const isExisting = value.kind === "existing";
    const name = isExisting ? value.location.name : value.place.name;
    const sub = isExisting
      ? [value.location.city, value.location.country].filter(Boolean).join(", ") || value.location.address
      : value.place.address;
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

  const existing = data?.existing ?? [];
  const external = data?.external ?? [];
  const nothing = enabled && !isFetching && !isError && !existing.length && !external.length;

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Tìm địa điểm (vd: Thác Bản Giốc, Hồ Xuân Hương)"
          className="w-full rounded-2xl border border-border bg-surface-muted py-3 pl-10 pr-10 text-sm text-ink outline-none transition-colors placeholder:text-ink-subtle focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
        {isFetching && enabled && (
          <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-subtle" />
        )}
      </div>

      <div className="mt-2 flex gap-2">
        {(
          [
            ["vn", "🇻🇳 Việt Nam"],
            ["world", "🌏 Toàn thế giới"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setScope(id)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              scope === id ? "bg-brand-500 text-white" : "bg-surface-muted text-ink-muted hover:bg-border"
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}

      {enabled && (
        <div className="mt-2 max-h-80 overflow-y-auto rounded-2xl border border-border bg-surface-elevated p-1.5">
          {existing.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                Đã có trên WanderMap
              </p>
              {existing.map((loc) => (
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

          {external.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                Thêm địa điểm mới từ bản đồ
              </p>
              {external.map((place) => (
                <button
                  key={place.key}
                  type="button"
                  onClick={() => onChange({ kind: "new", place })}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-muted"
                >
                  <span>{iconOf(place.category)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">{place.name}</span>
                    <span className="block truncate text-xs text-ink-muted">{place.address || place.kind}</span>
                  </span>
                </button>
              ))}
            </>
          )}

          {data && !data.externalAvailable && (
            <p className="px-3 py-2 text-xs text-amber-600">
              Không tải được gợi ý từ bản đồ lúc này. Bạn vẫn có thể chọn địa điểm đã có.
            </p>
          )}
          {isError && <p className="px-3 py-2 text-xs text-red-500">Không thể tìm kiếm, thử lại sau.</p>}
          {nothing && (
            <p className="px-3 py-2 text-xs text-ink-muted">
              Không tìm thấy. Thử bỏ bớt từ khoá, hoặc chuyển sang &quot;Toàn thế giới&quot;.
            </p>
          )}
          {external.length > 0 && (
            <p className="px-3 pb-1 pt-2 text-[10px] text-ink-subtle">© OpenStreetMap contributors</p>
          )}
        </div>
      )}
    </div>
  );
}