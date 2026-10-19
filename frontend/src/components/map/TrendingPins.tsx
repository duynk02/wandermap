"use client";

import { memo } from "react";
import { Marker } from "react-map-gl";
import { useMapStore } from "@/stores/mapStore";
import { CATEGORY_COLORS, CATEGORY_ICONS } from "@/lib/mapbox";
import type { Location } from "@/types";

interface TrendingPinsProps {
  locations: Location[];
}

// Server-rendered trending pins, shown ONLY until the first viewport query returns (MapCanvas
// unmounts this afterwards). Keeping both layers mounted drew every location twice.
export const TrendingPins = memo(function TrendingPins({ locations }: TrendingPinsProps) {
  const setSelectedLocation = useMapStore((s) => s.setSelectedLocation);

  return (
    <>
      {locations.map((loc) => {
        const color = CATEGORY_COLORS[loc.category] ?? CATEGORY_COLORS.other;
        const icon = CATEGORY_ICONS[loc.category] ?? "📍";

        return (
          <Marker
            key={`trending-${loc.id}`}
            longitude={loc.coordinates.lng}
            latitude={loc.coordinates.lat}
            anchor="bottom"
          >
            <button
              onClick={() => setSelectedLocation(loc.id)}
              className="flex flex-col items-center transition-transform hover:scale-110"
              aria-label={loc.name}
            >
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full shadow-md"
                style={{ backgroundColor: color }}
              >
                <span className="text-xs">{icon}</span>
              </div>
              <div className="h-1.5 w-0.5 rounded-b" style={{ backgroundColor: color }} />
            </button>
          </Marker>
        );
      })}
    </>
  );
});