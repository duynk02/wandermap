"use client";

import { useQuery } from "@tanstack/react-query";
import { getUnreadNotificationCount } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { QUERY_KEYS } from "@/constants";

/**
 * Unread count for the bell badge. Polled every 30 s (paused while the tab is hidden) and
 * refreshed when the tab regains focus, so a new like / comment / follow shows up without a reload.
 * Every bell on the page shares this one query.
 */
export function useUnreadNotificationCount(): number {
  const { isAuthenticated, user } = useAuth();
  const { data } = useQuery({
    queryKey: QUERY_KEYS.notifications.unreadCount(user?.id ?? "guest"),
    queryFn: async ({ signal }) => (await getUnreadNotificationCount(signal)).count,
    enabled: isAuthenticated,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
  return isAuthenticated ? (data ?? 0) : 0;
}