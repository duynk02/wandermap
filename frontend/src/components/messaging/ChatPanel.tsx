"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  Check,
  CheckCheck,
  CircleAlert,
  Loader2,
  Send,
  WifiOff,
} from "lucide-react";
import { ROUTES } from "@/constants";
import {
  useConversation,
  useConversationMessages,
  useMessageComposer,
  useReadConversation,
} from "@/hooks/useMessaging";
import { ApiError } from "@/lib/api/client";
import {
  isMessageRead,
  mergeDisplayMessages,
  messageTextLength,
  MESSAGE_MAX_LENGTH,
  safeMessageHref,
  validateMessageText,
  type DisplayMessage,
} from "@/lib/messaging/model";
import { cn } from "@/lib/utils";
import { useRealtimeStore } from "@/stores/realtimeStore";
import {
  getMessageScrollPosition,
  saveMessageScrollPosition,
} from "@/stores/messageDraftStore";
import { SharedContentCard } from "./SharedContentCard";
import { ConversationActions } from "./ConversationActions";
import type { ChatMessage, Conversation } from "@/types/messaging";
import {
  MessagingAvatar,
  MessagingEmpty,
  messagingButtonClass,
} from "./MessagingPrimitives";

export function ChatPanel({
  viewer,
  conversationId,
}: {
  viewer: string;
  conversationId: string;
}) {
  const detail = useConversation(viewer, conversationId);
  const history = useConversationMessages(
    viewer,
    conversationId,
    !!detail.data && !detail.isError,
  );
  const fetchNextPage = history.fetchNextPage;
  const confirmed = useMemo(
    () => history.data?.pages.flatMap((page) => page.data) ?? [],
    [history.data],
  );
  const composer = useMessageComposer(viewer, conversationId, confirmed);
  const read = useReadConversation(viewer, conversationId);
  const connected = useRealtimeStore(
    (state) => state.userId === viewer && state.connected,
  );
  const phase = useRealtimeStore((state) => state.phase);
  const scroller = useRef<HTMLDivElement>(null);
  const messageList = useRef<HTMLOListElement>(null);
  const bottom = useRef(true);
  const initialized = useRef(false);
  const previousNewest = useRef<string | null>(null);
  const initialPosition = useRef(
    getMessageScrollPosition(viewer, conversationId),
  );
  const readingAnchor = useRef<{
    key: string;
    offset: number;
    sequence: string | null;
  } | null>(null);
  const restoringAnchor = useRef(false);
  const restorePages = useRef(0);
  const [restoringHistory, setRestoringHistory] = useState(false);
  const newestSequence = useRef<string | null>(null);
  const anchor = useRef<{
    key: string;
    offset: number;
    height: number;
    top: number;
  } | null>(null);
  const readAttempt = useRef<string | null>(null);
  const [atBottom, setAtBottom] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  const [visible, setVisible] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const rows = useMemo(
    () => mergeDisplayMessages(confirmed, composer.messages),
    [confirmed, composer.messages],
  );
  const hasMessages = rows.length > 0;
  const latest = useMemo(
    () =>
      rows.reduce<ChatMessage | null>(
        (current, row) =>
          row.kind === "server" &&
          (!current || BigInt(row.message.sequence) > BigInt(current.sequence))
            ? row.message
            : current,
        null,
      ),
    [rows],
  );
  const conversation = detail.data;
  newestSequence.current = latest?.sequence ?? null;
  const unavailable =
    detail.isError &&
    detail.error instanceof ApiError &&
    [403, 404].includes(detail.error.status);
  const canSend = !!conversation?.can_send && !unavailable && !!history.data;

  useEffect(() => {
    const update = () => {
      const next =
        document.visibilityState === "visible" && document.hasFocus();
      setVisible(next);
      if (next) readAttempt.current = null;
    };
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, []);

  const savePosition = useCallback(() => {
    const element = scroller.current;
    if (
      !initialized.current ||
      restoringAnchor.current ||
      !element ||
      !element.clientHeight
    )
      return;
    const top = element.getBoundingClientRect().top;
    const node = [
      ...element.querySelectorAll<HTMLElement>("[data-message-key]"),
    ].find((item) => item.getBoundingClientRect().bottom > top);
    const position = {
      key: node?.dataset.messageKey ?? null,
      sequence: node?.dataset.messageSequence ?? null,
      offset: node ? node.getBoundingClientRect().top - top : 0,
      top: element.scrollTop,
      followLatest: bottom.current,
      newestSequence: newestSequence.current,
    };
    readingAnchor.current = position.key
      ? {
          key: position.key,
          offset: position.offset,
          sequence: position.sequence,
        }
      : null;
    saveMessageScrollPosition(viewer, conversationId, position);
  }, [viewer, conversationId]);

  const restoreReadingAnchor = useCallback(() => {
    const element = scroller.current;
    const saved = readingAnchor.current;
    if (!element || !saved) return;
    const node = [
      ...element.querySelectorAll<HTMLElement>("[data-message-key]"),
    ].find((item) => item.dataset.messageKey === saved.key);
    if (node)
      element.scrollTop +=
        node.getBoundingClientRect().top -
        element.getBoundingClientRect().top -
        saved.offset;
  }, []);

  useLayoutEffect(() => () => savePosition(), [savePosition]);

  const updatePosition = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    const next = distance < 8;
    bottom.current = distance < 72;
    setAtBottom(next);
    if (next) setNewMessages(false);
    savePosition();
  }, [savePosition]);

  const scrollToBottom = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    bottom.current = true;
    setAtBottom(true);
    setNewMessages(false);
    savePosition();
  }, [savePosition]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !history.data) return;
    const wanted = initialized.current
      ? (bottom.current ? null : readingAnchor.current)
      : initialPosition.current;
    const wantedNode =
      wanted?.key &&
      [...element.querySelectorAll<HTMLElement>("[data-message-key]")].find(
        (item) => item.dataset.messageKey === wanted.key,
      );
    const oldestSequence = confirmed.reduce<string | null>(
      (oldest, message) =>
        oldest === null || BigInt(message.sequence) < BigInt(oldest)
          ? message.sequence
          : oldest,
      null,
    );
    // A refreshed head can shift older page boundaries beyond the row being read.
    // Fetch the missing range from REST rather than retain stale, potentially private rows.
    if (
      wanted &&
      !("followLatest" in wanted && wanted.followLatest) &&
      !wantedNode &&
      wanted.sequence &&
      oldestSequence &&
      BigInt(oldestSequence) > BigInt(wanted.sequence) &&
      history.hasNextPage &&
      restorePages.current < 10
    ) {
      restoringAnchor.current = true;
      bottom.current = false;
      setAtBottom(false);
      setRestoringHistory(true);
      if (!history.isFetching && !history.isError) {
        restorePages.current += 1;
        void fetchNextPage();
      }
      return;
    }
    restoringAnchor.current = false;
    setRestoringHistory(false);
    if (!initialized.current) {
      const saved = initialPosition.current;
      const node =
        saved && !saved.followLatest && saved.key
          ? [
              ...element.querySelectorAll<HTMLElement>("[data-message-key]"),
            ].find((item) => item.dataset.messageKey === saved.key)
          : undefined;
      initialized.current = true;
      if (node && saved) {
        element.scrollTop +=
          node.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          saved.offset;
        bottom.current = false;
        updatePosition();
        if (
          !bottom.current &&
          latest &&
          saved.newestSequence &&
          BigInt(latest.sequence) > BigInt(saved.newestSequence)
        )
          setNewMessages(true);
      } else scrollToBottom();
      previousNewest.current = latest?.sequence ?? null;
      return;
    }
    // Compare committed sequence independently from failed/pending rows at the tail.
    if (
      initialized.current &&
      !bottom.current &&
      previousNewest.current &&
      latest &&
      BigInt(latest.sequence) > BigInt(previousNewest.current)
    )
      setNewMessages(true);
    if (anchor.current) {
      const saved = anchor.current;
      const node = [
        ...element.querySelectorAll<HTMLElement>("[data-message-key]"),
      ].find((item) => item.dataset.messageKey === saved.key);
      element.scrollTop = node
        ? element.scrollTop +
          node.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          saved.offset
        : saved.top + element.scrollHeight - saved.height;
      if (!history.isFetchingNextPage) anchor.current = null;
      updatePosition();
    } else if (bottom.current) {
      scrollToBottom();
    } else {
      restoreReadingAnchor();
      updatePosition();
    }
    previousNewest.current = latest?.sequence ?? null;
  }, [
    rows,
    latest,
    history.data,
    history.isFetchingNextPage,
    history.isFetching,
    history.isError,
    history.hasNextPage,
    fetchNextPage,
    confirmed,
    scrollToBottom,
    updatePosition,
    restoreReadingAnchor,
  ]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (restoringAnchor.current) return;
      if (bottom.current && !anchor.current) scrollToBottom();
      else {
        if (!anchor.current) restoreReadingAnchor();
        updatePosition();
      }
    });
    observer.observe(element);
    // Preview images/loading states can resize content without resizing the viewport.
    if (messageList.current) observer.observe(messageList.current);
    return () => observer.disconnect();
  }, [
    history.isPending,
    hasMessages,
    scrollToBottom,
    updatePosition,
    restoreReadingAnchor,
  ]);

  const latestIsVisible = useCallback(() => {
    const element = scroller.current;
    const node =
      element &&
      latest &&
      [...element.querySelectorAll<HTMLElement>("[data-message-key]")].find(
        (item) =>
          item.dataset.messageKey ===
          `${latest.sender_id}:${latest.client_message_id}`,
      );
    if (!element || !node) return false;
    const rowBounds = node.getBoundingClientRect(),
      bounds = element.getBoundingClientRect();
    return (
      rowBounds.bottom <= bounds.bottom + 1 && rowBounds.bottom > bounds.top
    );
  }, [latest]);

  useEffect(() => {
    if (
      !visible ||
      restoringHistory ||
      !atBottom ||
      !latest ||
      !conversation ||
      detail.isError ||
      history.isFetching ||
      read.isPending ||
      readAttempt.current === latest.sequence ||
      BigInt(latest.sequence) <=
        BigInt(conversation.read_state.last_read_sequence ?? "0")
    )
      return;
    if (!latestIsVisible()) return;
    // The latest committed row has been rendered at the visible end of this chat.
    readAttempt.current = latest.sequence;
    read.mutate(latest.sequence);
  }, [
    visible,
    atBottom,
    latest,
    conversation,
    detail.isError,
    history.isFetching,
    read,
    latestIsVisible,
    restoringHistory,
  ]);

  const loadOlder = () => {
    const element = scroller.current;
    if (!element || history.isFetching || !history.hasNextPage) return;
    const firstVisible = [
      ...element.querySelectorAll<HTMLElement>("[data-message-key]"),
    ].find(
      (node) =>
        node.getBoundingClientRect().bottom >
        element.getBoundingClientRect().top,
    );
    if (firstVisible)
      anchor.current = {
        key: firstVisible.dataset.messageKey!,
        offset:
          firstVisible.getBoundingClientRect().top -
          element.getBoundingClientRect().top,
        height: element.scrollHeight,
        top: element.scrollTop,
      };
    bottom.current = false;
    void history.fetchNextPage();
  };

  const submit = () => {
    if (!canSend || composer.isPending) return;
    const error = validateMessageText(composer.text);
    setComposerError(error);
    if (error) return;
    // An intentional send returns to the newest end; receiving while reading never does.
    bottom.current = true;
    composer.send();
  };

  return (
    <>
      <div className="flex min-h-[76px] shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <Link
          href={ROUTES.messages}
          aria-label="Quay lại danh sách tin nhắn"
          className="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted md:hidden"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        {conversation ? (
          <>
            <MessagingAvatar profile={conversation.recipient} />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-bold text-ink">
                {conversation.recipient.display_name}
              </h2>
              <p className="truncate text-xs text-ink-muted">
                @{conversation.recipient.username}
              </p>
            </div>
            <ConversationActions
              key={conversation.id}
              viewer={viewer}
              conversation={conversation}
            />
          </>
        ) : (
          <h2 className="text-base font-semibold text-ink">Cuộc trò chuyện</h2>
        )}
      </div>
      {!connected && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-muted px-4 py-2 text-xs text-ink-muted"
        >
          <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {phase === "session-expired"
            ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
            : "Kết nối trực tiếp tạm gián đoạn. Tin nhắn sẽ được đồng bộ khi kết nối trở lại."}
        </div>
      )}
      {detail.isPending ? (
        <div
          role="status"
          className="flex flex-1 items-center justify-center gap-2 text-sm text-ink-muted"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          Đang mở cuộc trò chuyện…
        </div>
      ) : unavailable ? (
        <MessagingEmpty
          title="Cuộc trò chuyện không còn khả dụng"
          action={
            <Link href={ROUTES.messages} className={messagingButtonClass}>
              Về danh sách tin nhắn
            </Link>
          }
        >
          Bạn có thể quay lại danh sách để chọn một cuộc trò chuyện khác.
        </MessagingEmpty>
      ) : detail.isError && !conversation ? (
        <MessagingEmpty
          title="Chưa mở được cuộc trò chuyện"
          action={
            <button
              type="button"
              className={messagingButtonClass}
              onClick={() => void detail.refetch()}
            >
              Thử lại
            </button>
          }
        >
          Kiểm tra kết nối rồi thử lại nhé.
        </MessagingEmpty>
      ) : (
        <>
          {detail.isError && (
            <p
              role="status"
              className="shrink-0 border-b border-border px-4 py-2 text-xs text-ink-muted"
            >
              Chưa cập nhật được cuộc trò chuyện.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => void detail.refetch()}
              >
                Thử lại
              </button>
            </p>
          )}
          {restoringHistory && (
            <p
              role="status"
              className="shrink-0 px-4 py-2 text-xs text-ink-muted"
            >
              {history.isError ? (
                <>
                  Chưa khôi phục được vị trí đọc.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void history.fetchNextPage()}
                  >
                    Thử lại
                  </button>
                </>
              ) : (
                "Đang khôi phục vị trí đọc…"
              )}
            </p>
          )}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div
              ref={scroller}
              data-testid="message-history"
              role="region"
              aria-label="Lịch sử tin nhắn"
              tabIndex={0}
              onScroll={updatePosition}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [overflow-anchor:none] [scroll-behavior:auto] md:px-6"
            >
              {history.isPending ? (
                <div
                  role="status"
                  className="flex h-full items-center justify-center gap-2 text-sm text-ink-muted"
                >
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Đang tải tin nhắn…
                </div>
              ) : history.isError && !history.data ? (
                <MessagingEmpty
                  title="Chưa tải được tin nhắn"
                  action={
                    <button
                      type="button"
                      className={messagingButtonClass}
                      onClick={() => void history.refetch()}
                    >
                      Thử lại
                    </button>
                  }
                >
                  Bản nháp của bạn vẫn được giữ lại.
                </MessagingEmpty>
              ) : (
                <>
                  {history.hasNextPage && (
                    <div className="mb-5 text-center">
                      <button
                        type="button"
                        disabled={history.isFetchingNextPage}
                        onClick={loadOlder}
                        className="min-h-10 rounded-xl px-4 py-2 text-xs font-medium text-brand-700 hover:bg-surface-muted disabled:opacity-50 dark:text-brand-300"
                      >
                        {history.isFetchingNextPage
                          ? "Đang tải tin nhắn cũ…"
                          : "Tải tin nhắn cũ"}
                      </button>
                    </div>
                  )}
                  {!rows.length ? (
                    <MessagingEmpty title="Gửi lời chào đầu tiên">
                      Một gợi ý điểm đến, một lời hẹn lên đường — bắt đầu câu
                      chuyện của bạn tại đây.
                    </MessagingEmpty>
                  ) : (
                    <ol
                      ref={messageList}
                      aria-label="Tin nhắn"
                      className="space-y-4"
                    >
                      {rows.map((row, index) => (
                        <MessageBubble
                          key={row.key}
                          row={row}
                          own={row.message.sender_id === viewer}
                          conversation={conversation!}
                          grouped={
                            index > 0 &&
                            rows[index - 1].message.sender_id ===
                              row.message.sender_id
                          }
                          onRetry={() => {
                            if (row.kind === "local" && canSend)
                              composer.send(row.message);
                          }}
                          retryDisabled={!canSend || composer.isPending}
                          refreshingShared={history.isRefetching}
                          failedShared={history.isError}
                        />
                      ))}
                    </ol>
                  )}
                  {history.isError && history.data && (
                    <p
                      role="status"
                      className="mt-4 text-center text-xs text-ink-muted"
                    >
                      Chưa cập nhật được tin nhắn.{" "}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => void history.refetch()}
                      >
                        Thử lại
                      </button>
                    </p>
                  )}
                </>
              )}
            </div>
            {newMessages && !atBottom && (
              <button
                type="button"
                onClick={scrollToBottom}
                className="absolute bottom-3 left-1/2 flex min-h-10 -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-brand-200 bg-surface px-4 py-2 text-sm font-semibold text-brand-700 shadow-md dark:border-brand-800 dark:text-brand-300"
              >
                <ArrowDown className="h-4 w-4" aria-hidden />
                Tin nhắn mới
              </button>
            )}
          </div>
          {read.isError && (
            <div
              role="status"
              className="shrink-0 px-4 py-1 text-xs text-ink-muted"
            >
              Chưa xác nhận được trạng thái đọc.{" "}
              <button
                type="button"
                aria-label="Thử lại trạng thái đọc"
                disabled={
                  !visible ||
                  !atBottom ||
                  history.isFetching ||
                  restoringHistory ||
                  read.isPending
                }
                className="underline disabled:opacity-50"
                onClick={() => {
                  if (
                    latest &&
                    atBottom &&
                    visible &&
                    !history.isFetching &&
                    !restoringHistory &&
                    !detail.isError &&
                    latestIsVisible()
                  ) {
                    readAttempt.current = latest.sequence;
                    read.mutate(latest.sequence);
                  }
                }}
              >
                Thử lại
              </button>
            </div>
          )}
          {conversation && !conversation.can_send && (
            <p
              role="status"
              className="shrink-0 border-t border-border bg-surface-muted px-4 py-3 text-sm text-ink-muted"
            >
              {!conversation.recipient.is_active
                ? "Người nhận hiện không còn khả dụng."
                : conversation.blocked_by_me
                  ? "Bạn đã chặn tin nhắn từ tài khoản này."
                  : conversation.is_mutual === false
                    ? "Hai bạn cần theo dõi nhau để tiếp tục nhắn tin. Lịch sử trò chuyện vẫn được giữ lại."
                    : "Hiện không thể gửi tin nhắn trong cuộc trò chuyện này."}
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="shrink-0 border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          >
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface-muted p-2 focus-within:ring-2 focus-within:ring-ring">
              <textarea
                data-testid="message-composer"
                aria-label="Tin nhắn"
                aria-describedby="message-composer-hint"
                aria-invalid={!!composerError}
                rows={2}
                value={composer.text}
                disabled={!canSend || composer.isPending}
                onChange={(event) => {
                  composer.setText(event.target.value);
                  setComposerError(null);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    event.nativeEvent.keyCode !== 229
                  ) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder={
                  conversation?.can_send === false
                    ? "Hiện không thể gửi tin nhắn"
                    : "Chia sẻ câu chuyện của bạn…"
                }
                className="max-h-32 min-h-[48px] min-w-0 flex-1 resize-y bg-transparent px-2 py-1 text-base leading-6 text-ink outline-none placeholder:text-ink-muted disabled:opacity-60 md:text-sm"
              />
              <button
                type="submit"
                aria-label="Gửi tin nhắn"
                disabled={
                  !canSend ||
                  composer.isPending ||
                  !!validateMessageText(composer.text)
                }
                className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {composer.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <Send className="h-5 w-5" aria-hidden />
                )}
              </button>
            </div>
            <div
              id="message-composer-hint"
              className="mt-1.5 flex justify-between gap-3 text-[11px] text-ink-muted"
            >
              <span className="hidden sm:inline">
                Enter để gửi · Shift+Enter để xuống dòng
              </span>
              <span
                className={cn(
                  "ml-auto",
                  messageTextLength(composer.text) > MESSAGE_MAX_LENGTH &&
                    "text-red-600 dark:text-red-400",
                )}
              >
                {messageTextLength(composer.text)}/{MESSAGE_MAX_LENGTH}
              </span>
            </div>
            {(composerError ||
              (composer.text.trim() && validateMessageText(composer.text))) && (
              <p
                role="alert"
                className="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {composerError || validateMessageText(composer.text)}
              </p>
            )}
          </form>
        </>
      )}
    </>
  );
}

