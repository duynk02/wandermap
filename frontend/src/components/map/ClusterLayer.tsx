"use client";

import { memo } from "react";
import { Marker } from "react-map-gl";
import { motion } from "framer-motion";
import { useMapStore } from "@/stores/mapStore";
import type { MapCluster } from "@/hooks/useMap";
import { CATEGORY_COLORS, CATEGORY_ICONS } from "@/lib/mapbox";
import { cn } from "@/lib/utils";
import type { LocationCategory } from "@/types";

interface ClusterLayerProps {
  clusters: MapCluster[];
  /** From the map's own useMap() instance (the one that owns the cluster index). */
  onExpandCluster: (clusterId: number, lng: number, lat: number) => void;
}

interface PinProps {
  id: string;
  name: string;
  lng: number;
  lat: number;
  category: LocationCategory;
  trending: boolean;
  hovered: boolean;
}

// memo: with ~200 DOM markers, only the pin whose `hovered` flips should re-render.
const PinMarker = memo(function PinMarker({ id, name, lng, lat, category, trending, hovered }: PinProps) {
  const setSelectedLocation = useMapStore((s) => s.setSelectedLocation);
  const setHoveredLocation = useMapStore((s) => s.setHoveredLocation);
  const color = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other;
  const icon = CATEGORY_ICONS[category] ?? "📍";

  return (
    <Marker longitude={lng} latitude={lat} anchor="bottom">
      <motion.button
        initial={{ scale: 0, opacity: 0, y: -10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        whileHover={{ scale: 1.15, y: -2 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        className="relative flex flex-col items-center"
        onClick={() => setSelectedLocation(id)}
        onMouseEnter={() => setHoveredLocation(id)}
        onMouseLeave={() => setHoveredLocation(null)}
        aria-label={`Xem ${name}`}
      >
        {/* Trending pulse ring */}
        {trending && (
          <span
            className="absolute -inset-1 animate-pulse-ring rounded-full"
            style={{ backgroundColor: color + "40" }}
          />
        )}

        {/* Pin body */}
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full shadow-md transition-shadow",
            hovered && "shadow-xl ring-2 ring-white"
          )}
          style={{ backgroundColor: color }}
        >
          <span className="text-sm">{icon}</span>
        </div>

        {/* Pin stem */}
        <div className="h-2 w-0.5 rounded-b" style={{ backgroundColor: color }} />
      </motion.button>
    </Marker>
  );
});

export function ClusterLayer({ clusters, onExpandCluster }: ClusterLayerProps) {
  const hoveredLocationId = useMapStore((s) => s.hoveredLocationId);

  return (
    <>
      {clusters.map((feature) => {
        const [lng, lat] = feature.geometry.coordinates;
        const props = feature.properties;

        if (props.cluster) {
          const count: number = props.point_count;
          return (
            <Marker key={`cluster-${feature.id}`} longitude={lng} latitude={lat} anchor="center">
              <motion.button
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                whileHover={{ scale: 1.1 }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white shadow-lg ring-4 ring-brand-500/30"
                onClick={() => onExpandCluster(feature.id as number, lng, lat)}
                aria-label={`Cụm ${count} địa điểm. Bấm để phóng to`}
              >
                {count > 99 ? "99+" : count}
              </motion.button>
            </Marker>
          );
        }

        return (
          <PinMarker
            key={`pin-${props.id}`}
            id={props.id}
            name={props.name}
            lng={lng}
            lat={lat}
            category={props.category as LocationCategory}
            trending={props.trending_score > 50}
            hovered={hoveredLocationId === props.id}
          />
        );
      })}
    </>
  );
}