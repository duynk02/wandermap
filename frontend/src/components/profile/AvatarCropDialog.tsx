"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Minus, Plus, RotateCcw, X } from "lucide-react";
import {
  constrainAvatarCrop,
  getAvatarCropRect,
  MAX_AVATAR_ZOOM,
  type AvatarCrop,
  type AvatarImageSize,
} from "@/lib/utils/avatarCrop";

interface AvatarCropDialogProps {
  file: File;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onConfirm: (file: File) => void;
  onCancel: () => void;
}

interface DragStart {
  pointerId: number;
  x: number;
  y: number;
  crop: AvatarCrop;
}

async function exportAvatar(
  image: HTMLImageElement,
  crop: AvatarCrop,
  name: string,
): Promise<File> {
  const rect = getAvatarCropRect(
    { width: image.naturalWidth, height: image.naturalHeight },
    crop,
  );
  // Keep small inputs at their source resolution instead of stretching them.
  const edge = Math.max(1, Math.min(512, Math.floor(rect.size)));
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Không thể xử lý ảnh trong trình duyệt này.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    rect.x,
    rect.y,
    rect.size,
    rect.size,
    0,
    0,
    edge,
    edge,
  );
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) =>
        result
          ? resolve(result)
          : reject(new Error("Không thể tạo ảnh đã cắt.")),
      "image/webp",
      0.92,
    );
  });
  // Browsers without a WebP encoder fall back to PNG.
  const extension = blob.type === "image/webp" ? "webp" : "png";
  return new File(
    [blob],
    `${name.replace(/\.[^.]+$/, "").slice(0, 100)}-avatar.${extension}`,
    { type: blob.type },
  );
}

