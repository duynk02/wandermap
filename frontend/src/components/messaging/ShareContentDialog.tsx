"use client";

import { useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Search, Send, X } from "lucide-react";
import { toast } from "sonner";
import { QUERY_KEYS, ROUTES } from "@/constants";
import { useConversations } from "@/hooks/useMessaging";
import { useShareContent } from "@/hooks/useShareContent";
import { getAuthSessionVersion } from "@/lib/api/client";
import { getProfileByUsername } from "@/lib/api/users";
import {
  matchesConversation,
  messageTextLength,
  MESSAGE_MAX_LENGTH,
} from "@/lib/messaging/model";
import type { ShareDestination, ShareTarget } from "@/lib/messaging/share";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { MessagingAvatar, messagingButtonClass } from "./MessagingPrimitives";
import { SharedContentCard } from "./SharedContentCard";
import { MutualContacts } from "./MutualContacts";

export function ShareContentDialog({
  target,
  viewer,
  session,
  onClose,
}: {
  target: ShareTarget;
  viewer: string;
  session: number;
  onClose: () => void;
}) {
  const list = useConversations(viewer);
  const share = useShareContent(viewer, session, target);
  const [search, setSearch] = useState("");
  const [lookup, setLookup] = useState("");
  const [destination, setDestination] = useState<
    (ShareDestination & { name: string }) | null
  >(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const profile = useQuery({
    queryKey: [
      ...QUERY_KEYS.messaging.viewer(viewer),
      "share-recipient",
      lookup,
    ],
    queryFn: () => getProfileByUsername(lookup),
    enabled: !!lookup,
    retry: false,
  });
  const conversations = [
    ...new Map(
      list.data?.pages
        .flatMap((page) => page.data)
        .map((row) => [row.id, row]) ?? [],
    ).values(),
  ].filter((row) => matchesConversation(row, search));
  const blocked = !!target.restriction || share.isPending || !!sent;
  const current = () =>
    useAuthStore.getState().user?.id === viewer &&
    getAuthSessionVersion() === session;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !share.isPending) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          data-testid="share-content-dialog"
          className="fixed left-1/2 top-1/2 z-[61] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-surface text-ink shadow-xl"
          onEscapeKeyDown={(event) => {
            if (share.isPending) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (share.isPending) event.preventDefault();
          }}
        >
          <header className="shrink-0 border-b border-border p-5 pr-14">
            <Dialog.Title className="text-lg font-bold">
              Chia sẻ qua tin nhắn
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-ink-muted">
              Gửi một điểm đến hay câu chuyện cho bạn đồng hành.
            </Dialog.Description>
            <Dialog.Close
              disabled={share.isPending}
              aria-label="Đóng chia sẻ"
              className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-muted disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5">
            <SharedContentCard
              type={target.type}
              resource={target.preview}
              preview
            />
            {target.restriction && (
              <p
                role="alert"
                className="rounded-xl bg-surface-muted p-3 text-sm text-ink-muted"
              >
                {target.restriction}
              </p>
            )}
            {sent ? (
              <div
                role="status"
                className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-800 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-200"
              >
                <p className="flex items-center gap-2 font-semibold">
                  <Check className="h-4 w-4" />
                  Đã gửi cho {destination?.name}
                </p>
                <Link
                  href={ROUTES.conversation(sent)}
                  className="mt-3 inline-block font-semibold underline"
                >
                  Mở cuộc trò chuyện
                </Link>
              </div>
            ) : (
              <>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = search.trim().replace(/^@/, "");
                    if (value === lookup) void profile.refetch();
                    else setLookup(value);
                  }}
                >
                  <label
                    className="mb-2 block text-sm font-medium"
                    htmlFor="share-recipient-search"
                  >
                    Người nhận
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="share-recipient-search"
                      aria-label="Tìm người nhận chia sẻ"
                      value={search}
                      disabled={blocked}
                      onChange={(event) => {
                        setSearch(event.target.value);
                        setLookup("");
                        setError(null);
                      }}
                      autoComplete="off"
                      maxLength={50}
                      placeholder="Tên hoặc @username…"
                      className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 md:text-sm"
                    />
                    <button
                      type="submit"
                      disabled={
                        blocked ||
                        !search.trim().replace(/^@/, "") ||
                        profile.isFetching
                      }
                      aria-label="Tìm tên người dùng"
                      className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-ink-muted hover:bg-surface-muted disabled:opacity-50"
                    >
                      {profile.isFetching ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-muted">
                    Lọc cuộc trò chuyện theo tên, hoặc nhấn tìm để tra username
                    chính xác.
                  </p>
                </form>
                {lookup && profile.isError && (
                  <p
                    role="alert"
                    className="text-xs text-red-600 dark:text-red-400"
                  >
                    Chưa tìm được người nhận. Hãy thử lại.
                  </p>
                )}
                {lookup && profile.isSuccess && !profile.data && (
                  <p role="status" className="text-xs text-ink-muted">
                    Không tìm thấy username này.
                  </p>
                )}
                {lookup && profile.data && profile.data.id !== viewer && (
                  <button
                    type="button"
                    disabled={blocked || !profile.data.can_message || profile.isFetching}
                    aria-pressed={
                      destination?.kind === "user" &&
                      destination.id === profile.data.id
                    }
                    onClick={() => {
                      setDestination({
                        kind: "user",
                        id: profile.data!.id,
                        name: profile.data!.display_name,
                      });
                      setError(null);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border p-3 text-left disabled:opacity-50",
                      destination?.kind === "user" &&
                        destination.id === profile.data.id
                        ? "border-brand-500 bg-brand-50 dark:bg-brand-950"
                        : "border-border",
                    )}
                  >
                    <MessagingAvatar profile={profile.data} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {profile.data.display_name}
                      </span>
                      <span className="block truncate text-xs text-ink-muted">
                        {profile.data.can_message ? `@${profile.data.username}` : "Chỉ có thể nhắn tin khi hai bạn là bạn bè và không chặn nhau."}
                      </span>
                    </span>
                    {destination?.kind === "user" &&
                      destination.id === profile.data.id && (
                        <Check className="h-4 w-4 text-brand-600" />
                      )}
                  </button>
                )}
                {lookup && profile.data?.id === viewer && (
                  <p className="text-xs text-ink-muted">
                    Bạn không thể gửi tin nhắn cho chính mình.
                  </p>
                )}
                <section aria-label="Cuộc trò chuyện gần đây">
                  <h3 className="mb-2 text-xs font-semibold text-ink-muted">
                    Cuộc trò chuyện gần đây
                  </h3>
                  {list.isPending ? (
                    <p role="status" className="py-3 text-sm text-ink-muted">
                      Đang tải cuộc trò chuyện…
                    </p>
                  ) : list.isError && !list.data ? (
                    <p role="alert" className="text-sm text-ink-muted">
                      Chưa tải được danh sách.{" "}
                      <button
                        type="button"
                        onClick={() => void list.refetch()}
                        className="underline"
                      >
                        Thử lại
                      </button>
                    </p>
                  ) : !conversations.length ? (
                    <p className="py-2 text-sm text-ink-muted">
                      Chưa có cuộc trò chuyện phù hợp. Chọn một người trong danh sách Bạn bè bên dưới.
                    </p>
                  ) : (
                    <div className="max-h-44 space-y-1 overflow-y-auto">
                      {conversations.map((conversation) => (
                        <button
                          type="button"
                          key={conversation.id}
                          disabled={blocked || !conversation.can_send}
                          aria-pressed={
                            destination?.kind === "conversation" &&
                            destination.id === conversation.id
                          }
                          onClick={() => {
                            setDestination({
                              kind: "conversation",
                              id: conversation.id,
                              recipient_id: conversation.recipient.id,
                              name: conversation.recipient.display_name,
                            });
                            setError(null);
                          }}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left disabled:opacity-50",
                            destination?.kind === "conversation" &&
                              destination.id === conversation.id
                              ? "border-brand-500 bg-brand-50 dark:bg-brand-950"
                              : "border-transparent hover:bg-surface-muted",
                          )}
                        >
                          <MessagingAvatar
                            profile={conversation.recipient}
                            className="h-9 w-9"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">
                              {conversation.recipient.display_name}
                            </span>
                            <span className="block text-xs text-ink-muted">
                              {!conversation.recipient.is_active
                                ? "Tài khoản không còn khả dụng"
                                : !conversation.can_send
                                  ? "Hiện không thể nhắn tin"
                                  : `@${conversation.recipient.username}`}
                            </span>
                          </span>
                          {destination?.kind === "conversation" &&
                            destination.id === conversation.id && (
                              <Check className="h-4 w-4 text-brand-600" />
                            )}
                        </button>
                      ))}
                    </div>
                  )}
                  {list.hasNextPage && (
                    <button
                      type="button"
                      disabled={list.isFetchingNextPage || blocked}
                      onClick={() => void list.fetchNextPage()}
                      className="mt-2 min-h-9 text-xs font-semibold text-brand-600 disabled:opacity-50"
                    >
                      {list.isFetchingNextPage
                        ? "Đang tải…"
                        : "Tải thêm cuộc trò chuyện"}
                    </button>
                  )}
                </section>
                <MutualContacts viewer={viewer} search={search} exclude={conversations.map((row) => row.recipient.id)} disabled={blocked}
                  description="Chọn một người để chia sẻ nội dung."
                  selectedId={destination?.kind === "user" ? destination.id : undefined}
                  onSelect={(contact) => {
                    setDestination({ kind: "user", id: contact.id, name: contact.display_name });
                    setError(null);
                  }} />
                <label
                  className="block text-sm font-medium"
                  htmlFor="share-caption"
                >
                  Lời nhắn{" "}
                  <span className="font-normal text-ink-muted">(tùy chọn)</span>
                  <textarea
                    id="share-caption"
                    value={caption}
                    disabled={blocked}
                    onChange={(event) => {
                      setCaption(event.target.value);
                      setError(null);
                    }}
                    rows={2}
                    placeholder="Mình cùng ghé nơi này nhé!"
                    className="mt-2 w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-base font-normal outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 md:text-sm"
                  />
                </label>
                <p
                  className={cn(
                    "text-right text-[11px] text-ink-muted",
                    messageTextLength(caption) > MESSAGE_MAX_LENGTH &&
                      "text-red-600",
                  )}
                >
                  {messageTextLength(caption)}/{MESSAGE_MAX_LENGTH}
                </p>
                {error && (
                  <p
                    role="alert"
                    className="text-sm text-red-600 dark:text-red-400"
                  >
                    {error}
                  </p>
                )}
              </>
            )}
          </div>
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <p className="min-w-0 truncate text-xs text-ink-muted">
              {destination
                ? `Gửi cho ${destination.name}`
                : "Chọn một người nhận"}
            </p>
            {sent ? (
              <Dialog.Close className={messagingButtonClass}>Xong</Dialog.Close>
            ) : (
              <button
                type="button"
                disabled={
                  blocked ||
                  !destination ||
                  messageTextLength(caption) > MESSAGE_MAX_LENGTH
                }
                className={messagingButtonClass}
                onClick={async () => {
                  if (!destination) return;
                  setError(null);
                  try {
                    const result = await share.send(destination, caption);
                    if (!current()) return;
                    setSent(result.conversation.id);
                    toast.success("Đã chia sẻ qua tin nhắn");
                  } catch (cause) {
                    if (current())
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Chưa gửi được nội dung. Hãy thử lại.",
                      );
                  }
                }}
              >
                {share.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {share.isPending ? "Đang gửi…" : error ? "Thử gửi lại" : "Gửi"}
              </button>
            )}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
