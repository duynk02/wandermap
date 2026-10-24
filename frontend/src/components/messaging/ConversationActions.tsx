"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserMinus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { QUERY_KEYS, ROUTES } from "@/constants";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useRelationshipRefresh } from "@/hooks/useRelationshipRefresh";
import { ApiError, getAuthSessionVersion } from "@/lib/api/client";
import { getProfileByUsername, unfollowUser } from "@/lib/api/users";
import { useAuthStore } from "@/stores/authStore";
import { useFollowStore } from "@/stores/followStore";
import type { Profile } from "@/types";
import type { Conversation } from "@/types/messaging";

const itemClass =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export function ConversationActions({
  viewer,
  conversation,
}: {
  viewer: string;
  conversation: Conversation;
}) {
  const { recipient } = conversation;
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const openingConfirmation = useRef(false);
  const client = useQueryClient();
  const refreshRelationships = useRelationshipRefresh();
  const profileKey = [
    ...QUERY_KEYS.profiles.byUsername(recipient.username),
    "viewer",
    viewer,
  ];
  const profile = useQuery({
    queryKey: profileKey,
    queryFn: async () => {
      const version = getAuthSessionVersion();
      const current = () =>
        useAuthStore.getState().user?.id === viewer &&
        getAuthSessionVersion() === version;
      if (!current())
        throw new ApiError(
          401,
          "AUTH_SESSION_CHANGED",
          "Phiên đăng nhập đã thay đổi.",
        );
      const result = await getProfileByUsername(recipient.username);
      if (!current())
        throw new ApiError(
          401,
          "AUTH_SESSION_CHANGED",
          "Phiên đăng nhập đã thay đổi.",
        );
      if (result && result.id !== recipient.id)
        throw new ApiError(
          404,
          "RECIPIENT_CHANGED",
          "Thông tin người nhận đã thay đổi. Hãy tải lại cuộc trò chuyện.",
        );
      return result;
    },
    enabled: (open || confirmOpen) && recipient.is_active,
    staleTime: 0,
    retry: false,
  });
  const following =
    profile.data?.id === recipient.id && profile.data.is_following === true;
  const unfollow = useMutation({
    onMutate: () => ({ owner: viewer, session: getAuthSessionVersion() }),
    mutationFn: () => {
      if (useAuthStore.getState().user?.id !== viewer)
        throw new ApiError(
          401,
          "AUTH_SESSION_CHANGED",
          "Phiên đăng nhập đã thay đổi.",
        );
      if (!following || profile.isFetching || profile.isError)
        throw new ApiError(
          400,
          "FOLLOW_STATE_CHANGED",
          "Hãy tải lại trạng thái theo dõi trước khi tiếp tục.",
        );
      return unfollowUser(recipient.username);
    },
    onSuccess: (_result, _input, context) => {
      if (
        useAuthStore.getState().user?.id !== context.owner ||
        getAuthSessionVersion() !== context.session
      )
        return;
      useFollowStore
        .getState()
        .setFollowing(`${viewer}:${recipient.id}`, false);
      client.setQueryData<Profile | null>(profileKey, (value) =>
        value
          ? {
              ...value,
              is_following: false,
              is_mutual: false,
              can_message: false,
            }
          : value,
      );
      client.setQueryData<Conversation>(
        QUERY_KEYS.messaging.conversation(viewer, conversation.id),
        (value) =>
          value ? { ...value, is_mutual: false, can_send: false } : value,
      );
      setConfirmOpen(false);
      void refreshRelationships();
      trigger.current?.focus();
      toast.success(`Đã hủy theo dõi ${recipient.display_name}`);
    },
    onError: (error, _input, context) => {
      if (
        useAuthStore.getState().user?.id !== context?.owner ||
        getAuthSessionVersion() !== context?.session
      )
        return;
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Chưa thể hủy theo dõi. Hãy thử lại.",
      );
    },
  });
  return (
    <>
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger asChild>
          <button
            ref={trigger}
            type="button"
            aria-label="Tùy chọn cuộc trò chuyện"
            title="Tùy chọn cuộc trò chuyện"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <UserRound className="h-5 w-5" aria-hidden />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            collisionPadding={12}
            onCloseAutoFocus={(event) => {
              if (openingConfirmation.current) {
                event.preventDefault();
                openingConfirmation.current = false;
              }
            }}
            className="z-50 min-w-52 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-1.5 text-ink shadow-xl"
          >
            <DropdownMenu.Item asChild className={itemClass}>
              <Link href={ROUTES.profile(recipient.username)}>
                <UserRound className="h-4 w-4" aria-hidden />
                Mở hồ sơ
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              disabled={
                !following ||
                profile.isFetching ||
                profile.isError ||
                !recipient.is_active ||
                unfollow.isPending
              }
              onSelect={() => {
                unfollow.reset();
                openingConfirmation.current = true;
                setConfirmOpen(true);
              }}
              className={`${itemClass} text-red-600 dark:text-red-400`}
            >
              {profile.isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <UserMinus className="h-4 w-4" aria-hidden />
              )}
              Hủy theo dõi
            </DropdownMenu.Item>
            {profile.isError ? (
              <p
                role="alert"
                className="max-w-64 px-3 py-2 text-xs text-ink-muted"
              >
                Chưa tải được trạng thái theo dõi.{" "}
                <button
                  type="button"
                  onClick={() => void profile.refetch()}
                  className="underline"
                >
                  Thử lại
                </button>
              </p>
            ) : (
              profile.isSuccess &&
              !following && (
                <p className="px-3 py-2 text-xs text-ink-muted">
                  Bạn hiện không theo dõi người này.
                </p>
              )
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ConfirmDialog
        open={confirmOpen}
        title={`Hủy theo dõi ${recipient.display_name}?`}
        confirmLabel="Hủy theo dõi"
        cancelLabel="Quay lại"
        pending={unfollow.isPending}
        onConfirm={() => unfollow.mutate()}
        onCancel={() => {
          setConfirmOpen(false);
          trigger.current?.focus();
        }}
      />
    </>
  );
}
