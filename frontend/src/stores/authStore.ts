import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { AuthUser, Profile } from "@/types";

interface AuthState {
  user: AuthUser | null;
  profile: Profile | null;
  isLoading: boolean;
  setSession: (user: AuthUser, profile: Profile) => void;
  updateProfile: (profile: Profile) => void;
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
        setSession: (user, profile) => set({ user, profile, isLoading: false }),
        updateProfile: (profile) => set((state) => state.user?.id === profile.id ? { profile } : {}),
        setLoading: (isLoading) => set({ isLoading }),
        reset: () => set({ user: null, profile: null, isLoading: false }),
      }),
      {
        name: "wandermap-auth",
        // Only the (public) profile is persisted, as a hint that a session may be restorable.
        // Tokens are never stored: the access token is in memory, the refresh token is an
        // HttpOnly cookie.
        partialize: (state) => ({ profile: state.profile }),
      }
    ),
    { name: "wandermap-auth-store" }
  )
);