function MessageBubble({
  row,
  own,
  conversation,
  grouped,
  onRetry,
  retryDisabled,
  refreshingShared,
  failedShared,
}: {
  row: DisplayMessage;
  own: boolean;
  conversation: Conversation;
  grouped: boolean;
  onRetry: () => void;
  retryDisabled: boolean;
  refreshingShared: boolean;
  failedShared: boolean;
}) {
  const message = row.message;
  const sent = row.kind === "server";
  const deleted = sent && !!row.message.deleted_at;
  const read =
    sent &&
    own &&
    isMessageRead(
      row.message,
      conversation.recipient_read_state.last_read_sequence,
    );
  const time = new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(message.created_at));
  const status = row.kind === "local" ? row.message.status : "sent";
  return (
    <li
      data-message-key={row.key}
      data-message-sequence={
        row.kind === "server" ? row.message.sequence : undefined
      }
      data-delivery={status}
      className={cn(
        "flex items-end gap-2",
        own ? "justify-end" : "justify-start",
        grouped && "!mt-2",
      )}
    >
      {!own &&
        (grouped ? (
          <div className="w-7 shrink-0" />
        ) : (
          <MessagingAvatar
            profile={conversation.recipient}
            className="h-7 w-7"
          />
        ))}
      <div
        className={cn("min-w-0 max-w-[85%] md:max-w-[78%]", own && "items-end")}
      >
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2.5 text-sm leading-6",
            own
              ? "rounded-br-md bg-brand-600 text-white"
              : "rounded-bl-md bg-surface-muted text-ink",
            deleted && "italic opacity-70",
            status === "failed" && "ring-1 ring-red-500",
          )}
        >
          {deleted ? (
            "Tin nhắn đã được xóa"
          ) : (
            <>
              {message.content && <SafeMessageText text={message.content} />}
              {row.kind === "server" && row.message.message_type !== "text" && (
                <SharedContentCard
                  type={row.message.message_type}
                  resource={row.message.shared_resource}
                  own={own}
                  refreshing={refreshingShared}
                  failed={failedShared}
                />
              )}
            </>
          )}
        </div>
        <div
          className={cn(
            "mt-1 flex flex-wrap items-center gap-1 text-[10px] text-ink-muted",
            own && "justify-end",
          )}
        >
          <time
            dateTime={message.created_at}
            title={new Date(message.created_at).toLocaleString("vi-VN")}
          >
            {time}
          </time>
          {own && (
            <span className="inline-flex items-center gap-1">
              ·{" "}
              {row.kind === "local" ? (
                row.message.status === "pending" ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    Đang gửi
                  </>
                ) : (
                  <>
                    <CircleAlert className="h-3 w-3 text-red-500" aria-hidden />
                    Gửi thất bại
                  </>
                )
              ) : read ? (
                <>
                  <CheckCheck
                    className="h-3 w-3 text-brand-600 dark:text-brand-400"
                    aria-hidden
                  />
                  Đã đọc
                </>
              ) : (
                <>
                  <Check className="h-3 w-3" aria-hidden />
                  Đã gửi
                </>
              )}
            </span>
          )}
        </div>
        {row.kind === "local" && row.message.status === "failed" && (
          <div
            role="alert"
            className="mt-1 max-w-xs text-right text-xs text-red-600 dark:text-red-400"
          >
            <p>{row.message.error}</p>
            <button
              type="button"
              onClick={onRetry}
              disabled={retryDisabled}
              className="mt-1 min-h-8 font-semibold underline disabled:opacity-50"
            >
              Thử gửi lại
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function SafeMessageText({ text }: { text: string }) {
  // React escapes every text node; only absolute HTTP(S) links become anchors.
  const parts = text.split(/(https?:\/\/[^\s<>]+)/gi);
  return (
    <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {parts.map((part, index) => {
        const href = /^https?:\/\//i.test(part) ? safeMessageHref(part) : null;
        return href ? (
          <a
            key={index}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline underline-offset-2"
          >
            {part}
          </a>
        ) : (
          part
        );
      })}
    </p>
  );
}
