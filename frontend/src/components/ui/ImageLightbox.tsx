"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, ImageOff, Loader2, RotateCcw, X } from "lucide-react";
import { cn, getPostImageUrl } from "@/lib/utils";

interface ImageLightboxProps {
  images: readonly string[];
  initialIndex: number;
  isOpen: boolean;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
}

const controlClass =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 motion-reduce:transition-none";

function LightboxImage({ src, index, total }: { src: string; index: number; total: number }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  return (
    <>
      {src && status === "loading" && (
        <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin motion-reduce:animate-none" />
          <span className="sr-only">Đang tải ảnh {index + 1}</span>
        </div>
      )}
      {!src || status === "error" ? (
        <div role="alert" className="max-w-xs rounded-2xl bg-white/10 p-6 text-center">
          <ImageOff aria-hidden="true" className="mx-auto mb-3 h-8 w-8 text-white/60" />
          <p className="text-sm">Không tải được ảnh này.</p>
          {src && (
            <button
              type="button"
              onClick={() => {
                setStatus("loading");
                setAttempt((value) => value + 1);
              }}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <RotateCcw aria-hidden="true" className="h-4 w-4" />
              Thử lại
            </button>
          )}
        </div>
      ) : (
        // URLs come from the existing upload/API contract and can use external image hosts.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={attempt}
          src={src}
          alt={`Ảnh ${index + 1} trong ${total} ảnh của bài đăng`}
          draggable={false}
          decoding="async"
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          className={cn(
            "relative max-h-[calc(100dvh-10rem)] max-w-full object-contain transition-opacity duration-150 motion-reduce:transition-none",
            status === "loaded" ? "opacity-100" : "opacity-0"
          )}
        />
      )}
    </>
  );
}

/** Mount a fresh session for every opening, without resetting or remounting the feed. */
export function ImageLightbox(props: ImageLightboxProps) {
  if (!props.isOpen || props.images.length === 0) return null;
  return <OpenImageLightbox {...props} />;
}

function OpenImageLightbox({ images, initialIndex, onClose, returnFocusTo }: ImageLightboxProps) {
  const [activeIndex, setActiveIndex] = useState(() =>
    Number.isFinite(initialIndex) ? Math.max(0, Math.min(Math.trunc(initialIndex), images.length - 1)) : 0
  );
  const index = Math.min(activeIndex, images.length - 1);
  const closeRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{
    pointerId: number;
    x: number;
    y: number;
    backdrop: boolean;
  } | null>(null);
  const multiple = images.length > 1;

  const navigate = (offset: number) => {
    setActiveIndex((current) => (Math.min(current, images.length - 1) + offset + images.length) % images.length);
  };

  useEffect(() => {
    if (images.length < 2) return;
    const currentSrc = getPostImageUrl(images[index]);
    const neighbors = new Set([
      getPostImageUrl(images[(index + 1) % images.length]),
      getPostImageUrl(images[(index - 1 + images.length) % images.length]),
    ]);
    neighbors.delete(currentSrc);
    const preloads = [...neighbors].filter(Boolean).map((src) => {
      const image = new window.Image();
      image.decoding = "async";
      image.fetchPriority = "low";
      image.src = src;
      return image;
    });
    return () => {
      preloads.forEach((image) => image.removeAttribute("src"));
    };
  }, [images, index]);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/90" />
        <Dialog.Content
          className="fixed inset-0 z-[101] h-[100dvh] touch-none select-none text-white outline-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            closeRef.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            if (returnFocusTo?.isConnected) {
              event.preventDefault();
              returnFocusTo.focus({ preventScroll: true });
            }
          }}
          onKeyDown={(event) => {
            if (!multiple || event.altKey || event.ctrlKey || event.metaKey) return;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              event.stopPropagation();
              navigate(event.key === "ArrowRight" ? 1 : -1);
            }
          }}
        >
          <Dialog.Title className="sr-only">Ảnh bài đăng</Dialog.Title>
          <Dialog.Description className="sr-only">
            Dùng phím mũi tên hoặc vuốt ngang để chuyển ảnh. Nhấn Escape hoặc nút Đóng để trở lại bản tin.
          </Dialog.Description>

          <div
            className="absolute inset-0 flex items-center justify-center px-4 py-20 sm:px-20"
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;
              // Buttons in the error panel retain their normal click/focus behavior.
              if (event.target instanceof Element && event.target.closest("button")) return;
              gesture.current = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                backdrop: event.target === event.currentTarget,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={(event) => {
              const start = gesture.current;
              if (!start || start.pointerId !== event.pointerId) return;
              gesture.current = null;
              const dx = event.clientX - start.x;
              const dy = event.clientY - start.y;
              if (multiple && Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.2) {
                navigate(dx < 0 ? 1 : -1);
              } else if (start.backdrop && Math.hypot(dx, dy) < 8) {
                // Pointer capture retargets pointerup: check where it actually ended.
                if (document.elementFromPoint(event.clientX, event.clientY) === event.currentTarget) onClose();
              }
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={() => { gesture.current = null; }}
            onLostPointerCapture={() => { gesture.current = null; }}
          >
            <LightboxImage
              key={`${index}:${images[index]}`}
              src={getPostImageUrl(images[index])}
              index={index}
              total={images.length}
            />
          </div>

          <div className="pointer-events-none absolute inset-x-4 top-4 flex items-center justify-between gap-4">
            <p role="status" aria-live="polite" aria-atomic="true" className="rounded-full bg-white/10 px-4 py-2 text-sm tabular-nums">
              <span className="sr-only">Ảnh </span>{index + 1} / {images.length}
            </p>
            <Dialog.Close asChild>
              <button ref={closeRef} type="button" aria-label="Đóng trình xem ảnh" title="Đóng (Esc)" className={cn(controlClass, "pointer-events-auto")}>
                <X aria-hidden="true" className="h-6 w-6" />
              </button>
            </Dialog.Close>
          </div>

          {multiple && (
            <>
              <button
                type="button"
                aria-label="Ảnh trước"
                title="Ảnh trước (←)"
                onClick={() => navigate(-1)}
                className={cn(controlClass, "absolute bottom-4 left-4 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2")}
              >
                <ChevronLeft aria-hidden="true" className="h-7 w-7" />
              </button>
              <button
                type="button"
                aria-label="Ảnh tiếp theo"
                title="Ảnh tiếp theo (→)"
                onClick={() => navigate(1)}
                className={cn(controlClass, "absolute bottom-4 right-4 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2")}
              >
                <ChevronRight aria-hidden="true" className="h-7 w-7" />
              </button>
              <p className="pointer-events-none absolute inset-x-16 bottom-7 text-center text-xs text-white/60 sm:hidden">
                Vuốt để chuyển ảnh
              </p>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
