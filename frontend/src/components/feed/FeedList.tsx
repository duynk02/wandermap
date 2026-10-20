"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { getFeed } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { QUERY_KEYS, ROUTES } from "@/constants";
import type { Post } from "@/types";
import { FeedPostCard } from "./FeedPostCard";
import { ImageLightbox } from "@/components/ui/ImageLightbox";

export function FeedList() {
  const [lightbox, setLightbox] = useState<{
    images: string[];
    initialIndex: number;
    trigger: HTMLButtonElement;
  } | null>(null);
  const queryClient = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();
  const viewer = user?.id ?? "guest";
  const queryKey = [...QUERY_KEYS.posts.feed({ scope: "community" }), viewer] as const;

  // Wait for the session to be restored so the first request already carries the token
  // (is_liked is per viewer). Signing in or out changes the key and loads a fresh feed.
  const { items, sentinelRef, isLoading, isError, isFetchingNextPage, hasNextPage } = useInfiniteScroll<Post>({
    queryKey,
    queryFn: async (page) => {
      const result = await getFeed({}, page);
      return { data: result.data, hasMore: result.hasMore };
    },
    enabled: !authLoading,
  });

  // Offset pagination can repeat a post when new ones are published while scrolling.
  const posts = items.filter((post, index) => items.findIndex((other) => other.id === post.id) === index);

  if (authLoading || isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
      </div>
    );
  }

  if (isError && posts.length === 0) {
    return (
      <div className="py-20 text-center text-ink-muted">
        <p className="font-medium">Không tải được bản tin</p>
        <button
          type="button"
          onClick={() => void queryClient.invalidateQueries({ queryKey })}
          className="mt-3 rounded-2xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
        >
          Thử lại
        </button>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="py-20 text-center text-ink-muted">
        <p className="mb-3 text-4xl">📍</p>
        <p className="font-medium">Chưa có bài đăng nào</p>
        <Link href={ROUTES.explore} className="mt-2 inline-block text-sm font-medium text-brand-500 hover:text-brand-600">
          Khám phá bản đồ
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {posts.map((post) => (
          <FeedPostCard
            key={post.id}
            post={post}
            onImageClick={(initialIndex, trigger) => {
              setLightbox({ images: [...post.images], initialIndex, trigger });
            }}
          />
        ))}
      </div>

      {/* Invisible sentinel: reaching it loads the next page */}
      <div ref={sentinelRef} className="h-4" />

      {isFetchingNextPage && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
        </div>
      )}
      {!hasNextPage && !isFetchingNextPage && (
        <p className="py-6 text-center text-xs text-ink-subtle">Bạn đã xem hết bản tin</p>
      )}
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          initialIndex={lightbox.initialIndex}
          isOpen
          onClose={() => setLightbox(null)}
          returnFocusTo={lightbox.trigger}
        />
      )}
    </>
  );
}
