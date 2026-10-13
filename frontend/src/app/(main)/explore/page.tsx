import type { Metadata } from "next";
import { getTrendingLocations } from "@/lib/api";
import { MapCanvas } from "@/components/map/MapCanvas";
import { LocationDrawer } from "@/components/location/LocationDrawer";
import { MapTopbar } from "@/components/map/MapTopbar";
import { MapFilterBar } from "@/components/map/MapFilterBar";

export const metadata: Metadata = {
  title: "Khám phá",
  description: "Khám phá địa điểm du lịch trên bản đồ tương tác",
};

// Initial trending locations fetched on server — no loading flash
export default async function ExplorePage() {
  const initialLocations = await getTrendingLocations(50);

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      {/* Full-screen map */}
      <MapCanvas initialLocations={initialLocations} />

      {/* Floating UI layer */}
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        {/* Top: search + nav */}
        <div className="pointer-events-auto">
          <MapTopbar />
        </div>

        {/* Bottom: category filter pills */}
        <div className="pointer-events-auto mt-auto">
          <MapFilterBar />
        </div>
      </div>

      {/* Location detail drawer — slides in from right on desktop, bottom on mobile */}
      <LocationDrawer />
    </main>
  );
}
