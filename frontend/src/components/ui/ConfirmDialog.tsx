"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** While true both buttons are disabled and Esc / backdrop clicks are ignored. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Minimal accessible confirm modal: Esc and backdrop cancel, focus starts on "Hủy". */
export function ConfirmDialog({
  open,
  title,
  confirmLabel = "Xác nhận",
  cancelLabel = "Hủy",
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Latest callback without re-running the effect (which would steal focus on every render).
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancelRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, pending]);

  if (!open) return null;

  // Portal: never clipped by an ancestor's overflow/transform (cards use overflow-hidden).
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden
        onClick={() => {
          if (!pending) onCancel();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-sm rounded-2xl bg-surface-elevated p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-base font-semibold text-ink">
          {title}
        </h2>
        <div className="mt-6 flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-muted disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={cn(
              "rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-60"
            )}
          >
            {pending ? "Đang xử lý…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}