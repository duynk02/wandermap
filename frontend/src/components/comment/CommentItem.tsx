"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Heart, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, deleteComment, getReplies, setCommentLiked, updateComment } from "@/lib/api";
import { useRequireAuth, useViewerKey } from "@/hooks/useRequireAuth";
import { COMMENT_MAX_LENGTH, QUERY_KEYS, ROUTES } from "@/constants";
import { cn, formatCount, getAvatarUrl, timeAgo } from "@/lib/utils";
import type { DeleteCommentResult, PostComment } from "@/types";
import { flattenComments, patchComment } from "./comment-cache";
import { CommentComposer } from "./CommentComposer";

function actionError(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    if (error.status === 403) return "Bạn không có quyền thực hiện thao tác này.";
    if (error.status === 404) return "Bình luận không còn tồn tại.";
    if (error.status === 400) return error.message;
  }
  return fallback;
}

const menuItemClass =
  "flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-muted";

function CommentEditor({
  initial,
  isSaving,
  onSave,
  onCancel,
}: {
  initial: string;
  isSaving: boolean;
  onSave: (content: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && trimmed !== initial.trim() && !isSaving;

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  return (
    <div>
      <textarea
        ref={ref}
        value={value}
        rows={2}
        maxLength={COMMENT_MAX_LENGTH}
        aria-label="Chỉnh sửa bình luận"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && canSave) {
            event.preventDefault();
            onSave(trimmed);
          }
        }}
        className="w-full resize-none rounded-2xl border border-border bg-surface-muted px-3 py-2 text-sm text-ink outline-none focus:border-brand-500"
      />
      <div className="mt-1.5 flex items-center gap-2 px-1">
        <button
          type="button"
          onClick={() => onSave(trimmed)}
          disabled={!canSave}
          className="flex items-center gap-1.5 rounded-full bg-brand-500 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSaving && <Loader2 className="h-3 w-3 animate-spin" />} Lưu
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="rounded-full px-3 py-1 text-xs font-semibold text-ink-muted transition-colors hover:bg-surface-muted"
        >
          Hủy
        </button>
      </div>
    </div>
  );
}

interface CommentItemProps {
  comment: PostComment;
  /** Query key of the list this comment is rendered from (used for optimistic updates). */
  listKey: QueryKey;
  /** Signed-in user, if any. Decides who sees the edit / delete menu. */
  viewerId?: string;
  /** The post's author may delete any comment on their post. */
  postAuthorId: string;
  onDeleted: (comment: PostComment, result: DeleteCommentResult) => void;
  /** Replies cannot be replied to: the reply action only exists on top-level comments. */
  isReply?: boolean;
  onReply?: (comment: PostComment) => void;
  /** True while the reply box under this comment is open. */
  isReplying?: boolean;
  onCancelReply?: () => void;
  onSendReply?: (content: string) => Promise<void>;
  isSendingReply?: boolean;
  repliesExpanded?: boolean;
  onToggleReplies?: () => void;
}

