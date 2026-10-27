"use client";

import { getPostsByLocation } from "@/lib/api";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { PostCard } from "./PostCard";
import { QUERY_KEYS } from "@/constants";
import type { Post } from "@/types";

interface PostFeedClientProps {
  locationId: string;
  initialPage?: number;
}

async function fetchPosts(locationId: string, page: number) {
  const result = await getPostsByLocation(locationId, page);
  return { data: result.data as Post[], hasMore: result.hasMore };
}

export function PostFeedClient({ locationId, initialPage = 1 }: PostFeedClientProps) {
  const { items, sentinelRef, isFetchingNextPage } = useInfiniteScroll<Post>({
    queryKey: [...QUERY_KEYS.posts.byLocation(locationId), "client", initialPage],
    queryFn: (page) => fetchPosts(locationId, page + initialPage - 1),
  });

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>

      {/* Invisible sentinel element — triggers next page fetch */}
      <div ref={sentinelRef} className="h-4" />

      {isFetchingNextPage && (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        </div>
      )}
    </>
  );
}
