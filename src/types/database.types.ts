// ─────────────────────────────────────────────────────────────────────────────
//  AUTO-GENERATED — DO NOT EDIT MANUALLY
//
//  Regenerate with:
//    npm run db:generate
//  which runs:
//    supabase gen types typescript --local > src/types/database.types.ts
//
//  This file provides end-to-end type safety from Supabase → TypeScript.
//  Every table, view, and RPC function will have accurate types here.
// ─────────────────────────────────────────────────────────────────────────────

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// Placeholder — run `npm run db:generate` after connecting to Supabase
export interface Database {
  public: {
    Tables: {
      profiles: { Row: any; Insert: any; Update: any };
      locations: { Row: any; Insert: any; Update: any };
      posts: { Row: any; Insert: any; Update: any };
      itineraries: { Row: any; Insert: any; Update: any };
      itinerary_stops: { Row: any; Insert: any; Update: any };
      follows: { Row: any; Insert: any; Update: any };
      likes: { Row: any; Insert: any; Update: any };
      saves: { Row: any; Insert: any; Update: any };
      user_pins: { Row: any; Insert: any; Update: any };
    };
    Views: Record<string, never>;
    Functions: {
      get_locations_in_viewport: { Args: any; Returns: any };
      get_following_feed: { Args: any; Returns: any };
      refresh_trending_scores: { Args: Record<string, never>; Returns: void };
    };
    Enums: Record<string, never>;
  };
}
