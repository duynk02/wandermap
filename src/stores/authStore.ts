import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { Profile } from "@/types";
import type { User } from "@supabase/supabase-js";

interface AuthState {
  user: User | null;
  profile: Profile | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setProfile: (profile: Profile | null) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>()(
  devtools(
    persist(
      (set) => ({
        user: null,
        profile: null,
        isLoading: true,
        setUser: (user) => set({ user }),
        setProfile: (profile) => set({ profile }),
        setLoading: (isLoading) => set({ isLoading }),
        reset: () => set({ user: null, profile: null, isLoading: false }),
      }),
      {
        name: "wandermap-auth",
        // Only persist profile — user session is managed by Supabase
        partialize: (state) => ({ profile: state.profile }),
      }
    ),
    { name: "wandermap-auth-store" }
  )
);
