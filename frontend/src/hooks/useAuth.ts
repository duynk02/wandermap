"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authApi, getAuthSessionVersion, refreshAccessToken, setSessionExpiredHandler } from "@/lib/api";
import type { LoginInput, RegisterInput } from "@/lib/validations";
import { useAuthStore } from "@/stores/authStore";
import type { CurrentUser } from "@/types";

function applyUser(user: CurrentUser) {
  const { email, ...profile } = user;
  useAuthStore.getState().setSession({ id: user.id, email }, profile);
}

export async function signIn(input: LoginInput) {
  applyUser(await authApi.login(input));
}

export async function signUp(input: RegisterInput) {
  applyUser(await authApi.register(input));
}

export async function signOut() {
  // Clear the viewer/cache/socket before waiting for the logout network request.
  useAuthStore.getState().reset();
  await authApi.logout();
}

/**
 * Restores the session on page load. Place this hook once, in the root layout.
 *
 * The access token lives in memory, so after a reload we exchange the HttpOnly refresh
 * cookie for a new one. To avoid a pointless 401 for every anonymous visitor, we only try
 * when a previous session left a persisted profile behind.
 */
export function useAuthListener() {
  useEffect(() => {
    const { setLoading, reset } = useAuthStore.getState();
    setSessionExpiredHandler(reset);
    let cancelled = false;

    (async () => {
      if (!useAuthStore.getState().profile) {
        setLoading(false);
        return;
      }
      try {
        // refreshAccessToken resets an invalid session itself. A stale refresh result
        // must not reset a session established by a concurrent login.
        if (!(await refreshAccessToken()) || cancelled) return;
        const restoredVersion = getAuthSessionVersion();
        const me = await authApi.getMe();
        if (!cancelled && restoredVersion === getAuthSessionVersion()) applyUser(me);
      } catch {
        // Network/server error: not a logout. Stay signed-out for now, keep the hint.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      setSessionExpiredHandler(null);
    };
  }, []);
}

/** Convenience hook: current user + profile. */
export function useAuth() {
  const { user, profile, isLoading } = useAuthStore();
  return { user, profile, isLoading, isAuthenticated: !!user };
}

/** Auth pages: bounce already-signed-in users to `next`. */
export function useRedirectIfAuthenticated(next: string) {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  useEffect(() => {
    if (isAuthenticated) router.replace(next);
  }, [isAuthenticated, next, router]);
}

/** Only allow same-site relative redirects (prevents open redirects via ?next=). */
export function safeNext(next: string | null, fallback: string): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}
