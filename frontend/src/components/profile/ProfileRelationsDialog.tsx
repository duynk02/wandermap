"use client";

import Link from "next/link";
import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Loader2, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { QUERY_KEYS, ROUTES } from "@/constants";
import { useAuth } from "@/hooks/useAuth";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useRelationshipRefresh } from "@/hooks/useRelationshipRefresh";
import { ApiError, getAuthSessionVersion } from "@/lib/api/client";
import { followUser, getUserRelations } from "@/lib/api/users";
import { useAuthStore } from "@/stores/authStore";
import { useFollowStore } from "@/stores/followStore";
import type { UserRelation } from "@/types";
import { MessageUserButton } from "@/components/messaging/MessageUserButton";
import {
  MessagingAvatar,
  messagingButtonClass,
} from "@/components/messaging/MessagingPrimitives";

export function ProfileRelationsDialog({
  username,
  relation,
  onClose,
}: {
  username: string;
  relation: "followers" | "following";
  onClose: () => void;
}) {
  const { user, isLoading } = useAuth();
  const opener = useRef(
    typeof document === "undefined" ? null : document.activeElement,
  );
  const list = useInfiniteQuery({
    queryKey: QUERY_KEYS.profiles.relations(
      username,
      relation,
      user?.id ?? "guest",
    ),
    queryFn: async ({ pageParam, signal }) => {
      const version = getAuthSessionVersion();
      const current = () =>
        (useAuthStore.getState().user?.id ?? null) === (user?.id ?? null) &&
        getAuthSessionVersion() === version;
      if (!current())
        throw new ApiError(
          401,
          "AUTH_SESSION_CHANGED",
          "Phiên đăng nhập đã thay đổi.",
        );
      const result = await getUserRelations(
        username,
        relation,
        pageParam,
        signal,
      );
      if (!current())
        throw new ApiError(
          401,
          "AUTH_SESSION_CHANGED",
          "Phiên đăng nhập đã thay đổi.",
        );
      return result;
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: !isLoading,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
  });
  const rows = [
    ...new Map(
      list.data?.pages
        .flatMap((page) => page.data)
        .map((row) => [row.id, row]) ?? [],
    ).values(),
  ];
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (
              opener.current instanceof HTMLElement &&
              opener.current.isConnected
            )
              opener.current.focus();
          }}
          className="fixed left-1/2 top-1/2 z-[61] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-surface text-ink shadow-xl"
        >
          <header className="border-b border-border p-5 pr-14">
            <Dialog.Title className="text-lg font-bold">
              {relation === "followers" ? "Người theo dõi" : "Đang theo dõi"}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-xs text-ink-muted">
              @{username} · Chỉ bạn bè mới có thể nhắn tin. Theo dõi nhau để kết bạn.
            </Dialog.Description>
            <Dialog.Close
              aria-label="Đóng danh sách"
              className="absolute right-4 top-4 rounded-full p-2 hover:bg-surface-muted"
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
          </header>
          <div className="min-h-0 overflow-y-auto overscroll-contain p-3">
            {isLoading || list.isPending ? (
              <p
                role="status"
                className="flex items-center justify-center gap-2 p-8 text-sm text-ink-muted"
              >
                <Loader2 className="h-5 w-5 animate-spin" />
                Đang tải danh sách…
              </p>
            ) : list.isError ? (
              <p role="alert" className="p-5 text-sm text-ink-muted">
                Chưa tải được danh sách.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => void list.refetch()}
                >
                  Thử lại
                </button>
              </p>
            ) : !rows.length ? (
              <p
                role="status"
                className="p-8 text-center text-sm text-ink-muted"
              >
                {relation === "followers"
                  ? "Chưa có người theo dõi."
                  : "Chưa theo dõi người nào."}
              </p>
            ) : (
              <ul className="space-y-1">
                {rows.map((row) => (
                  <RelationRow
                    key={`${user?.id ?? "guest"}:${row.id}`}
                    row={row}
                    refreshing={list.isFetching}
                  />
                ))}
              </ul>
            )}
            {list.hasNextPage && (
              <button
                type="button"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
                className="mt-2 w-full rounded-xl py-3 text-sm font-semibold text-brand-600 disabled:opacity-50"
              >
                {list.isFetchingNextPage ? "Đang tải…" : "Tải thêm"}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RelationRow({
  row,
  refreshing,
}: {
  row: UserRelation;
  refreshing: boolean;
}) {
  const { user } = useAuth();
  const requireAuth = useRequireAuth();
  const refresh = useRelationshipRefresh();
  const router = useRouter();
  const follow = useMutation({
    onMutate: () => ({ owner: user?.id, session: getAuthSessionVersion() }),
    mutationFn: () => followUser(row.username),
    onSuccess: (_result, _input, context) => {
      if (
        !context.owner ||
        useAuthStore.getState().user?.id !== context.owner ||
        getAuthSessionVersion() !== context.session
      )
        return;
      useFollowStore
        .getState()
        .setFollowing(`${context.owner}:${row.id}`, true);
      refresh();
      router.refresh();
    },
    onError: (error) =>
      toast.error(error.message || "Chưa thể theo dõi lại. Hãy thử lại."),
  });
  return (
    <li className="flex items-center gap-3 rounded-xl p-3">
      <Link
        href={ROUTES.profile(row.username)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MessagingAvatar profile={row} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">
            {row.display_name}
          </span>
          <span className="block truncate text-xs text-ink-muted">
            @{row.username}
          </span>
        </span>
      </Link>
      {row.id === user?.id ? (
        <span className="text-xs text-ink-muted">Bạn</span>
      ) : row.can_message && user ? (
        <MessageUserButton recipientId={row.id} name={row.display_name} />
      ) : !row.is_following ? (
        <button
          type="button"
          disabled={follow.isPending || refreshing}
          onClick={() => {
            if (requireAuth("Đăng nhập để theo dõi lại")) follow.mutate();
          }}
          className={messagingButtonClass}
        >
          <UserPlus className="h-4 w-4" aria-hidden />
          {follow.isPending
            ? "Đang xử lý…"
            : row.follows_you
              ? "Theo dõi lại"
              : "Theo dõi"}
        </button>
      ) : (
        <span className="max-w-28 text-right text-xs text-ink-muted">
          {row.is_mutual
            ? "Hiện không thể nhắn tin"
            : "Chờ theo dõi lại để nhắn tin"}
        </span>
      )}
    </li>
  );
}