export function CommentItem({
  comment,
  listKey,
  viewerId,
  postAuthorId,
  onDeleted,
  isReply = false,
  onReply,
  isReplying = false,
  onCancelReply,
  onSendReply,
  isSendingReply = false,
  repliesExpanded = false,
  onToggleReplies,
}: CommentItemProps) {
  const queryClient = useQueryClient();
  const requireAuth = useRequireAuth();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isOwner = !!viewerId && viewerId === comment.author.id;
  const canEdit = isOwner;
  const canDelete = isOwner || (!!viewerId && viewerId === postAuthorId);

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

  const editMutation = useMutation({
    mutationFn: (content: string) => updateComment(comment.id, content),
    onSuccess: (updated) => {
      patchComment(queryClient, listKey, comment.id, () => updated);
      setEditing(false);
    },
    onError: (error) => toast.error(actionError(error, "Không thể lưu chỉnh sửa. Vui lòng thử lại.")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteComment(comment.id),
    onSuccess: (result) => onDeleted(comment, result), // the parent removes this row from the cache
    onError: (error) => {
      setConfirmingDelete(false);
      toast.error(actionError(error, "Không thể xóa bình luận. Vui lòng thử lại."));
    },
  });

  const handleLike = () => {
    if (!requireAuth("Đăng nhập để thích bình luận")) return;
    likeMutation.mutate(!comment.is_liked);
  };

  const deletePrompt = isReply
    ? "Xóa câu trả lời này?"
    : comment.reply_count > 0
      ? `Xóa bình luận này và ${comment.reply_count} câu trả lời của nó?`
      : "Xóa bình luận này?";

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
        {editing ? (
          <CommentEditor
            initial={comment.content}
            isSaving={editMutation.isPending}
            onSave={(content) => editMutation.mutate(content)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="flex items-start gap-1">
            <div className="min-w-0 rounded-2xl bg-surface-muted px-3 py-2">
              <Link
                href={ROUTES.profile(comment.author.username)}
                className="text-sm font-semibold text-ink hover:underline"
              >
                {comment.author.display_name}
              </Link>
              <p className="whitespace-pre-wrap break-words text-sm text-ink">{comment.content}</p>
            </div>

            {(canEdit || canDelete) && (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    aria-label="Tùy chọn bình luận"
                    className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={4}
                    className="z-50 min-w-[170px] rounded-xl border border-border bg-surface-elevated p-1 shadow-xl"
                  >
                    {canEdit && (
                      <DropdownMenu.Item className={cn(menuItemClass, "text-ink")} onSelect={() => setEditing(true)}>
                        <Pencil className="h-4 w-4" /> Chỉnh sửa
                      </DropdownMenu.Item>
                    )}
                    {canDelete && (
                      <DropdownMenu.Item
                        className={cn(menuItemClass, "text-red-600")}
                        onSelect={() => setConfirmingDelete(true)}
                      >
                        <Trash2 className="h-4 w-4" /> Xóa
                      </DropdownMenu.Item>
                    )}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            )}
          </div>
        )}

        {!editing && (
          <div className="mt-1 flex items-center gap-4 px-2 text-xs text-ink-subtle">
            <span>
              {timeAgo(comment.created_at)}
              {comment.edited_at && " · Đã chỉnh sửa"}
            </span>

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
        )}

        {confirmingDelete && (
          <div role="group" aria-label="Xác nhận xóa" className="mt-2 rounded-xl border border-border bg-surface-elevated px-3 py-2">
            <p className="text-xs text-ink-muted">{deletePrompt}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-1.5 rounded-full bg-red-500 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-60"
              >
                {deleteMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />} Xóa
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleteMutation.isPending}
                className="rounded-full px-3 py-1 text-xs font-semibold text-ink-muted transition-colors hover:bg-surface-muted"
              >
                Hủy
              </button>
            </div>
          </div>
        )}

        {/* The reply box opens right under the comment being answered, not in the shared box at the top. */}
        {!isReply && isReplying && onSendReply && (
          <div className="mt-2">
            <CommentComposer
              replyTo={comment}
              onCancelReply={() => onCancelReply?.()}
              onSubmit={onSendReply}
              isSubmitting={isSendingReply}
            />
          </div>
        )}

        {!isReply && onToggleReplies && (
          <CommentReplies
            parent={comment}
            expanded={repliesExpanded}
            onToggle={onToggleReplies}
            viewerId={viewerId}
            postAuthorId={postAuthorId}
            onDeleted={onDeleted}
          />
        )}
      </div>
    </div>
  );
}

interface CommentRepliesProps {
  parent: PostComment;
  expanded: boolean;
  onToggle: () => void;
  viewerId?: string;
  postAuthorId: string;
  onDeleted: (comment: PostComment, result: DeleteCommentResult) => void;
}

/** "Xem X câu trả lời" toggle. Replies load the first time the list is opened, then stay cached. */
function CommentReplies({ parent, expanded, onToggle, viewerId, postAuthorId, onDeleted }: CommentRepliesProps) {
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
            <CommentItem
              key={reply.id}
              comment={reply}
              listKey={key}
              viewerId={viewerId}
              postAuthorId={postAuthorId}
              onDeleted={onDeleted}
              isReply
            />
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