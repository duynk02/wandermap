"use client";

import { Loader2, MessageCircle } from "lucide-react";
import { useMessagingContacts } from "@/hooks/useMessagingContacts";
import type { MessagingContact } from "@/types/messaging";
import { MessagingAvatar } from "./MessagingPrimitives";

export function MutualContacts({
  viewer,
  search = "",
  exclude = [],
  onSelect,
  disabled = false,
  selectedId,
  description = "Chọn một người để bắt đầu trò chuyện.",
}: {
  viewer: string;
  search?: string;
  exclude?: string[];
  onSelect: (contact: MessagingContact) => void;
  disabled?: boolean;
  selectedId?: string;
  description?: string;
}) {
  const list = useMessagingContacts(viewer, search);
  const allContacts = [
    ...new Map(
      list.data?.pages
        .flatMap((page) => page.data)
        .map((row) => [row.id, row]) ?? [],
    ).values(),
  ];
  const contacts = allContacts.filter((row) => !exclude.includes(row.id));
  return (
    <section
      aria-label="Bạn bè"
      className="mt-4 border-t border-border pt-3"
    >
      <h2 className="px-3 text-xs font-semibold text-ink-muted">
        Bạn bè
      </h2>
      <p className="px-3 pb-2 pt-1 text-[11px] text-ink-muted">{description}</p>
      {list.isPending ? (
        <p
          role="status"
          className="flex items-center gap-2 p-3 text-sm text-ink-muted"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Đang tải bạn bè…
        </p>
      ) : list.isError ? (
        <p role="alert" className="p-3 text-sm text-ink-muted">
          Chưa cập nhật được danh sách.{" "}
          <button
            type="button"
            onClick={() => void list.refetch()}
            className="underline"
          >
            Thử lại
          </button>
        </p>
      ) : !contacts.length ? (
        <p role="status" className="p-3 text-xs text-ink-muted">
          {search
            ? "Không tìm thấy bạn bè phù hợp."
            : allContacts.length
              ? "Bạn bè của bạn đã có trong danh sách ở trên."
              : "Chưa có bạn bè. Theo dõi lại người đã theo dõi bạn để kết bạn."}
        </p>
      ) : (
        <ul className="space-y-1">
          {contacts.map((contact) => (
            <li key={contact.id}>
              <button
                type="button"
                disabled={disabled || list.isFetching}
                aria-pressed={
                  selectedId ? selectedId === contact.id : undefined
                }
                onClick={() => onSelect(contact)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-pressed:bg-brand-50 dark:aria-pressed:bg-brand-950"
              >
                <MessagingAvatar profile={contact} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {contact.display_name}
                  </span>
                  <span className="block truncate text-xs text-ink-muted">
                    @{contact.username}
                  </span>
                </span>
                <MessageCircle
                  className="h-4 w-4 text-brand-600 dark:text-brand-300"
                  aria-hidden
                />
              </button>
            </li>
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
          {list.isFetchingNextPage ? "Đang tải…" : "Xem thêm bạn bè"}
        </button>
      )}
    </section>
  );
}
