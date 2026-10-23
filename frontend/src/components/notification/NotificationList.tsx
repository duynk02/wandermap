"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart, Loader2, MessageCircle, UserPlus } from "lucide-react";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { QUERY_KEYS, ROUTES } from "@/constants";
import { cn, getAvatarUrl, timeAgo } from "@/lib/utils";
import type { NotificationItem } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { useRealtimeStore } from "@/stores/realtimeStore";
import { refreshNotificationQueries } from "@/lib/realtime/notifications";
import { NotificationMessage } from "./NotificationMessage";

const TYPE_ICON = {
  like: { Icon: Heart, className: "bg-red-500" },
  comment: { Icon: MessageCircle, className: "bg-brand-500" },
  comment_like: { Icon: Heart, className: "bg-red-500" },
  reply: { Icon: MessageCircle, className: "bg-brand-500" },
  follow: { Icon: UserPlus, className: "bg-blue-500" },
} as const;

function NotificationRow({ item, onNavigate, onRead }: { item: NotificationItem; onNavigate?: () => void; onRead: () => void }) {
  const actor = item.actors[0];
  const href = item.type === "follow" && actor ? ROUTES.profile(actor.username) : item.post ? ROUTES.post(item.post.id) : ROUTES.feed;
  const { Icon, className } = TYPE_ICON[item.type];

  return (
    <li>
      <Link
        href={href}
        onClick={() => { if (item.is_unread) onRead(); onNavigate?.(); }}
        className={cn(
          "flex items-center gap-3 border-l-4 px-4 py-3 transition-colors hover:bg-surface-muted",
          item.is_unread ? "border-brand-500 bg-surface-muted" : "border-transparent"
        )}
      >
        <span className="relative shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getAvatarUrl(actor?.avatar_url ?? null, actor?.username ?? "user")}
            alt=""
            className="h-11 w-11 rounded-full object-cover"
          />
          <span className={cn("absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-white ring-2 ring-surface-elevated", className)}>
            <Icon className="h-3 w-3" />
          </span>
        </span>

        <span className="min-w-0 flex-1 text-sm text-ink-muted">
          <NotificationMessage item={item} />
          {item.type !== "follow" && item.post?.excerpt && (
            <span className="mt-0.5 block truncate text-xs text-ink-subtle">“{item.post.excerpt}”</span>
          )}
          <span className="mt-0.5 block text-xs text-ink-subtle">{timeAgo(item.created_at)}</span>
        </span>

        {item.post?.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.post.image} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
        )}
      </Link>
    </li>
  );
}

interface NotificationListProps {
  /** "page": the /notifications page. "popover": inside the bell popover (compact, no redirect). */
  variant?: "page" | "popover";
  /** Called when a row is clicked (the popover closes itself). */
  onNavigate?: () => void;
}

export function NotificationList({ variant = "page", onNavigate }: NotificationListProps) {
  const isPopover = variant === "popover";
  const pad = isPopover ? "py-10" : "py-20";
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const viewer = user?.id ?? "guest";
  const realtimeHealthy = useRealtimeStore((state) => state.connected && state.notificationsAvailable && state.userId === user?.id);

  // The access token only exists in the browser, so guests are sent to login from here.
  useEffect(() => {
    if (!isPopover && !authLoading && !isAuthenticated) {
      router.replace(`${ROUTES.login}?next=${encodeURIComponent(ROUTES.notifications)}`);
    }
  }, [isPopover, authLoading, isAuthenticated, router]);

  const query = useInfiniteQuery({
    queryKey: QUERY_KEYS.notifications.list(viewer),
    queryFn: ({ pageParam, signal }) => getNotifications(pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length + 1 : undefined),
    enabled: isAuthenticated,
    refetchInterval: realtimeHealthy ? false : 30_000,
    refetchOnWindowFocus: false, // Owned by the throttled realtime visibility observer.
  });

  const items = (query.data?.pages ?? []).flatMap((page) => page.data).filter(
    (item, index, all) => all.findIndex((other) => other.id === item.id) === index
  );

  const refreshViewer = (owner: string) => {
    void refreshNotificationQueries(queryClient, [
      QUERY_KEYS.notifications.list(owner),
      QUERY_KEYS.notifications.unreadCount(owner),
    ], () => useAuthStore.getState().user?.id === owner);
  };
  const readAll = useMutation({
    mutationFn: (owner: string) => {
      if (useAuthStore.getState().user?.id !== owner) throw new Error("Phiên đăng nhập đã thay đổi.");
      return markAllNotificationsRead();
    },
    onSuccess: (_result, owner) => refreshViewer(owner),
  });
  const readGroup = useMutation({
    mutationFn: ({ groupId, owner }: { groupId: string; owner: string }) => {
      if (useAuthStore.getState().user?.id !== owner) throw new Error("Phiên đăng nhập đã thay đổi.");
      return markNotificationRead(groupId);
    },
    onSuccess: (_result, { owner }) => refreshViewer(owner),
  });

  if (authLoading || !isAuthenticated || query.isLoading) {
    return (
      <div className={cn("flex justify-center", pad)}>
        <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className={cn("px-4 text-center text-ink-muted", pad)}>
        <p className="font-medium">Không tải được thông báo</p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="mt-3 rounded-2xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
        >
          Thử lại
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={cn("px-4 text-center text-ink-muted", pad)}>
        <p className="mb-3 text-4xl">🔔</p>
        <p className="font-medium">Chưa có thông báo nào</p>
        <p className="mt-1 text-sm">Khi ai đó thích, bình luận hoặc theo dõi bạn, bạn sẽ thấy ở đây.</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex justify-end border-b border-border px-4 py-2">
        <button
          type="button"
          onClick={() => readAll.mutate(viewer)}
          disabled={readAll.isPending}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-surface-muted disabled:opacity-50"
        >
          {readAll.isPending ? "Đang cập nhật..." : "Đánh dấu tất cả đã đọc"}
        </button>
      </div>
      {(readAll.isError || readGroup.isError) && (
        <p role="alert" className="px-4 py-2 text-xs text-red-500">Không thể đánh dấu đã đọc. Vui lòng thử lại.</p>
      )}
      <ul className={cn("divide-y divide-border", !isPopover && "overflow-hidden rounded-2xl bg-surface-elevated shadow-sm")}>
        {items.map((item) => (
          <NotificationRow key={item.id} item={item} onNavigate={onNavigate} onRead={() => readGroup.mutate({ groupId: item.id, owner: viewer })} />
        ))}
      </ul>

      {query.hasNextPage && (
        <button
          type="button"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className={cn("w-full py-3 text-sm font-semibold text-brand-600 transition-colors hover:bg-surface-muted disabled:opacity-60", isPopover ? "" : "mt-4 rounded-2xl")}
        >
          {query.isFetchingNextPage ? "Đang tải..." : "Xem thêm thông báo"}
        </button>
      )}
    </>
  );
}
