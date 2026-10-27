"use client";

import { useId, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, getAuthSessionVersion, getMyPostsByLocation } from "@/lib/api";
import { visitFieldsFromPost } from "@/lib/visited-post";
import { QUERY_KEYS } from "@/constants";
import type { VisitPostSource } from "@/types";
import { assertTravelSession, formatTravelDate, secondaryClass, travelError } from "./shared";

export function VisitPostPicker({
  locationId, viewer, disabled, onApply,
}: {
  locationId: string;
  viewer: string;
  disabled: boolean;
  onApply: (fields: { visited_at: string; note: string }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState("");
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const session = getAuthSessionVersion();
  const posts = useInfiniteQuery({
    queryKey: QUERY_KEYS.posts.mineByLocation(viewer, locationId, session),
    queryFn: async ({ pageParam, signal }) => {
      assertTravelSession(viewer);
      const result = await getMyPostsByLocation(locationId, pageParam, signal);
      assertTravelSession(viewer);
      if (session !== getAuthSessionVersion()) throw new ApiError(401, "AUTH_SESSION_CHANGED", "Phiên đăng nhập đã thay đổi.");
      return result;
    },
    enabled: expanded,
    initialPageParam: 1,
    getNextPageParam: (last) => last.hasMore ? last.page + 1 : undefined,
    retry: 1,
  });
  const choose = (post: VisitPostSource) => {
    try {
      assertTravelSession(viewer);
      if (post.author_id !== viewer || post.location_id !== locationId || session !== getAuthSessionVersion()) return;
      const fields = visitFieldsFromPost(post);
      onApply({ visited_at: fields.visited_at, note: fields.note });
      setNotice(fields.truncated
        ? "Đã điền ngày ghé thăm và tối đa 1.000 ký tự đầu của bài đăng. Bạn có thể chỉnh sửa trước khi lưu."
        : "Đã điền thông tin từ bài đăng. Bạn có thể chỉnh sửa trước khi lưu.");
      setExpanded(false);
      requestAnimationFrame(() => trigger.current?.focus());
    } catch (error) { toast.error(travelError(error)); }
  };
  const sources = posts.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <div className="rounded-2xl border border-brand-100 bg-brand-50/40 p-3.5 dark:border-brand-900 dark:bg-brand-950/30">
      <button ref={trigger} type="button" disabled={disabled} aria-expanded={expanded} aria-controls={listId}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-10 w-full items-center gap-2 rounded-lg text-left text-sm font-semibold text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 dark:text-brand-300">
        <FileText className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1">Lấy thông tin từ bài đăng</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {expanded && (
        <div id={listId} className="mt-2 space-y-3">
          <p className="text-xs leading-relaxed text-ink-muted">Chọn bài của bạn tại địa điểm này để điền ngày ghé thăm và ghi chú. Quyền xem được giữ nguyên.</p>
          {posts.isPending ? (
            <p role="status" className="flex items-center gap-2 text-xs text-ink-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Đang tải bài đăng…</p>
          ) : posts.isError ? (
            <div>
              <p role="alert" className="text-xs text-ink-muted">Không thể tải bài đăng. Bạn vẫn có thể tự điền bên dưới.</p>
              <button type="button" disabled={disabled || posts.isFetching} className={`${secondaryClass} mt-2 !min-h-9 !text-xs`} onClick={() => void posts.refetch()}>Thử tải lại</button>
            </div>
          ) : !sources.length ? (
            <p role="status" className="text-xs text-ink-muted">Bạn chưa có bài đăng tại địa điểm này. Hãy tự điền thông tin bên dưới.</p>
          ) : (
            <>
              <ul className="max-h-56 space-y-2 overflow-y-auto overscroll-contain">
                {sources.map((post) => {
                  const date = visitFieldsFromPost(post).visited_at;
                  return (
                    <li key={post.id}>
                      <button type="button" disabled={disabled} onClick={() => choose(post)}
                        className="w-full rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50">
                        <span className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
                          <span className="font-semibold text-ink">{date ? formatTravelDate(date) : "Chưa có ngày ghé thăm"}</span>
                          <span className="text-ink-muted">{{ public: "Công khai", followers: "Người theo dõi", private: "Chỉ mình tôi" }[post.visibility]}</span>
                        </span>
                        <span className="mt-1.5 block whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-muted line-clamp-2">{post.content}</span>
                        <span className="mt-2 block text-xs font-medium text-brand-700 dark:text-brand-400">Dùng bài này</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {posts.hasNextPage && <button type="button" disabled={disabled || posts.isFetchingNextPage} onClick={() => void posts.fetchNextPage()} className={`${secondaryClass} w-full !min-h-9 !text-xs`}>{posts.isFetchingNextPage ? "Đang tải…" : "Xem thêm bài đăng"}</button>}
            </>
          )}
        </div>
      )}
      {notice && <p role="status" className="mt-2 text-xs leading-relaxed text-ink-muted">{notice}</p>}
    </div>
  );
}
