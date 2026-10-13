"use client";

import { Marker } from "react-map-gl";
import { motion, AnimatePresence } from "framer-motion";
import { useMapStore } from "@/stores/mapStore";
import { useMap } from "@/hooks/useMap";
import { CATEGORY_COLORS, CATEGORY_ICONS } from "@/lib/mapbox";
import { cn } from "@/lib/utils";
import type { LocationCategory } from "@/types";

interface ClusterLayerProps {
  clusters: ReturnType<ReturnType<typeof useMap>["getClusteredPins"]>;
}

export function ClusterLayer({ clusters }: ClusterLayerProps) {
  const { setSelectedLocation, hoveredLocationId, setHoveredLocation } = useMapStore();
  const { expandCluster } = useMap();

  return (
    <AnimatePresence>
      {clusters.map((feature) => {
        const [lng, lat] = feature.geometry.coordinates;
        const isCluster = feature.properties.cluster;

        if (isCluster) {
          const count: number = feature.properties.point_count;
          return (
            <Marker key={`cluster-${feature.id}`} longitude={lng} latitude={lat} anchor="center">
              <motion.button
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                whileHover={{ scale: 1.1 }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white shadow-lg ring-4 ring-brand-500/30"
                onClick={() => expandCluster(feature.id as number, lng, lat)}
              >
                {count > 99 ? "99+" : count}
              </motion.button>
            </Marker>
          );
        }

        // Individual pin
        const props = feature.properties;
        const category = props.category as LocationCategory;
        const color = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other;
        const icon = CATEGORY_ICONS[category] ?? "📍";
        const isTrending = props.trending_score > 50;
        const isHovered = hoveredLocationId === props.id;

        return (
          <Marker
            key={`pin-${props.id}`}
            longitude={lng}
            latitude={lat}
            anchor="bottom"
          >
            <motion.button
              initial={{ scale: 0, opacity: 0, y: -10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0, opacity: 0 }}
              whileHover={{ scale: 1.15, y: -2 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className="relative flex flex-col items-center"
              onClick={() => setSelectedLocation(props.id)}
              onMouseEnter={() => setHoveredLocation(props.id)}
              onMouseLeave={() => setHoveredLocation(null)}
              aria-label={`Xem ${props.name}`}
            >
              {/* Trending pulse ring */}
              {isTrending && (
                <span
                  className="absolute -inset-1 animate-pulse-ring rounded-full"
                  style={{ backgroundColor: color + "40" }}
                />
              )}

              {/* Pin body */}
              <div
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full shadow-md transition-shadow",
                  isHovered && "shadow-xl ring-2 ring-white"
                )}
                style={{ backgroundColor: color }}
              >
                <span className="text-sm">{icon}</span>
              </div>

              {/* Pin stem */}
              <div
                className="h-2 w-0.5 rounded-b"
                style={{ backgroundColor: color }}
              />
            </motion.button>
          </Marker>
        );
      })}
    </AnimatePresence>
  );
}
