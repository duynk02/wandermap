"use client";

import { useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, createComment, getComments } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useViewerKey } from "@/hooks/useRequireAuth";
import { QUERY_KEYS } from "@/constants";
import type { PostComment } from "@/types";
import { flattenComments, patchComment, prependComment } from "./comment-cache";
import { CommentComposer } from "./CommentComposer";
import { CommentItem } from "./CommentItem";

interface CommentSectionProps {
  postId: string;
  /** Called with the authoritative comment total after a comment/reply is posted. */
  onCommentsCountChange?: (count: number) => void;
}

function sendErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 404) return "Bài đăng hoặc bình luận không còn khả dụng.";
    if (error.status === 429) return "Bạn gửi quá nhanh, vui lòng thử lại sau ít phút.";
    if (error.status === 400) return error.message;
  }
  return "Không thể gửi bình luận. Vui lòng thử lại.";
}

/** Mounted only while the panel is open, so comments are fetched on demand and never for the whole feed. */
export function CommentSection({ postId, onCommentsCountChange }: CommentSectionProps) {
  const queryClient = useQueryClient();
  const { isLoading: authLoading } = useAuth();
  const viewer = useViewerKey();
  const listKey = QUERY_KEYS.comments.byPost(postId, viewer);

  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const query = useInfiniteQuery({
    queryKey: listKey,
    queryFn: ({ pageParam, signal }) => getComments(postId, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length + 1 : undefined),
    enabled: !authLoading, // wait for the session so is_liked is right
    staleTime: 30_000,
  });
  const comments = flattenComments(query.data);

  const sendMutation = useMutation({
    mutationFn: (input: { content: string; parent_id?: string }) => createComment(postId, input),
    onSuccess: ({ comment, post, parent }) => {
      onCommentsCountChange?.(post.comments_count);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.posts.byId(postId) });

      if (!parent) {
        prependComment(queryClient, listKey, comment);
        return;
      }
      // A reply: refresh the parent's counter, reload its replies if they were loaded, and show them.
      patchComment(queryClient, listKey, parent.id, (c) => ({ ...c, reply_count: parent.reply_count }));
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.comments.replies(parent.id, viewer) });
      setExpanded((current) => new Set(current).add(parent.id));
      setReplyTo(null);
    },
    onError: (error) => toast.error(sendErrorMessage(error)),
  });

  const toggleReplies = (commentId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(commentId)) next.add(commentId);
      return next;
    });

  return (
    <section aria-label="Bình luận" className="border-t border-border px-4 pb-4 pt-3">
      <CommentComposer
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        isSubmitting={sendMutation.isPending}
        onSubmit={async (content) => {
          await sendMutation.mutateAsync({ content, parent_id: replyTo?.id });
        }}
      />

      <div className="mt-4 space-y-4">
        {comments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            listKey={listKey}
            onReply={setReplyTo}
            repliesExpanded={expanded.has(comment.id)}
            onToggleReplies={() => toggleReplies(comment.id)}
          />
        ))}

        {query.isLoading && (
          <p className="flex items-center justify-center gap-2 py-4 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang tải bình luận...
          </p>
        )}

        {query.isError && (
          <p className="py-3 text-center text-sm text-red-500">
            Không tải được bình luận.{" "}
            <button type="button" onClick={() => void query.refetch()} className="font-semibold underline">
              Thử lại
            </button>
          </p>
        )}

        {query.isSuccess && comments.length === 0 && (
          <p className="py-3 text-center text-sm text-ink-muted">Chưa có bình luận nào. Hãy là người đầu tiên!</p>
        )}

        {query.hasNextPage && (
          <button
            type="button"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="w-full rounded-xl py-2 text-sm font-semibold text-brand-600 transition-colors hover:bg-surface-muted disabled:opacity-60"
          >
            {query.isFetchingNextPage ? "Đang tải..." : "Xem thêm bình luận"}
          </button>
        )}
      </div>
    </section>
  );
}