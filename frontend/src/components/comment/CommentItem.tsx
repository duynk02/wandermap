"use client";

import Link from "next/link";
import { useInfiniteQuery, useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { ChevronDown, Heart, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getReplies, setCommentLiked } from "@/lib/api";
import { useRequireAuth, useViewerKey } from "@/hooks/useRequireAuth";
import { QUERY_KEYS, ROUTES } from "@/constants";
import { cn, formatCount, getAvatarUrl, timeAgo } from "@/lib/utils";
import type { PostComment } from "@/types";
import { flattenComments, patchComment } from "./comment-cache";

interface CommentItemProps {
  comment: PostComment;
  /** Query key of the list this comment is rendered from (used for optimistic updates). */
  listKey: QueryKey;
  /** Replies cannot be replied to: the reply action only exists on top-level comments. */
  isReply?: boolean;
  onReply?: (comment: PostComment) => void;
  repliesExpanded?: boolean;
  onToggleReplies?: () => void;
}

export function CommentItem({
  comment,
  listKey,
  isReply = false,
  onReply,
  repliesExpanded = false,
  onToggleReplies,
}: CommentItemProps) {
  const queryClient = useQueryClient();
  const requireAuth = useRequireAuth();

  const likeMutation = useMutation({
    mutationFn: (nextLiked: boolean) => setCommentLiked(comment.id, nextLiked),
    onMutate: (nextLiked) => {
      // Optimistic update, remembering what to restore.
      const previous = { liked: comment.is_liked, count: comment.likes_count };
      patchComment(queryClient, listKey, comment.id, (c) => ({
        ...c,
        is_liked: nextLiked,
        likes_count: Math.max(0, c.likes_count + (nextLiked ? 1 : -1)),
      }));
      return previous;
    },
    onError: (_error, _nextLiked, previous) => {
      if (previous) {
        patchComment(queryClient, listKey, comment.id, (c) => ({
          ...c,
          is_liked: previous.liked,
          likes_count: previous.count,
        }));
      }
      toast.error("Không thể cập nhật lượt thích bình luận");
    },
    onSuccess: (result) => {
      // The API returns the authoritative counter.
      patchComment(queryClient, listKey, comment.id, (c) => ({
        ...c,
        is_liked: result.liked,
        likes_count: result.likes_count,
      }));
    },
  });

  const handleLike = () => {
    if (!requireAuth("Đăng nhập để thích bình luận")) return;
    likeMutation.mutate(!comment.is_liked);
  };

  return (
    <div className="flex gap-2.5">
      {/* Decorative: the name link in the bubble carries the accessible label. */}
      <Link href={ROUTES.profile(comment.author.username)} className="shrink-0" aria-hidden tabIndex={-1}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getAvatarUrl(comment.author.avatar_url, comment.author.username)}
          alt=""
          className={cn("rounded-full object-cover", isReply ? "h-7 w-7" : "h-8 w-8")}
        />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="inline-block max-w-full rounded-2xl bg-surface-muted px-3 py-2">
          <Link
            href={ROUTES.profile(comment.author.username)}
            className="text-sm font-semibold text-ink hover:underline"
          >
            {comment.author.display_name}
          </Link>
          <p className="whitespace-pre-wrap break-words text-sm text-ink">{comment.content}</p>
        </div>

        <div className="mt-1 flex items-center gap-4 px-2 text-xs text-ink-subtle">
          <span>{timeAgo(comment.created_at)}</span>

          <button
            type="button"
            onClick={handleLike}
            disabled={likeMutation.isPending}
            aria-pressed={comment.is_liked}
            aria-label={comment.is_liked ? "Bỏ thích bình luận" : "Thích bình luận"}
            className={cn(
              "flex items-center gap-1 font-medium transition-colors hover:text-red-500",
              comment.is_liked && "text-red-500"
            )}
          >
            <Heart className={cn("h-3.5 w-3.5", comment.is_liked && "fill-red-500")} />
            {comment.likes_count > 0 ? formatCount(comment.likes_count) : "Thích"}
          </button>

          {!isReply && onReply && (
            <button
              type="button"
              onClick={() => onReply(comment)}
              className="font-medium transition-colors hover:text-brand-500"
            >
              Trả lời
            </button>
          )}
        </div>

        {!isReply && onToggleReplies && (
          <CommentReplies parent={comment} expanded={repliesExpanded} onToggle={onToggleReplies} />
        )}
      </div>
    </div>
  );
}

interface CommentRepliesProps {
  parent: PostComment;
  expanded: boolean;
  onToggle: () => void;
}

/** "Xem X câu trả lời" toggle. Replies load the first time the list is opened, then stay cached. */
function CommentReplies({ parent, expanded, onToggle }: CommentRepliesProps) {
  const viewer = useViewerKey();
  const key = QUERY_KEYS.comments.replies(parent.id, viewer);

  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }) => getReplies(parent.id, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length + 1 : undefined),
    enabled: expanded,
    staleTime: 60_000,
  });

  const replies = flattenComments(query.data);
  if (parent.reply_count === 0 && replies.length === 0) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex items-center gap-1 px-2 text-xs font-semibold text-brand-600 transition-colors hover:text-brand-700"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
        {expanded ? "Ẩn câu trả lời" : `Xem ${parent.reply_count} câu trả lời`}
      </button>

      {expanded && (
        <div className="mt-2 space-y-3 border-l-2 border-border pl-3">
          {replies.map((reply) => (
            <CommentItem key={reply.id} comment={reply} listKey={key} isReply />
          ))}

          {query.isLoading && (
            <p className="flex items-center gap-2 text-xs text-ink-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang tải câu trả lời...
            </p>
          )}

          {query.isError && (
            <p className="text-xs text-red-500">
              Không tải được câu trả lời.{" "}
              <button type="button" onClick={() => void query.refetch()} className="font-semibold underline">
                Thử lại
              </button>
            </p>
          )}

          {query.hasNextPage && (
            <button
              type="button"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              className="text-xs font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-60"
            >
              {query.isFetchingNextPage ? "Đang tải..." : "Xem thêm câu trả lời"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}