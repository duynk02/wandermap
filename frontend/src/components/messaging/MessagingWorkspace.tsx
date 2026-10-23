"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MessageCircle, Plus, Search, WifiOff, X } from "lucide-react";
import { MainHeader } from "@/components/layout/MainHeader";
import { QUERY_KEYS, ROUTES } from "@/constants";
import { useAuth } from "@/hooks/useAuth";
import { useConversations } from "@/hooks/useMessaging";
import { useStartConversation } from "@/hooks/useMessagingNavigation";
import { getAuthSessionVersion } from "@/lib/api/client";
import { getProfileByUsername } from "@/lib/api/users";
import {
  conversationPreview,
  matchesConversation,
} from "@/lib/messaging/model";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { useRealtimeStore } from "@/stores/realtimeStore";
import { ChatPanel } from "./ChatPanel";
import {
  MessagingAvatar,
  MessagingEmpty,
  messagingButtonClass,
} from "./MessagingPrimitives";

export function MessagingWorkspace({
  conversationId,
}: {
  conversationId?: string;
}) {
  const { user, isLoading } = useAuth();
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const visual = window.visualViewport;
    const resize = () => {
      if (!viewport.current) return;
      viewport.current.style.height = visual ? `${visual.height}px` : "100dvh";
      viewport.current.style.top = visual ? `${visual.offsetTop}px` : "0px";
    };
    resize();
    visual?.addEventListener("resize", resize);
    visual?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      visual?.removeEventListener("resize", resize);
      visual?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
      document.body.style.overflow = overflow;
    };
  }, []);
  return (
    <div
      ref={viewport}
      className="fixed inset-x-0 top-0 flex h-dvh flex-col overflow-hidden bg-surface-muted"
    >
      <div className="shrink-0">
        <MainHeader />
      </div>
      {isLoading ? (
        <div
          role="status"
          className="flex flex-1 items-center justify-center gap-2 text-sm text-ink-muted"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          Đang khôi phục phiên đăng nhập…
        </div>
      ) : !user ? (
        <MessagingEmpty
          title="Hẹn nhau ở một hành trình mới"
          action={
            <Link
              href={`${ROUTES.login}?next=${encodeURIComponent(conversationId ? ROUTES.conversation(conversationId) : ROUTES.messages)}`}
              className={messagingButtonClass}
            >
              Đăng nhập để nhắn tin
            </Link>
          }
        >
          Kết nối với bạn đồng hành và cùng lên kế hoạch cho chuyến đi tiếp
          theo.
        </MessagingEmpty>
      ) : (
        <MessagingSession
          key={user.id}
          viewer={user.id}
          conversationId={conversationId}
        />
      )}
    </div>
  );
}

