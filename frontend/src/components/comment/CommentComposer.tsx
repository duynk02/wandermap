"use client";

import { MediaImage } from "@/components/ui/MediaImage";
import { useEffect, useRef, useState } from "react";
import { Loader2, Send, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { COMMENT_MAX_LENGTH } from "@/constants";
import { cn, getAvatarUrl } from "@/lib/utils";
import type { PostComment } from "@/types";
import { createCommentDraft } from "@/lib/comment-input";

interface CommentComposerProps {
  postId: string;
  /** The top-level comment being answered, or null for a new top-level comment. */
  replyTo: PostComment | null;
  onCancelReply: () => void;
  /** Must reject when sending fails so the text is kept for a retry. */
  onSubmit: (content: string, clientRequestId?: string) => Promise<void>;
  isSubmitting: boolean;
}

export function CommentComposer({ postId, replyTo, onCancelReply, onSubmit, isSubmitting }: CommentComposerProps) {
  const { isAuthenticated, profile, user } = useAuth();
  const requireAuth = useRequireAuth();
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draft = useRef(createCommentDraft());

  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !isSubmitting;

  // Start typing right away when "Trả lời" is pressed.
  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  const submit = async () => {
    if (!requireAuth("Đăng nhập để bình luận")) return;
    if (!canSend) return;
    const input = draft.current.prepare(`${user?.id}:${postId}:${replyTo?.id ?? "root"}`, {
      content: trimmed,
      ...(replyTo ? { parent_id: replyTo.id } : {}),
    });
    try {
      await onSubmit(trimmed, input.client_request_id);
      draft.current.succeeded(input.client_request_id);
      setValue((current) => current.trim() === trimmed ? "" : current);
    } catch {
      /* the caller shows the error; keep the text so the user can retry */
    }
  };

  return (
    <div className="flex gap-2.5">

      <MediaImage
        src={profile ? getAvatarUrl(profile.avatar_url, profile.username) : getAvatarUrl(null, "guest")}
        alt=""
        className="mt-0.5 h-8 w-8 shrink-0 rounded-full object-cover"
      />

      <div className="min-w-0 flex-1">
        {replyTo && (
          <div className="mb-1.5 flex items-center justify-between gap-2 rounded-lg bg-surface-muted px-3 py-1.5 text-xs text-ink-muted">
            <span className="min-w-0 truncate">
              Đang trả lời <strong className="font-semibold text-ink">{replyTo.author.display_name}</strong>
            </span>
            <button
              type="button"
              onClick={onCancelReply}
              aria-label="Hủy trả lời"
              className="shrink-0 rounded-full p-0.5 hover:bg-border hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface-muted px-3 py-2 focus-within:border-brand-500">
          <textarea
            ref={textareaRef}
            value={value}
            rows={2}
            maxLength={COMMENT_MAX_LENGTH}
            // Guests can see the box but are asked to sign in as soon as they try to use it.
            readOnly={!isAuthenticated}
            onFocus={() => {
              if (!isAuthenticated) requireAuth("Đăng nhập để bình luận");
            }}
            onChange={(event) => { draft.current.changed(); setValue(event.target.value); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submit();
              }
            }}
            aria-label={replyTo ? `Trả lời ${replyTo.author.display_name}` : "Viết bình luận"}
            placeholder={replyTo ? "Viết câu trả lời..." : "Viết bình luận..."}
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={isAuthenticated && !canSend}
            aria-label="Gửi bình luận"
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>

        {value.length >= COMMENT_MAX_LENGTH * 0.8 && (
          <p className={cn("mt-1 text-right text-xs", value.length >= COMMENT_MAX_LENGTH ? "text-red-500" : "text-ink-subtle")}>
            {value.length}/{COMMENT_MAX_LENGTH}
          </p>
        )}
      </div>
    </div>
  );
}
