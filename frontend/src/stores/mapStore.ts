import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { MapViewport, MapBounds, LocationFilters, Location } from "@/types";
import { DEFAULT_VIEWPORT } from "@/lib/mapbox";

interface MapState {
  // Viewport
  viewport: MapViewport;
  bounds: MapBounds | null;
  setViewport: (viewport: MapViewport) => void;
  setBounds: (bounds: MapBounds) => void;

  // Selected pin
  selectedLocationId: string | null;
  setSelectedLocation: (id: string | null) => void;

  // Filters
  filters: LocationFilters;
  setFilters: (filters: Partial<LocationFilters>) => void;
  resetFilters: () => void;

  // UI state
  isDrawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;

  // Hovered pin (for hover effects)
  hoveredLocationId: string | null;
  setHoveredLocation: (id: string | null) => void;

}

const defaultFilters: LocationFilters = {
  category: null,
  minRating: null,
  country: null,
  searchQuery: null,
};

export const useMapStore = create<MapState>()(
  devtools(
    (set) => ({
      viewport: DEFAULT_VIEWPORT,
      bounds: null,
      setViewport: (viewport) => set({ viewport }),
      setBounds: (bounds) => set({ bounds }),

      selectedLocationId: null,
      setSelectedLocation: (id) =>
        set({ selectedLocationId: id, isDrawerOpen: id !== null }),

      filters: defaultFilters,
      setFilters: (filters) =>
        set((state) => ({ filters: { ...state.filters, ...filters } })),
      resetFilters: () => set({ filters: defaultFilters }),

      isDrawerOpen: false,
      setDrawerOpen: (open) =>
        set({ isDrawerOpen: open, selectedLocationId: open ? undefined : null }),
      // Hovered pin (for hover effects)
      hoveredLocationId: null,
      setHoveredLocation: (id) => set({ hoveredLocationId: id }),
    }),

    { name: "wandermap-map-store" }
  )
);
