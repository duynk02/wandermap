"use client";

import { useQuery } from "@tanstack/react-query";
import Map, { Marker } from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAPBOX_STYLE, DEFAULT_VIEWPORT } from "@/lib/mapbox";

interface ProfileTravelMapProps {
  userId: string;
}

async function fetchUserPins(userId: string) {
  const res = await fetch(`/api/users/${userId}/pins`);
  return res.json();
}

export function ProfileTravelMap({ userId }: ProfileTravelMapProps) {
  const { data: pins = [], isLoading } = useQuery({
    queryKey: ["user-pins", userId],
    queryFn: () => fetchUserPins(userId),
  });

  return (
    <div className="overflow-hidden rounded-2xl" style={{ height: 420 }}>
      <Map
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        mapStyle={MAPBOX_STYLE}
        initialViewState={DEFAULT_VIEWPORT}
        style={{ width: "100%", height: "100%" }}
        scrollZoom={false}
      >
        {pins.map((pin: any) => (
          <Marker
            key={pin.location_id}
            longitude={pin.location.coordinates.lng}
            latitude={pin.location.coordinates.lat}
            anchor="center"
          >
            <div
              className="h-4 w-4 rounded-full border-2 border-white shadow"
              style={{
                backgroundColor: pin.status === "visited" ? "#22c55e" : "#f59e0b",
              }}
              title={pin.location.name}
            />
          </Marker>
        ))}
      </Map>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-4 text-sm text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-brand-500" />
          Đã đến ({pins.filter((p: any) => p.status === "visited").length})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-amber-400" />
          Muốn đến ({pins.filter((p: any) => p.status === "wishlist").length})
        </span>
      </div>
    </div>
  );
}
