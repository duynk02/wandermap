"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/constants";
import { useAuth } from "@/hooks/useAuth";
import { useMessagingContacts } from "@/hooks/useMessagingContacts";
import { useRelationshipRefresh } from "@/hooks/useRelationshipRefresh";
import { ApiError, getAuthSessionVersion } from "@/lib/api/client";
import { followUser } from "@/lib/api/users";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { useFollowStore } from "@/stores/followStore";
import type { MessagingContact } from "@/types/messaging";
import { MessagingAvatar } from "./MessagingPrimitives";

export function FollowerContacts({
  viewer,
  search,
}: {
  viewer: string;
  search: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const panelId = useId();
  const list = useMessagingContacts(viewer, search, {
    kind: "followers",
    enabled: expanded,
  });
  const contacts = [
    ...new Map(
      list.data?.pages
        .flatMap((page) => page.data)
        .map((row) => [row.id, row]) ?? [],
    ).values(),
  ];
  return (
    <section
      aria-label="Người theo dõi bạn"
      className="mt-4 border-t border-border pt-2"
    >
      <h2>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-3 text-left text-xs font-semibold text-ink-muted hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Người theo dõi
          <ChevronDown
            aria-hidden
            className={cn(
              "h-4 w-4 transition-transform",
              !expanded && "-rotate-90",
            )}
          />
          <span className="sr-only">
            {expanded ? "Thu gọn danh sách" : "Mở rộng danh sách"}
          </span>
        </button>
      </h2>
      <div id={panelId} hidden={!expanded}>
        <p className="px-3 pb-2 text-[11px] text-ink-muted">
          Theo dõi lại để kết bạn và nhắn tin.
        </p>
        {list.isPending ? (
          <p
            role="status"
            className="flex items-center gap-2 p-3 text-sm text-ink-muted"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tải người theo dõi…
          </p>
        ) : list.isError ? (
          <p role="alert" className="p-3 text-sm text-ink-muted">
            Chưa tải được người theo dõi.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => void list.refetch()}
            >
              Thử lại
            </button>
          </p>
        ) : !contacts.length ? (
          <p role="status" className="p-3 text-xs text-ink-muted">
            {search.trim()
              ? "Không tìm thấy người theo dõi phù hợp."
              : "Không có người theo dõi nào đang chờ bạn theo dõi lại."}
          </p>
        ) : (
          <ul className="space-y-1">
            {contacts.map((contact) => (
              <FollowBackRow
                key={contact.id}
                contact={contact}
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
            className="w-full rounded-xl py-3 text-sm font-medium text-brand-600 disabled:opacity-50"
          >
            {list.isFetchingNextPage ? "Đang tải…" : "Xem thêm người theo dõi"}
          </button>
        )}
      </div>
    </section>
  );
}

function FollowBackRow({
  contact,
  refreshing,
}: {
  contact: MessagingContact;
  refreshing: boolean;
}) {
  const { user } = useAuth();
  const refresh = useRelationshipRefresh();
  const follow = useMutation({
    onMutate: () => ({ owner: user?.id, session: getAuthSessionVersion() }),
    mutationFn: () => {
      if (!user || useAuthStore.getState().user?.id !== user.id)
        throw new ApiError(
          401,
          "AUTH_SESSION_CHANGED",
          "Phiên đăng nhập đã thay đổi.",
        );
      return followUser(contact.username);
    },
    onSuccess: async (_result, _input, context) => {
      const current = () =>
        !!context.owner &&
        useAuthStore.getState().user?.id === context.owner &&
        getAuthSessionVersion() === context.session;
      if (!current()) return;
      useFollowStore
        .getState()
        .setFollowing(`${context.owner}:${contact.id}`, true);
      // Refetch both filtered lists from REST before leaving the pending state.
      await refresh();
      if (current()) toast.success(`Đã theo dõi lại ${contact.display_name}`);
    },
  });
  return (
    <li className="rounded-xl px-3 py-3">
      <div className="flex items-center gap-2">
        <Link
          href={ROUTES.profile(contact.username)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MessagingAvatar profile={contact} className="h-9 w-9" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">
              {contact.display_name}
            </span>
            <span className="block truncate text-xs text-ink-muted">
              @{contact.username}
            </span>
          </span>
        </Link>
        <button
          type="button"
          aria-label={`Theo dõi lại ${contact.display_name}`}
          disabled={follow.isPending || refreshing}
          onClick={() => follow.mutate()}
          className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:bg-brand-950 dark:text-brand-300"
        >
          {follow.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
          )}
          {follow.isPending ? "Đang xử lý…" : "Theo dõi lại"}
        </button>
      </div>
      {follow.isError && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {follow.error.message || "Chưa thể theo dõi lại. Hãy thử lại."}
        </p>
      )}
    </li>
  );
}
