"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/constants";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, getAuthSessionVersion } from "@/lib/api/client";
import { getMessagingUnreadCount, startDirectConversation } from "@/lib/api/messaging";
import { useAuthStore } from "@/stores/authStore";
import { useRealtimeStore } from "@/stores/realtimeStore";

/** The badge counts conversations, while the cached response retains both API counters. */
export function useMessagingUnreadCount(): number {
  const { user } = useAuth();
  const connected = useRealtimeStore((state) => state.connected && state.userId === user?.id);
  const { data } = useQuery({
    queryKey: QUERY_KEYS.messaging.unreadCount(user?.id ?? "guest"),
    queryFn: ({ signal }) => getMessagingUnreadCount(signal),
    enabled: !!user,
    refetchInterval: connected ? false : 30_000,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  });
  return user ? (data?.unread_conversations ?? 0) : 0;
}

/** Shared by profile actions and the new-conversation dialog. */
export function useStartConversation() {
  const { user } = useAuth();
  const viewer = user?.id;
  const queryClient = useQueryClient();
  return useMutation({
    onMutate: () => ({ viewer, session: getAuthSessionVersion() }),
    mutationFn: (recipientId: string) => {
      if (!viewer || useAuthStore.getState().user?.id !== viewer) {
        throw new ApiError(401, "AUTH_SESSION_CHANGED", "Vui lòng đăng nhập để nhắn tin.");
      }
      return startDirectConversation(recipientId);
    },
    onSuccess: (result, _recipientId, context) => {
      const owner = context.viewer;
      if (!owner) return;
      const current = () => useAuthStore.getState().user?.id === owner
        && getAuthSessionVersion() === context.session;
      if (current()) {
        queryClient.setQueryData(QUERY_KEYS.messaging.conversation(owner, result.conversation.id), result.conversation);
      }
      if (current()) {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.messaging.conversations(owner) });
      }
      if (current()) {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.messaging.unreadCount(owner) });
      }
    },
  });
}
