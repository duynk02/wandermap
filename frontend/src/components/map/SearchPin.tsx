"use client";

import Link from "next/link";
import { ArrowUpRight, MapPin, PenLine, X } from "lucide-react";
import { Marker } from "react-map-gl";
import { useMapStore } from "@/stores/mapStore";
import { postLocationHref } from "@/lib/post-location";
import { SearchVisitedButton } from "./SearchVisitedButton";

/** Pin dropped on the place chosen in the search box. Replaced by the next search; X removes it. */
export function SearchPin() {
  const pin = useMapStore((s) => s.searchPin);
  const clearSearchPin = useMapStore((s) => s.clearSearchPin);
  if (!pin) return null;

  return (
    <Marker
      longitude={pin.longitude}
      latitude={pin.latitude}
      anchor="bottom"
      // Keep the text card out of Mapbox's persistent transform layer during zoom.
      style={{ zIndex: 10, willChange: "auto" }}
    >
      <div className="flex flex-col items-center">
        <div className="mb-2 w-[280px] max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-surface p-3 text-ink shadow-xl">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 py-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Địa điểm đã chọn</p>
              <p className="mt-1 break-words text-sm font-semibold leading-snug">{pin.name}</p>
            </div>
            <button
              type="button"
              onClick={clearSearchPin}
              aria-label="Xóa ghim"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <X className="h-[18px] w-[18px]" aria-hidden />
            </button>
          </div>
          <Link
            href={postLocationHref(pin.selection)}
            prefetch={false}
            className="mt-3 flex min-h-11 items-center gap-2 rounded-xl bg-brand-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <PenLine className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">Viết bài về địa điểm này</span>
            <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden />
          </Link>
          <div className="mt-2">
            <SearchVisitedButton selection={pin.selection} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
            Lưu vào bản đồ của bạn để tạo hành trình. Không cần ảnh hay bài đăng.
          </p>
        </div>
        <MapPin className="h-9 w-9 fill-red-500 text-white drop-shadow-md" strokeWidth={1.5} />
      </div>
    </Marker>
  );
}
