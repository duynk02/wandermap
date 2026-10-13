"use client";

import { useState, useCallback } from "react";
import { Search, MapPin, PlusCircle, User } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useMap } from "@/hooks/useMap";
import { geocodeSearch, type GeocodingResult } from "@/lib/mapbox";
import { useDebounce } from "@/hooks/useDebounce";
import { ROUTES } from "@/constants";
import { cn } from "@/lib/utils";

export function MapTopbar() {
  const { isAuthenticated, profile } = useAuth();
  const { flyTo } = useMap();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const debouncedSearch = useDebounce(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setIsSearching(true);
    try {
      const r = await geocodeSearch(q);
      setResults(r);
    } finally {
      setIsSearching(false);
    }
  }, 400);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    debouncedSearch(e.target.value);
  };

  const handleSelect = (result: GeocodingResult) => {
    flyTo(result.coordinates.lng, result.coordinates.lat, 13);
    setQuery(result.name);
    setResults([]);
  };

  return (
    <div className="flex items-start gap-3 p-4">
      {/* Search bar */}
      <div className="relative flex-1 max-w-lg">
        <div className="flex items-center gap-2 rounded-2xl bg-white/95 px-4 py-3 shadow-lg backdrop-blur-sm dark:bg-surface-elevated/95">
          <Search className="h-4 w-4 shrink-0 text-ink-subtle" />
          <input
            type="text"
            value={query}
            onChange={handleInput}
            placeholder="Tìm địa điểm, thành phố..."
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-subtle outline-none"
          />
          {isSearching && (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          )}
        </div>

        {/* Autocomplete dropdown */}
        <AnimatePresence>
          {results.length > 0 && (
            <motion.ul
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute top-full mt-2 w-full rounded-xl bg-white shadow-xl dark:bg-surface-elevated overflow-hidden z-50"
            >
              {results.map((r) => (
                <li key={r.place_id}>
                  <button
                    onClick={() => handleSelect(r)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted transition-colors"
                  >
                    <MapPin className="h-4 w-4 shrink-0 text-brand-500" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{r.name}</p>
                      <p className="truncate text-xs text-ink-muted">{r.address}</p>
                    </div>
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {isAuthenticated ? (
          <>
            <Link href={ROUTES.newPost}>
              <button className="flex items-center gap-2 rounded-2xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-brand-600 transition-colors">
                <PlusCircle className="h-4 w-4" />
                <span className="hidden sm:inline">Đăng bài</span>
              </button>
            </Link>
            <Link href={ROUTES.profile(profile?.username ?? "")}>
              <div className="h-10 w-10 overflow-hidden rounded-2xl shadow-lg ring-2 ring-white">
                <img
                  src={profile?.avatar_url ?? "/icons/default-avatar.svg"}
                  alt={profile?.display_name}
                  className="h-full w-full object-cover"
                />
              </div>
            </Link>
          </>
        ) : (
          <Link href={ROUTES.login}>
            <button className="flex items-center gap-2 rounded-2xl bg-white/95 px-4 py-3 text-sm font-semibold text-ink shadow-lg backdrop-blur-sm hover:bg-white transition-colors">
              <User className="h-4 w-4" />
              Đăng nhập
            </button>
          </Link>
        )}
      </div>
    </div>
  );
}
