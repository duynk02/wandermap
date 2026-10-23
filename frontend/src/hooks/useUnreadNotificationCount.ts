"use client";

import { useQuery } from "@tanstack/react-query";
import { getUnreadNotificationCount } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { QUERY_KEYS } from "@/constants";
import { useRealtimeStore } from "@/stores/realtimeStore";

/**
 * Socket events invalidate this REST query. A 30 s fallback runs only while disconnected
 * (paused while the tab is hidden), including deployments where realtime is unavailable.
 * Every bell on the page shares this one query.
 */
export function useUnreadNotificationCount(): number {
  const { isAuthenticated, user } = useAuth();
  const connected = useRealtimeStore((state) => state.connected && state.notificationsAvailable && state.userId === user?.id);
  const { data } = useQuery({
    queryKey: QUERY_KEYS.notifications.unreadCount(user?.id ?? "guest"),
    queryFn: async ({ signal }) => (await getUnreadNotificationCount(signal)).count,
    enabled: isAuthenticated,
    refetchInterval: connected ? false : 30_000,
    refetchOnWindowFocus: false, // Central visibility reconciliation is throttled per tab.
    staleTime: 10_000,
  });
  return isAuthenticated ? (data ?? 0) : 0;
}
