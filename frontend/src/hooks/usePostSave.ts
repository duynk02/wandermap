"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QUERY_KEYS } from "@/constants";
import { getAuthSessionVersion, setPostSaved } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import type { Post } from "@/types";

/** One save flow for feed, profile grids and Journey cards. Server counters stay authoritative. */
export function usePostSave(post: Post) {
  const cache = useQueryClient();
  const viewer = useAuthStore((state) => state.user?.id);
  const [saved, setSaved] = useState(post.is_saved ?? false);
  const [savesCount, setSavesCount] = useState(post.saves_count);
  useEffect(() => {
    setSaved(post.is_saved ?? false);
    setSavesCount(post.saves_count);
  }, [post.id, post.is_saved, post.saves_count, viewer]);
  const saveMutation = useMutation({
    mutationFn: (next: boolean) => setPostSaved(post.id, next),
    onMutate: () => ({ viewer, sessionVersion: getAuthSessionVersion() }),
    onSuccess: async (result, _next, context) => {
      if (!context || useAuthStore.getState().user?.id !== context.viewer || getAuthSessionVersion() !== context.sessionVersion) return;
      setSaved(result.saved);
      setSavesCount(result.saves_count);
      // Includes saved pages, feeds and post details, with pagination reconciled by REST.
      await cache.cancelQueries({ queryKey: QUERY_KEYS.posts.all });
      if (useAuthStore.getState().user?.id !== context.viewer || getAuthSessionVersion() !== context.sessionVersion) return;
      await cache.invalidateQueries({ queryKey: QUERY_KEYS.posts.all });
    },
    onError: (_cause, _next, context) => {
      if (context && useAuthStore.getState().user?.id === context.viewer && getAuthSessionVersion() === context.sessionVersion) toast.error("Không thể cập nhật bài đã lưu");
    },
  });
  return { saved, savesCount, saveMutation };
}
