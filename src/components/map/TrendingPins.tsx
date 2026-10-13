"use client";

import { Marker } from "react-map-gl";
import { useMapStore } from "@/stores/mapStore";
import { CATEGORY_COLORS, CATEGORY_ICONS } from "@/lib/mapbox";
import type { Location } from "@/types";

interface TrendingPinsProps {
  locations: Location[];
}

// Renders the initial set of trending pins fetched server-side.
// Once the map loads and ClusterLayer takes over via viewport queries,
// these become redundant but cause no harm (deduped by location id).
export function TrendingPins({ locations }: TrendingPinsProps) {
  const { setSelectedLocation } = useMapStore();

  return (
    <>
      {locations.map((loc) => {
        const color = CATEGORY_COLORS[loc.category] ?? CATEGORY_COLORS.other;
        const icon  = CATEGORY_ICONS[loc.category]  ?? "📍";

        return (
          <Marker
            key={`trending-${loc.id}`}
            longitude={loc.coordinates.lng}
            latitude={loc.coordinates.lat}
            anchor="bottom"
          >
            <button
              onClick={() => setSelectedLocation(loc.id)}
              className="flex flex-col items-center hover:scale-110 transition-transform"
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
}
