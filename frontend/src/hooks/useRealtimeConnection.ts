"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { QUERY_KEYS } from "@/constants";
import { getAccessToken, refreshAccessToken, subscribeAccessToken } from "@/lib/api/client";
import { createRealtimeLifecycle } from "@/lib/realtime/lifecycle";
import { useAuthStore } from "@/stores/authStore";

/** Mounted once by AuthProvider, so all pages share one socket for the current session. */
export function useRealtimeConnection() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const origin = process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:4000";
    const lifecycle = createRealtimeLifecycle({
      createSocket: (token) => io(`${origin.replace(/\/$/, "")}/realtime`, {
        path: "/socket.io",
        auth: { token },
        autoConnect: false,
        // Connect directly to NestJS; Next's REST rewrite is not an Upgrade proxy.
        transports: ["websocket"],
        reconnection: true,
        reconnectionDelay: 1_000,
        reconnectionDelayMax: 10_000,
        forceNew: true,
      }),
      getToken: getAccessToken,
      refreshToken: refreshAccessToken,
    });
    const unsubscribeToken = subscribeAccessToken(() => lifecycle.tokenChanged());
    const unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
      if (state.user?.id === previous.user?.id) return;
      lifecycle.setUser(state.user?.id ?? null);
      // Abort old viewer requests before removing their private notification data.
      void queryClient.cancelQueries({ queryKey: QUERY_KEYS.notifications.all });
      queryClient.removeQueries({ queryKey: QUERY_KEYS.notifications.all });
    });
    lifecycle.setUser(useAuthStore.getState().user?.id ?? null);

    return () => {
      unsubscribeToken();
      unsubscribeAuth();
      lifecycle.dispose();
    };
  }, [queryClient]);
}
