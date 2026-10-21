import type { Profile, TravelVisibility } from "./index";

export interface TravelFilters {
  year?: number;
  search?: string;
  country?: string;
}
export interface TravelMapPoint {
  id: string;
  location_id: string;
  name: string;
  city: string | null;
  country: string | null;
  coordinates: { lat: number; lng: number };
  last_visited_at: string | null;
  visit_count: number;
  visibility?: TravelVisibility;
}
export interface TravelMapData {
  points: TravelMapPoint[];
  statistics: {
    location_count: number;
    visit_count: number;
    journey_count: number;
  };
  options: { years: number[]; countries: string[] };
}
export interface JourneyStyle {
  version: 1;
  line_color: string;
  line_style: "solid" | "dashed";
  show_labels: boolean;
  show_order: boolean;
  map_style: "outdoors-v12" | "dark-v11";
}
export interface JourneyBase {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  visibility: TravelVisibility;
  status: "draft" | "published";
  style_config: JourneyStyle;
  revision: number;
  created_at: string;
  updated_at: string;
  author: Pick<Profile, "id" | "username" | "display_name" | "avatar_url">;
}
export interface JourneySummary extends JourneyBase {
  stop_count: number;
  preview_names: string[];
}
export interface JourneyStop {
  id: string;
  location_id: string;
  visit_id?: string | null;
  stop_order: number;
  location_name_snapshot: string;
  visited_at_snapshot: string | null;
  location: {
    id: string;
    name: string;
    city: string | null;
    country: string | null;
    coordinates: { lat: number; lng: number };
  };
}
export interface Journey extends JourneyBase {
  stops: JourneyStop[];
}
export interface JourneyStopInput {
  location_id: string;
  visit_id?: string | null;
}
export interface JourneyWriteInput {
  title: string;
  description?: string | null;
  cover_image_url?: string | null;
  visibility: TravelVisibility;
  status: "draft" | "published";
  style_config: JourneyStyle;
  stops: JourneyStopInput[];
}
