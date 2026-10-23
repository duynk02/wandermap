"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createSocketClient } from "@/lib/realtime/socket-client";
import { realtimeSession } from "@/lib/realtime/session";
import { observeBrowserResume } from "@/lib/realtime/browser-resume";
import { QUERY_KEYS } from "@/constants";
import { getAccessToken, refreshAccessToken, subscribeAccessToken } from "@/lib/api/client";
import { createRealtimeLifecycle } from "@/lib/realtime/lifecycle";
import { createNotificationSync, refreshNotificationQueries } from "@/lib/realtime/notifications";
import { createMessagingSync } from "@/lib/realtime/messaging";
import { getConversationMessage } from "@/lib/api/messaging";
import { useAuthStore } from "@/stores/authStore";
import { useRealtimeStore } from "@/stores/realtimeStore";

/** Mounted once by AuthProvider, so all pages share one socket for the current session. */
export function useRealtimeConnection() {
  const queryClient = useQueryClient();

  useEffect(() => realtimeSession.acquire(queryClient, () => {
    const origin = process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:4000";
    const messaging = createMessagingSync({ client: queryClient, keys: QUERY_KEYS.messaging,
      getUserId: () => useAuthStore.getState().user?.id ?? null,
      loadMessage: (conversation, message, signal) => getConversationMessage(conversation, message, signal),
    });
    const notifications = createNotificationSync({
      getUserId: () => useAuthStore.getState().user?.id ?? null,
      invalidate: (userId) => {
        void refreshNotificationQueries(queryClient, [
          QUERY_KEYS.notifications.list(userId),
          QUERY_KEYS.notifications.unreadCount(userId),
        ], () => useAuthStore.getState().user?.id === userId);
      },
    });
    const lifecycle = createRealtimeLifecycle({
      createSocket: createSocketClient(origin),
      getToken: getAccessToken,
      refreshToken: refreshAccessToken,
      onPhaseChange: (phase) => useRealtimeStore.getState().setPhase(phase),
      onConnectionChange: (userId, connected) => {
        useRealtimeStore.getState().setConnection(userId, connected);
        // Close the short polling-to-socket gap; no replay/cursor recovery protocol.
        if (connected && userId) { notifications.refresh(userId); messaging.refresh(userId); }
      },
      onNotification: (userId, payload) => { notifications.receive(userId, payload); },
      onMessagingEvent: (userId, name, payload) => { messaging.receive(userId, name, payload); },
      onNotificationStatus: (userId, payload) => {
        if (!payload || typeof payload !== "object" || !("available" in payload) || typeof payload.available !== "boolean") return;
        useRealtimeStore.getState().setNotificationsAvailable(userId, payload.available);
        if (payload.available) notifications.refresh(userId);
      },
    });
    const unsubscribeToken = subscribeAccessToken(() => lifecycle.tokenChanged());
    const unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
      if (state.user?.id === previous.user?.id) return;
      notifications.clear();
      messaging.clear();
      lifecycle.setUser(state.user?.id ?? null);
      // Abort old viewer requests before removing their private notification data.
      void queryClient.cancelQueries({ queryKey: QUERY_KEYS.notifications.all });
      queryClient.removeQueries({ queryKey: QUERY_KEYS.notifications.all });
      void queryClient.cancelQueries({ queryKey: QUERY_KEYS.messaging.all });
      queryClient.removeQueries({ queryKey: QUERY_KEYS.messaging.all });
    });
    lifecycle.setUser(useAuthStore.getState().user?.id ?? null);
    const stopResume = observeBrowserResume(() => {
      lifecycle.resume();
      const owner = useAuthStore.getState().user?.id;
      if (owner) { notifications.refresh(owner); messaging.refresh(owner); }
    }, () => lifecycle.offline());

    return () => {
      unsubscribeToken();
      stopResume();
      unsubscribeAuth();
      lifecycle.dispose();
      notifications.dispose();
      messaging.dispose();
    };
  }), [queryClient]);
}
