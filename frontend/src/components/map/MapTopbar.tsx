"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search, MapPin, PlusCircle, User, Loader2, X, Newspaper } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

import { useAuth } from "@/hooks/useAuth";
import { searchPlaces } from "@/lib/api";
import { useMapStore } from "@/stores/mapStore";
import { LOCATION_CATEGORIES, ROUTES } from "@/constants";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/notification/NotificationBell";
import { ThemeSelector } from "@/components/layout/ThemeSelector";
import type { PickedLocation } from "@/lib/post-location";

type SearchScope = "vn" | "world";
/** Zoom used when a search result is chosen (neighbourhood/POI level). */
const SEARCH_FLY_ZOOM = 14;

const iconOf = (category: string) =>
  LOCATION_CATEGORIES.find((item) => item.value === category)?.icon ?? "📍";

export function MapTopbar() {
  const { isAuthenticated, profile } = useAuth();
  const setFlyToTarget = useMapStore((state) => state.setFlyToTarget);
  const setSearchPin = useMapStore((state) => state.setSearchPin);
  const setSelectedLocation = useMapStore((state) => state.setSelectedLocation);
  const viewport = useMapStore((state) => state.viewport);

  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("vn");
  const [isOpen, setIsOpen] = useState(false);

  // Debounce giống LocationPicker.
  useEffect(() => {
    if (!isOpen) return;

    const timer = window.setTimeout(() => {
      setQuery(input.trim());
    }, 300);

    return () => window.clearTimeout(timer);
  }, [input, isOpen]);

  // Ưu tiên các địa điểm gần khu vực bản đồ hiện tại.
  const lat = Number(viewport.latitude.toFixed(1));
  const lng = Number(viewport.longitude.toFixed(1));

  const enabled = isOpen && query.length >= 2;
  const isDebouncing = input.trim() !== query;

  const {
    data,
    isFetching,
    isError,
  } = useQuery({
    queryKey: ["place-search", scope, query, lat, lng],
    queryFn: ({ signal }) =>
      searchPlaces({ q: query, scope, lat, lng }, signal),
    enabled,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const existing = data?.existing ?? [];
  const external = data?.external ?? [];

  const resultsReady = enabled && !isDebouncing;
  const isSearching =
    isOpen &&
    input.trim().length >= 2 &&
    (isDebouncing || (enabled && isFetching));

  const nothing =
    resultsReady &&
    !isFetching &&
    !isError &&
    existing.length === 0 &&
    external.length === 0;

  const handleSelect = (selection: PickedLocation) => {
    const { name, coordinates: { lat, lng } } =
      selection.kind === "existing" ? selection.location : selection.place;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      console.error("Invalid coordinates:", { lat, lng });
      return;
    }

    setSelectedLocation(null);
    setFlyToTarget({ longitude: lng, latitude: lat, zoom: SEARCH_FLY_ZOOM });
    setSearchPin({ name, longitude: lng, latitude: lat, selection });
    setInput(name);
    setQuery("");
    setIsOpen(false);
  };

  const handleInput = (value: string) => {
    setInput(value);
    setIsOpen(true);
  };

  return (
    <div className="flex flex-col gap-3 p-4 md:flex-row md:items-start">
      {/* Search bar */}
      <div className="relative w-full min-w-0 md:max-w-lg md:flex-1">
        <div
          className={cn(
            "flex items-center gap-2 rounded-2xl bg-white/95 px-4 py-3 shadow-lg backdrop-blur-sm",
            "dark:bg-surface-elevated/95",
            isOpen && "ring-1 ring-brand-500/30",
          )}
        >
          <Search className="h-4 w-4 shrink-0 text-ink-subtle" />

          <input
            type="text"
            value={input}
            onChange={(event) => handleInput(event.target.value)}
            onFocus={() => setIsOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setIsOpen(false);
              }
            }}
            placeholder="Tìm địa điểm, thành phố..."
            aria-label="Tìm kiếm địa điểm"
            aria-expanded={isOpen && input.trim().length >= 2}
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
          />

          {isSearching && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-500" />
          )}

          {input && (
            <button
              type="button"
              onClick={() => {
                setInput("");
                setQuery("");
                setIsOpen(true);
              }}
              aria-label="Xóa nội dung tìm kiếm"
              className="rounded-full p-1 text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Search results */}
        <AnimatePresence>
          {isOpen && input.trim().length >= 2 && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute top-full z-50 mt-2 max-h-[min(70vh,32rem)] w-full overflow-y-auto rounded-xl border border-border bg-white p-2 shadow-xl dark:bg-surface-elevated"
            >
              {/* Search scope */}
              <div className="flex gap-2 px-1 pb-2">
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
                      "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                      scope === id
                        ? "bg-brand-500 text-white"
                        : "bg-surface-muted text-ink-muted hover:bg-border",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {isError && (
                <p className="px-3 py-3 text-sm text-red-500">
                  Không thể tìm kiếm địa điểm. Vui lòng thử lại.
                </p>
              )}

              {!isError && !resultsReady && (
                <div className="flex items-center gap-2 px-3 py-4 text-sm text-ink-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Đang tìm địa điểm...
                </div>
              )}

              {resultsReady && (
                <>
                  {/* Existing WanderMap locations */}
                  {existing.length > 0 && (
                    <section>
                      <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                        Đã có trên WanderMap
                      </p>

                      {existing.map((location) => (
                        <button
                          key={location.id}
                          type="button"
                          onClick={() =>
                            handleSelect({ kind: "existing", location })
                          }
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-muted"
                        >
                          <span className="shrink-0">
                            {iconOf(location.category)}
                          </span>

                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink">
                              {location.name}
                            </span>
                            <span className="block truncate text-xs text-ink-muted">
                              {[location.city, location.country]
                                .filter(Boolean)
                                .join(", ") || location.address}
                            </span>
                          </span>

                          <MapPin className="h-4 w-4 shrink-0 text-brand-500" />
                        </button>
                      ))}
                    </section>
                  )}

                  {/* External map locations */}
                  {external.length > 0 && (
                    <section>
                      <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                        Địa điểm khác
                      </p>

                      {external.map((place) => (
                        <button
                          key={place.key}
                          type="button"
                          onClick={() =>
                            handleSelect({ kind: "new", place })
                          }
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-muted"
                        >
                          <span className="shrink-0">
                            {iconOf(place.category)}
                          </span>

                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink">
                              {place.name}
                            </span>
                            <span className="block truncate text-xs text-ink-muted">
                              {place.address || place.kind}
                            </span>
                          </span>

                          <MapPin className="h-4 w-4 shrink-0 text-brand-500" />
                        </button>
                      ))}
                    </section>
                  )}

                  {data && !data.externalAvailable && (
                    <p className="px-3 py-2 text-xs text-amber-600">
                      Chưa tải được gợi ý từ nguồn bản đồ bên ngoài. Bạn vẫn có
                      thể chọn địa điểm đã có trên WanderMap.
                    </p>
                  )}

                  {nothing && (
                    <p className="px-3 py-4 text-sm text-ink-muted">
                      Không tìm thấy địa điểm. Thử bỏ bớt từ khóa hoặc chuyển
                      sang phạm vi “Toàn thế giới”.
                    </p>
                  )}

                  {external.length > 0 && (
                    <p className="px-3 pb-1 pt-2 text-[10px] text-ink-subtle">
                      © OpenStreetMap contributors
                    </p>
                  )}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Actions */}
      <div className="flex w-full shrink-0 items-center justify-end gap-2 md:w-auto">
        <ThemeSelector className="rounded-2xl bg-white/95 text-ink shadow-lg backdrop-blur-sm hover:bg-surface-muted dark:bg-surface-elevated/95" />
        <Link
          href={ROUTES.feed}
          aria-label="Bản tin cộng đồng"
          className="flex items-center gap-2 rounded-2xl bg-white/95 px-4 py-3 text-sm font-semibold text-ink shadow-lg backdrop-blur-sm transition-colors hover:bg-white dark:bg-surface-elevated/95"
        >
          <Newspaper className="h-4 w-4" />
          <span className="hidden sm:inline">Bản tin</span>
        </Link>
        {isAuthenticated ? (
          <>
            <NotificationBell className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/95 text-ink shadow-lg backdrop-blur-sm transition-colors hover:bg-white dark:bg-surface-elevated/95" />
            <Link
              href={ROUTES.newPost}
              className="flex items-center gap-2 rounded-2xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-brand-600"
            >
              <PlusCircle className="h-4 w-4" />
              <span className="hidden sm:inline">Đăng bài</span>
            </Link>

            <Link
              href={ROUTES.profile(profile?.username ?? "")}
              aria-label="Hồ sơ cá nhân"
              className="h-10 w-10 overflow-hidden rounded-2xl shadow-lg ring-2 ring-white"
            >
              <img
                src={profile?.avatar_url ?? "/icons/default-avatar.svg"}
                alt={profile?.display_name ?? "Ảnh đại diện"}
                className="h-full w-full object-cover"
              />
            </Link>
          </>
        ) : (
          <Link
            href={ROUTES.login}
            className="flex items-center gap-2 rounded-2xl bg-white/95 px-4 py-3 text-sm font-semibold text-ink shadow-lg backdrop-blur-sm transition-colors hover:bg-surface-muted dark:bg-surface-elevated/95"
          >
            <User className="h-4 w-4" />
            Đăng nhập
          </Link>
        )}
      </div>
    </div>
  );
}
