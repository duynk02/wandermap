"use client";

import { FeedPostCard } from "@/components/feed/FeedPostCard";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { getPostById } from "@/lib/api";
import { QUERY_KEYS } from "@/constants";
import type { JourneyPost } from "@/types";
import { JourneyPostGridCard } from "./JourneyPostGridCard";

/** Reuse author, caption, Like, Comment and Save for every surface showing a Journey post. */
export function JourneyPostCard({
  post,
  resolveViewer = false,
  variant = "feed",
}: {
  post: JourneyPost;
  resolveViewer?: boolean;
  variant?: "feed" | "grid";
}) {
  const { user, isLoading } = useAuth();
  const viewer = user?.id ?? "guest";
  // Profile grids are initially fetched anonymously by the server; restore the real viewer state.
  const current = useQuery({
    queryKey: [...QUERY_KEYS.posts.byId(post.id), viewer],
    queryFn: () => getPostById(post.id),
    enabled: resolveViewer && !isLoading,
    retry: false,
  });
  if (resolveViewer && (isLoading || current.isPending))
    return <div className="h-80 animate-pulse rounded-2xl bg-surface-muted" />;
  if (resolveViewer && current.isError)
    return (
      <button
        type="button"
        onClick={() => current.refetch()}
        className="rounded-2xl border border-border p-5 text-sm text-ink-muted"
      >
        Chưa thể tải bài hành trình. Nhấn để thử lại.
      </button>
    );
  if (resolveViewer && !current.data) return null;
  const visible = resolveViewer ? current.data! : post;
  if (variant === "grid" && visible.post_type === "journey")
    return <JourneyPostGridCard key={`${post.id}-${viewer}`} post={visible} />;
  return (
    <FeedPostCard
      key={`${post.id}-${viewer}`}
      post={visible}
    />
  );
}
