"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getPostById } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { QUERY_KEYS, ROUTES } from "@/constants";
import { PostDetail } from "./PostDetail";

/**
 * The server renders anonymously (the access token only exists in the browser), so posts that
 * are `followers` / `private` come back 404 there. This retries as the signed-in user once the
 * session has been restored, so authors can open their own non-public posts.
 */
export function PostDetailFallback({ id }: { id: string }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const { data: post, isLoading } = useQuery({
    queryKey: [...QUERY_KEYS.posts.byId(id), "viewer"],
    queryFn: () => getPostById(id),
    enabled: !authLoading && isAuthenticated,
    retry: false,
  });

  if (authLoading || (isAuthenticated && isLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  if (post) return <PostDetail post={post} />;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-surface px-4 text-center">
      <p className="text-4xl">🔒</p>
      <h1 className="text-lg font-semibold text-ink">Không tìm thấy bài đăng</h1>
      <p className="max-w-sm text-sm text-ink-muted">
        Bài đăng không tồn tại hoặc bạn không có quyền xem.
      </p>
      <div className="mt-2 flex gap-3 text-sm font-medium">
        {!isAuthenticated && (
          <Link
            href={`${ROUTES.login}?next=${encodeURIComponent(ROUTES.post(id))}`}
            className="rounded-2xl bg-brand-500 px-4 py-2 text-white hover:bg-brand-600"
          >
            Đăng nhập
          </Link>
        )}
        <Link href={ROUTES.explore} className="rounded-2xl px-4 py-2 text-brand-600 hover:bg-surface-muted">
          Về trang khám phá
        </Link>
      </div>
    </div>
  );
}