export function AvatarCropDialog({
  file,
  returnFocusRef,
  onConfirm,
  onCancel,
}: AvatarCropDialogProps) {
  const zoomId = useId();
  const hintId = useId();
  const [sourceUrl, setSourceUrl] = useState("");
  const [imageSize, setImageSize] = useState<AvatarImageSize | null>(null);
  const [crop, setCrop] = useState<AvatarCrop>({
    zoom: 1,
    centerX: 0,
    centerY: 0,
  });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragStart | null>(null);
  const exportingRef = useRef(false);
  const activeRef = useRef(false);

  useEffect(() => {
    activeRef.current = true;
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    return () => {
      activeRef.current = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const cancel = () => {
    if (!exportingRef.current) onCancel();
  };

  const changeZoom = (zoom: number) => {
    if (!imageSize || pending) return;
    dragRef.current = null;
    setCrop((current) => constrainAvatarCrop(imageSize, { ...current, zoom }));
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!imageSize || pending || dragRef.current || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      crop,
    };
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    if (!start || start.pointerId !== event.pointerId || !imageSize || pending)
      return;
    const width = event.currentTarget.getBoundingClientRect().width;
    if (width <= 0) return;
    const sourceEdge =
      Math.min(imageSize.width, imageSize.height) / start.crop.zoom;
    setCrop(
      constrainAvatarCrop(imageSize, {
        ...start.crop,
        centerX:
          start.crop.centerX - ((event.clientX - start.x) / width) * sourceEdge,
        centerY:
          start.crop.centerY - ((event.clientY - start.y) / width) * sourceEdge,
      }),
    );
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const moveWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!imageSize || pending) return;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [1, 0],
      ArrowRight: [-1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const step =
      (Math.min(imageSize.width, imageSize.height) / crop.zoom) *
      (event.shiftKey ? 0.1 : 0.02);
    setCrop((current) =>
      constrainAvatarCrop(imageSize, {
        ...current,
        centerX: current.centerX + move[0] * step,
        centerY: current.centerY + move[1] * step,
      }),
    );
  };

  const confirm = async () => {
    if (!imageSize || !imageRef.current || exportingRef.current) return;
    exportingRef.current = true;
    dragRef.current = null;
    setPending(true);
    setError("");
    try {
      const result = await exportAvatar(imageRef.current, crop, file.name);
      if (activeRef.current) onConfirm(result);
    } catch {
      if (activeRef.current)
        setError("Không thể cắt ảnh. Vui lòng thử lại hoặc chọn ảnh khác.");
    } finally {
      exportingRef.current = false;
      if (activeRef.current) setPending(false);
    }
  };

  const rect = imageSize ? getAvatarCropRect(imageSize, crop) : null;
  const disabled = !imageSize || pending;
  const iconButtonClass =
    "rounded-full p-2 text-ink-muted hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40";

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) cancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/70" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[111] flex max-h-[calc(100dvh_-_2rem)] w-[calc(100vw_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-surface shadow-xl"
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            cancel();
          }}
          onInteractOutside={(event) => {
            event.preventDefault();
            cancel();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <Dialog.Title className="text-lg font-bold text-ink">
                Căn chỉnh ảnh đại diện
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-ink-muted">
                Chọn phần ảnh bạn muốn hiển thị trong khung tròn.
              </Dialog.Description>
            </div>
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              aria-label="Hủy cắt ảnh"
              className={iconButtonClass}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-5">
            <div
              role="group"
              aria-label="Vùng cắt ảnh đại diện"
              aria-describedby={hintId}
              aria-disabled={disabled}
              tabIndex={disabled ? -1 : 0}
              className="relative mx-auto aspect-square w-full max-w-[320px] cursor-grab touch-none select-none overflow-hidden rounded-xl bg-surface-muted outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 active:cursor-grabbing aria-disabled:cursor-default"
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={() => {
                dragRef.current = null;
              }}
              onKeyDown={moveWithKeyboard}
            >
              {sourceUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  ref={imageRef}
                  src={sourceUrl}
                  alt="Ảnh đại diện đang căn chỉnh"
                  draggable={false}
                  className="pointer-events-none absolute max-w-none select-none"
                  style={
                    imageSize && rect
                      ? {
                          width: `${(imageSize.width / rect.size) * 100}%`,
                          height: `${(imageSize.height / rect.size) * 100}%`,
                          left: `${(-rect.x / rect.size) * 100}%`,
                          top: `${(-rect.y / rect.size) * 100}%`,
                        }
                      : { opacity: 0 }
                  }
                  onLoad={(event) => {
                    const size = {
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    };
                    if (
                      !size.width ||
                      !size.height ||
                      size.width * size.height > 80_000_000
                    ) {
                      setError(
                        "Ảnh không hợp lệ hoặc có độ phân giải quá lớn. Vui lòng chọn ảnh khác.",
                      );
                      return;
                    }
                    setImageSize(size);
                    setCrop({
                      zoom: 1,
                      centerX: size.width / 2,
                      centerY: size.height / 2,
                    });
                  }}
                  onError={() =>
                    setError("Không đọc được ảnh. Vui lòng chọn ảnh khác.")
                  }
                />
              )}
              {!imageSize && !error && (
                <div
                  role="status"
                  className="absolute inset-0 flex items-center justify-center text-ink-muted"
                >
                  <Loader2
                    className="h-6 w-6 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  <span className="sr-only">Đang đọc ảnh</span>
                </div>
              )}
              {imageSize && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.55)]"
                />
              )}
            </div>

            <p id={hintId} className="text-center text-xs text-ink-muted">
              Kéo thả để căn chỉnh. Bạn cũng có thể
              chọn khung ảnh và dùng các phím mũi tên.
            </p>
            <div>
              <div className="mb-1 flex items-center justify-between text-sm text-ink">
                <label htmlFor={zoomId} className="font-medium">
                  Thu phóng
                </label>
                <span className="tabular-nums">
                  {Math.round(crop.zoom * 100)}%
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => changeZoom(crop.zoom - 0.1)}
                  disabled={disabled || crop.zoom <= 1}
                  aria-label="Thu nhỏ ảnh"
                  className={iconButtonClass}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <input
                  id={zoomId}
                  type="range"
                  min={1}
                  max={MAX_AVATAR_ZOOM}
                  step={0.01}
                  value={crop.zoom}
                  onChange={(event) => changeZoom(Number(event.target.value))}
                  disabled={disabled}
                  aria-valuetext={`${Math.round(crop.zoom * 100)}%`}
                  className="h-8 min-w-0 flex-1 cursor-pointer accent-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40"
                />
                <button
                  type="button"
                  onClick={() => changeZoom(crop.zoom + 0.1)}
                  disabled={disabled || crop.zoom >= MAX_AVATAR_ZOOM}
                  aria-label="Phóng to ảnh"
                  className={iconButtonClass}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                if (imageSize)
                  setCrop({
                    zoom: 1,
                    centerX: imageSize.width / 2,
                    centerY: imageSize.height / 2,
                  });
              }}
              className="mx-auto flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Đặt lại
            </button>
            {error && (
              <p
                role="alert"
                className="rounded-xl bg-red-500/10 p-3 text-sm text-red-500"
              >
                {error}
              </p>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-3 border-t border-border px-5 py-4">
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-ink hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-60"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={disabled}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-60"
            >
              {pending && (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              {pending ? "Đang cắt…" : "Áp dụng ảnh"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
