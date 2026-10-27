"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authApi, getAuthSessionVersion, refreshAccessToken, setAccessToken, setSessionExpiredHandler, subscribeSessionChange } from "@/lib/api";
import { observeBrowserResume } from "@/lib/realtime/browser-resume";
import type { LoginInput, RegisterInput } from "@/lib/validations";
import { useAuthStore } from "@/stores/authStore";
import { useRealtimeStore } from "@/stores/realtimeStore";
import type { CurrentUser } from "@/types";

function applyUser(user: CurrentUser) {
  const { email, ...profile } = user;
  useAuthStore.getState().setSession({ id: user.id, email }, profile);
}

export async function signIn(input: LoginInput) {
  applyUser(await authApi.login(input));
}

export async function signUp(input: RegisterInput) {
  const result = await authApi.register(input);
  useAuthStore.getState().reset();
  return result;
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
    setSessionExpiredHandler(() => { reset(); useRealtimeStore.getState().setPhase("session-expired"); });
    let cancelled = false;
    let restoring = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1_000;
    let forceRestore = false;
    let restoreRequested = false;

    const restore = async () => {
      if (cancelled || restoring || useAuthStore.getState().user) return;
      if (!useAuthStore.getState().profile && !restoreRequested) {
        setLoading(false);
        return;
      }
      restoring = true;
      forceRestore = false;
      try {
        // refreshAccessToken resets an invalid session itself. A stale refresh result
        // must not reset a session established by a concurrent login.
        if (!(await refreshAccessToken()) || cancelled) {
          if (!forceRestore) restoreRequested = false;
          return;
        }
        const restoredVersion = getAuthSessionVersion();
        const me = await authApi.getMe();
        if (!cancelled && restoredVersion === getAuthSessionVersion()) { applyUser(me); restoreRequested = false; }
      } catch {
        if (!cancelled) {
          retryTimer = setTimeout(() => { retryTimer = undefined; void restore(); }, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30_000);
        }
      } finally {
        restoring = false;
        if (!cancelled) setLoading(false);
        if (!cancelled && forceRestore) {
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = undefined;
          queueMicrotask(() => { void restore(); });
        }
      }
    };
    void restore();
    const stopResume = observeBrowserResume(() => { if (!retryTimer) void restore(); }, () => {});
    const stopSession = subscribeSessionChange((change) => {
      setAccessToken(null);
      reset();
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
      forceRestore = change === "signed-in";
      restoreRequested = forceRestore;
      // A shared-cookie login invalidates this tab's old identity and restores via REST.
      if (forceRestore) void restore();
    });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      stopResume();
      stopSession();
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
