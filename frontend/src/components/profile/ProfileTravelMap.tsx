"use client";

import { useQuery } from "@tanstack/react-query";
import Map, { Marker, NavigationControl } from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAPBOX_STYLE, DEFAULT_VIEWPORT } from "@/lib/mapbox";
import { getMyPins } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

interface ProfileTravelMapProps {
  userId: string;
}

export function ProfileTravelMap({ userId }: ProfileTravelMapProps) {
  const { user, isLoading: isAuthLoading } = useAuth();
  // The API only exposes the signed-in user's own pins (GET /users/me/pins).
  const isOwner = user?.id === userId;

  const { data: pins = [] } = useQuery({
    queryKey: ["user-pins", userId],
    queryFn: getMyPins,
    enabled: isOwner,
  });

  if (isAuthLoading) return <div className="h-[420px] animate-pulse rounded-2xl bg-surface-muted" />;
  if (!isOwner) {
    return (
      <p className="rounded-2xl bg-surface-muted p-6 text-sm text-ink-muted">
        Bản đồ du lịch chỉ hiển thị cho chủ tài khoản.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl" style={{ height: 420 }}>
      <Map
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        mapStyle={MAPBOX_STYLE}
        initialViewState={DEFAULT_VIEWPORT}
        style={{ width: "100%", height: "100%" }}
        scrollZoom
        touchZoomRotate
      >
        <NavigationControl position="bottom-right" showCompass={false} />
        {pins.map((pin) => (
          <Marker
            key={pin.id}
            longitude={pin.coordinates.lng}
            latitude={pin.coordinates.lat}
            anchor="center"
          >
            <div
              className="h-4 w-4 rounded-full border-2 border-white shadow"
              style={{
                backgroundColor: pin.status === "visited" ? "#22c55e" : "#f59e0b",
              }}
              title={pin.name}
            />
          </Marker>
        ))}
      </Map>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-4 text-sm text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-brand-500" />
          Đã đến ({pins.filter((p) => p.status === "visited").length})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-amber-400" />
          Muốn đến ({pins.filter((p) => p.status === "wishlist").length})
        </span>
      </div>
    </div>
  );
}