function MessagingSession({
  viewer,
  conversationId,
}: {
  viewer: string;
  conversationId?: string;
}) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const list = useConversations(viewer);
  const connected = useRealtimeStore(
    (state) => state.userId === viewer && state.connected,
  );
  const conversations = [
    ...new Map(
      list.data?.pages
        .flatMap((page) => page.data)
        .map((row) => [row.id, row]) ?? [],
    ).values(),
  ];
  const filtered = conversations.filter((row) =>
    matchesConversation(row, search),
  );
  const newButton = (
    <button
      type="button"
      onClick={() => setCreating(true)}
      className={messagingButtonClass}
    >
      <Plus className="h-4 w-4" aria-hidden />
      Bắt đầu trò chuyện
    </button>
  );
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 md:p-5">
      <div className="flex min-h-0 w-full overflow-hidden bg-surface md:rounded-2xl md:border md:border-border md:shadow-sm">
        <aside
          data-testid="conversation-list"
          aria-label="Danh sách cuộc trò chuyện"
          className={cn(
            "min-h-0 w-full shrink-0 flex-col md:flex md:w-80 md:border-r md:border-border lg:w-[22rem]",
            conversationId ? "hidden" : "flex",
          )}
        >
          <div className="shrink-0 border-b border-border px-5 pb-4 pt-5">
            <div className="mb-1 flex items-center justify-between gap-3">
              <h1 className="text-xl font-bold text-ink">Tin nhắn</h1>
              <button
                type="button"
                onClick={() => setCreating(true)}
                aria-label="Cuộc trò chuyện mới"
                title="Cuộc trò chuyện mới"
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-brand-950 dark:text-brand-300"
              >
                <Plus className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <p className="mb-4 text-xs text-ink-muted">
              Những câu chuyện trên mỗi hành trình
            </p>
            <label className="flex items-center gap-2 rounded-xl border border-border bg-surface-muted px-3 focus-within:ring-2 focus-within:ring-ring">
              <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
              <input
                aria-label="Tìm cuộc trò chuyện"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm bạn đồng hành…"
                className="min-w-0 flex-1 bg-transparent py-2.5 text-base text-ink outline-none placeholder:text-ink-muted md:text-sm"
              />
            </label>
          </div>
          {!connected && (
            <div
              role="status"
              className="flex items-start gap-2 border-b border-border px-5 py-2 text-xs text-ink-muted"
            >
              <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                Kết nối trực tiếp tạm gián đoạn. Đang đồng bộ lại tin nhắn.
              </span>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
            {list.isPending ? (
              <div
                role="status"
                className="flex items-center justify-center gap-2 p-8 text-sm text-ink-muted"
              >
                <Loader2 className="h-5 w-5 animate-spin" />
                Đang tải cuộc trò chuyện…
              </div>
            ) : list.isError && !list.data ? (
              <MessagingEmpty
                title="Chưa tải được cuộc trò chuyện"
                action={
                  <button
                    type="button"
                    onClick={() => void list.refetch()}
                    className={messagingButtonClass}
                  >
                    Thử lại
                  </button>
                }
              >
                Kiểm tra kết nối rồi thử lại nhé.
              </MessagingEmpty>
            ) : !conversations.length ? (
              <MessagingEmpty
                title="Hành trình bắt đầu từ một lời chào"
                action={newButton}
              >
                Gửi tin cho bạn đồng hành để cùng chia sẻ những điểm đến mới.
              </MessagingEmpty>
            ) : !filtered.length ? (
              <p
                role="status"
                className="px-4 py-8 text-center text-sm text-ink-muted"
              >
                Không tìm thấy cuộc trò chuyện phù hợp.
              </p>
            ) : (
              <ul className="space-y-1">
                {filtered.map((conversation) => {
                  const active = conversation.id === conversationId;
                  return (
                    <li key={conversation.id}>
                      <Link
                        href={ROUTES.conversation(conversation.id)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-xl px-3 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "bg-brand-50 ring-1 ring-inset ring-brand-200 dark:bg-brand-950 dark:ring-brand-800"
                            : "hover:bg-surface-muted",
                        )}
                      >
                        <MessagingAvatar profile={conversation.recipient} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={cn(
                                "truncate text-sm text-ink",
                                conversation.unread_count
                                  ? "font-bold"
                                  : "font-semibold",
                              )}
                            >
                              {conversation.recipient.display_name}
                            </span>
                            <time
                              dateTime={
                                conversation.last_message_at ??
                                conversation.created_at
                              }
                              className="shrink-0 text-[11px] text-ink-muted"
                            >
                              {formatListTime(
                                conversation.last_message_at ??
                                  conversation.created_at,
                              )}
                            </time>
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <p
                              className={cn(
                                "min-w-0 flex-1 truncate text-xs",
                                conversation.unread_count
                                  ? "font-medium text-ink"
                                  : "text-ink-muted",
                              )}
                            >
                              {conversationPreview(conversation)}
                            </p>
                            {conversation.unread_count > 0 && (
                              <span
                                aria-label={`${conversation.unread_count} tin nhắn chưa đọc`}
                                className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white"
                              >
                                {conversation.unread_count > 99
                                  ? "99+"
                                  : conversation.unread_count}
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {list.isRefetchError && (
              <p role="status" className="p-3 text-xs text-ink-muted">
                Chưa cập nhật được danh sách.{" "}
                <button
                  type="button"
                  onClick={() => void list.refetch()}
                  className="underline"
                >
                  Thử lại
                </button>
              </p>
            )}
            {list.hasNextPage && (
              <button
                type="button"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
                className="mt-3 w-full rounded-xl px-3 py-3 text-sm font-medium text-brand-700 hover:bg-surface-muted disabled:opacity-50 dark:text-brand-300"
              >
                {list.isFetchingNextPage
                  ? "Đang tải…"
                  : "Tải thêm cuộc trò chuyện"}
              </button>
            )}
          </div>
        </aside>
        <section
          data-testid="chat-panel"
          aria-label="Cuộc trò chuyện"
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col",
            conversationId ? "flex" : "hidden md:flex",
          )}
        >
          {conversationId ? (
            <ChatPanel
              key={`${viewer}:${conversationId}`}
              viewer={viewer}
              conversationId={conversationId}
            />
          ) : (
            <MessagingEmpty
              title="Mang câu chuyện của bạn đi xa hơn"
              action={newButton}
            >
              Chọn một cuộc trò chuyện hoặc gửi lời chào mới. Những chuyến đi
              đáng nhớ thường bắt đầu từ đây.
            </MessagingEmpty>
          )}
        </section>
      </div>
      <NewConversationDialog
        viewer={viewer}
        open={creating}
        onOpenChange={setCreating}
      />
    </main>
  );
}

function formatListTime(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat(
    "vi-VN",
    date.toDateString() === new Date().toDateString()
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "2-digit" },
  ).format(date);
}

function NewConversationDialog({
  viewer,
  open,
  onOpenChange,
}: {
  viewer: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [username, setUsername] = useState("");
  const [lookup, setLookup] = useState("");
  const router = useRouter();
  const start = useStartConversation();
  const profile = useQuery({
    queryKey: [...QUERY_KEYS.messaging.viewer(viewer), "recipient", lookup],
    queryFn: () => getProfileByUsername(lookup),
    enabled: open && !!lookup,
    retry: false,
  });
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setUsername("");
          setLookup("");
          start.reset();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-6 text-ink shadow-xl">
          <Dialog.Title className="pr-8 text-lg font-bold">
            Cuộc trò chuyện mới
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-ink-muted">
            Tìm bằng tên người dùng của bạn đồng hành, hoặc nhấn “Nhắn tin” trên
            hồ sơ của họ.
          </Dialog.Description>
          <Dialog.Close
            aria-label="Đóng"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-muted"
          >
            <X className="h-5 w-5" />
          </Dialog.Close>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const next = username.trim().replace(/^@/, "");
              if (next === lookup) void profile.refetch();
              else setLookup(next);
              start.reset();
            }}
            className="mt-5 space-y-3"
          >
            <label className="block text-sm font-medium">
              Tên người dùng
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="off"
                maxLength={50}
                placeholder="Ví dụ: linh_dilangthang"
                className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <button
              type="submit"
              disabled={
                !username.trim().replace(/^@/, "") || profile.isFetching
              }
              className={messagingButtonClass}
            >
              {profile.isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Tìm người nhận
            </button>
          </form>
          {lookup && profile.isError && (
            <p
              role="alert"
              className="mt-4 text-sm text-red-600 dark:text-red-400"
            >
              Chưa tìm được người nhận. Hãy thử lại.
            </p>
          )}
          {lookup && profile.isSuccess && !profile.data && (
            <p role="status" className="mt-4 text-sm text-ink-muted">
              Không tìm thấy tên người dùng này.
            </p>
          )}
          {profile.data && lookup && (
            <div className="mt-5 flex items-center gap-3 rounded-xl border border-border p-3">
              <MessagingAvatar profile={profile.data} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {profile.data.display_name}
                </p>
                <p className="truncate text-xs text-ink-muted">
                  @{profile.data.username}
                </p>
              </div>
              {profile.data.id === viewer ? (
                <span className="text-xs text-ink-muted">Bạn</span>
              ) : (
                <button
                  type="button"
                  disabled={start.isPending}
                  className={messagingButtonClass}
                  onClick={() => {
                    const version = getAuthSessionVersion();
                    start.mutate(profile.data!.id, {
                      onSuccess: ({ conversation }) => {
                        if (
                          useAuthStore.getState().user?.id !== viewer ||
                          version !== getAuthSessionVersion()
                        )
                          return;
                        onOpenChange(false);
                        router.push(ROUTES.conversation(conversation.id));
                      },
                    });
                  }}
                >
                  <MessageCircle className="h-4 w-4" />
                  {start.isPending ? "Đang mở…" : "Nhắn tin"}
                </button>
              )}
            </div>
          )}
          {start.isError && (
            <p
              role="alert"
              className="mt-4 text-sm text-red-600 dark:text-red-400"
            >
              {start.error.message ||
                "Hiện không thể bắt đầu cuộc trò chuyện này."}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
