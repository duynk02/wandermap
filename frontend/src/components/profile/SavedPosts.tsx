"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Bookmark, Loader2 } from "lucide-react";
import { PostGrid } from "@/components/post/PostGrid";
import { QUERY_KEYS } from "@/constants";
import { useAuth } from "@/hooks/useAuth";
import { getSavedPosts } from "@/lib/api";

export function SavedPosts({ profileId }: { profileId: string }) {
  const { user, isLoading: authLoading } = useAuth();
  const isOwner = user?.id === profileId;
  const query = useInfiniteQuery({
    queryKey: QUERY_KEYS.posts.saved(user?.id ?? "guest"),
    queryFn: ({ pageParam, signal }) => getSavedPosts(pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => last.hasMore ? last.page + 1 : undefined,
    enabled: !authLoading && isOwner,
  });

  if (authLoading || (isOwner && query.isPending)) {
    return <div role="status" aria-label="Đang tải bài viết đã lưu" className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-brand-500" /></div>;
  }
  if (!isOwner) {
    return <p className="py-16 text-center text-sm text-ink-muted">Bài viết đã lưu chỉ hiển thị với chủ hồ sơ.</p>;
  }
  const posts = (query.data?.pages ?? []).flatMap((page) => page.data)
    .filter((post, index, all) => all.findIndex((other) => other.id === post.id) === index);
  if (query.isError && posts.length === 0) {
    return (
      <div role="alert" className="py-16 text-center text-ink-muted">
        <p>Không tải được bài viết đã lưu.</p>
        <button type="button" onClick={() => void query.refetch()} className="mt-3 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white">Thử lại</button>
      </div>
    );
  }
  if (posts.length === 0) {
    return (
      <div className="py-16 text-center text-ink-muted">
        <Bookmark className="mx-auto mb-3 h-8 w-8 text-brand-500" aria-hidden />
        <p className="font-medium">Chưa có bài viết đã lưu</p>
        <p className="mt-1 text-sm">Nhấn biểu tượng lưu trên bài viết để xem lại tại đây.</p>
      </div>
    );
  }
  return (
    <>
      <PostGrid posts={posts} />
      {query.isFetchNextPageError && <p role="alert" className="mt-4 text-center text-sm text-red-500">Không tải được trang tiếp theo. Vui lòng thử lại.</p>}
      {query.hasNextPage && (
        <button type="button" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} className="mt-6 w-full rounded-xl bg-surface-elevated py-3 text-sm font-semibold text-brand-600 disabled:opacity-50">
          {query.isFetchingNextPage ? "Đang tải..." : "Xem thêm bài đã lưu"}
        </button>
      )}
    </>
  );
}
