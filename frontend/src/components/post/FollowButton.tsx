"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, followUser, unfollowUser } from "@/lib/api";
import { ConfirmDialog } from "@components/ui/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useFollowStore } from "@/stores/followStore";
import { cn } from "@/lib/utils";

/**
 * Single source of truth for "does the signed-in user follow this author?".
 *  - `initiallyFollowing` is the API's answer (post.author.is_following) when the feed loaded.
 *  - a follow/unfollow made in this session (store) overrides it, so every post by the same
 *    author updates at once.
 * `hidden` is true for your own posts and while the session is still being restored.
 */
function useFollowState(authorId: string, initiallyFollowing?: boolean) {
  const { user, isLoading } = useAuth();
  const key = user ? `${user.id}:${authorId}` : null;
  const override = useFollowStore((state) => (key ? state.overrides[key] : undefined));

  return {
    key,
    hidden: isLoading || user?.id === authorId,
    followed: !!user && (override ?? !!initiallyFollowing),
  };
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback;

interface FollowProps {
  authorId: string;
  username: string;
  displayName: string;
  /** post.author.is_following from the API. */
  initiallyFollowing?: boolean;
}

/** "Theo dõi" next to the author's name. Shown only for authors you do not follow. */
export function FollowButton({
  authorId,
  username,
  displayName,
  initiallyFollowing,
  className,
}: FollowProps & { className?: string }) {
  const requireAuth = useRequireAuth();
  const setFollowing = useFollowStore((state) => state.setFollowing);
  const { key, hidden, followed } = useFollowState(authorId, initiallyFollowing);

  const mutation = useMutation({
    mutationFn: () => followUser(username),
    onSuccess: (result) => {
      if (key) setFollowing(key, true);
      // changed === false: already following (the API is idempotent). Only the label syncs.
      if (result.changed) toast.success(`Đã theo dõi ${displayName}`);
    },
    onError: (error) => toast.error(errorMessage(error, "Không thể theo dõi lúc này")),
  });

  if (hidden || followed) return null;

  return (
    <button
      type="button"
      onClick={() => {
        if (!requireAuth("Đăng nhập để theo dõi")) return;
        mutation.mutate();
      }}
      disabled={mutation.isPending}
      className={cn(
        "shrink-0 text-xs font-semibold text-brand-500 transition-colors hover:text-brand-600 disabled:opacity-60",
        className
      )}
    >
      {mutation.isPending ? "Đang xử lý…" : "Theo dõi"}
    </button>
  );
}

/**
 * Black check badge on the avatar of followed authors. Clicking it asks for confirmation, then
 * unfollows. Render inside a `relative` wrapper around the avatar, as a sibling of its link
 * (a click here must never navigate).
 */
export function FollowedBadge({ authorId, username, displayName, initiallyFollowing }: FollowProps) {
  const setFollowing = useFollowStore((state) => state.setFollowing);
  const { key, hidden, followed } = useFollowState(authorId, initiallyFollowing);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => unfollowUser(username),
    onSuccess: () => {
      // The badge unmounts once the state flips, which also closes the dialog.
      if (key) setFollowing(key, false);
      setConfirmOpen(false);
      toast.success(`Đã hủy theo dõi ${displayName}`);
    },
    // Keep the dialog open so the user can retry.
    onError: (error) => toast.error(errorMessage(error, "Không thể hủy theo dõi lúc này")),
  });

  if (hidden || !followed) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        title="Đang theo dõi"
        aria-label={`Đang theo dõi ${displayName}. Bấm để hủy theo dõi`}
        className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-black text-white ring-2 ring-surface-elevated transition-transform before:absolute before:-inset-1.5 before:content-[''] hover:scale-110"
      >
        <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
      </button>

      <ConfirmDialog
        open={confirmOpen}
        title={`Xác nhận hủy theo dõi người dùng '${displayName}'`}
        pending={mutation.isPending}
        onConfirm={() => mutation.mutate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}