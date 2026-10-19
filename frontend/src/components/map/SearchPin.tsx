"use client";

import { MapPin, X } from "lucide-react";
import { Marker } from "react-map-gl";
import { useMapStore } from "@/stores/mapStore";

/** Pin dropped on the place chosen in the search box. Replaced by the next search; X removes it. */
export function SearchPin() {
  const pin = useMapStore((s) => s.searchPin);
  const clearSearchPin = useMapStore((s) => s.clearSearchPin);
  if (!pin) return null;

  return (
    <Marker longitude={pin.longitude} latitude={pin.latitude} anchor="bottom" style={{ zIndex: 10 }}>
      <div className="flex flex-col items-center">
        <div className="mb-1 flex max-w-[220px] items-center gap-1 rounded-full bg-white py-1 pl-3 pr-1.5 text-xs font-semibold text-ink shadow-md">
          <span className="truncate">{pin.name}</span>
          <button
            type="button"
            onClick={clearSearchPin}
            aria-label="Xóa ghim"
            className="rounded-full p-0.5 text-ink-subtle hover:bg-surface-muted hover:text-ink"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
        <MapPin className="h-9 w-9 fill-red-500 text-white drop-shadow-md" strokeWidth={1.5} />
      </div>
    </Marker>
  );
}