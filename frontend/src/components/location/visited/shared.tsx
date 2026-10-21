"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRef } from "react";
import { Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

export const fieldClass =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-sm text-ink outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50";
export const primaryClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50";

export function assertTravelSession(viewer: string) {
  if (useAuthStore.getState().user?.id !== viewer)
    throw new ApiError(
      401,
      "UNAUTHORIZED",
      "Phiên đăng nhập đã thay đổi. Vui lòng mở lại để tiếp tục.",
    );
}

export function travelError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
    if (error.status === 404)
      return "Dữ liệu không còn tồn tại hoặc bạn không có quyền truy cập. Hãy đóng và mở lại để tải mới.";
    if (error.status === 429)
      return "Bạn thao tác hơi nhanh. Hãy thử lại sau một chút.";
    if (error.status < 500) return error.message;
  }
  return "Chưa thể lưu thay đổi. Vui lòng kiểm tra kết nối và thử lại.";
}

export function formatTravelDate(value: string) {
  // Date-only values must not shift to another day in the viewer's timezone.
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function TravelConfirm({
  open,
  title,
  description,
  label,
  pending = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  label: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/55 backdrop-blur-sm" />
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (pending) event.preventDefault();
          }}
          className="fixed left-1/2 top-1/2 z-[101] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-border bg-surface p-6 shadow-2xl outline-none"
        >
          <Dialog.Title className="text-lg font-semibold text-ink">
            {title}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-relaxed text-ink-muted">
            {description}
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              className={secondaryClass}
              disabled={pending}
              onClick={onCancel}
            >
              Quay lại
            </button>
            <button
              type="button"
              className={`${primaryClass} bg-red-600 hover:bg-red-700 focus-visible:ring-red-500`}
              disabled={pending}
              onClick={onConfirm}
            >
              {pending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              )}
              {label}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
