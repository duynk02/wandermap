"use client";

import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useMapStore } from "@/stores/mapStore";
import { LOCATION_CATEGORIES } from "@/constants";
import { cn } from "@/lib/utils";
import type { LocationCategory } from "@/types";

export function MapFilterBar() {
  const { filters, setFilters, resetFilters } = useMapStore();
  const activeCategory = filters.category;

  const toggleCategory = (cat: LocationCategory) => {
    setFilters({ category: activeCategory === cat ? null : cat });
  };

  return (
    <div className="flex items-center gap-2 overflow-x-auto p-4 pb-6 scrollbar-none">
      {/* Reset pill */}
      {activeCategory && (
        <motion.button
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          onClick={resetFilters}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-3 py-2 text-xs font-medium text-white shadow-md"
        >
          <X className="h-3 w-3" />
          Xoá lọc
        </motion.button>
      )}

      {LOCATION_CATEGORIES.map((cat) => {
        const isActive = activeCategory === cat.value;
        return (
          <motion.button
            key={cat.value}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => toggleCategory(cat.value)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold shadow-md backdrop-blur-sm transition-all",
              isActive
                ? "bg-brand-500 text-white"
                : "bg-white/90 text-ink hover:bg-white dark:bg-surface-elevated/90 dark:hover:bg-surface-elevated"
            )}
          >
            <span>{cat.icon}</span>
            <span>{cat.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
