"use client";

import { useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/constants";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/stores/authStore";

/** Follow actions also change permission to send, share, and appear in contacts. */
export function useRelationshipRefresh() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return async () => {
    if (!user || useAuthStore.getState().user?.id !== user.id) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["profiles"] }),
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.messaging.viewer(user.id),
      }),
    ]);
  };
}
