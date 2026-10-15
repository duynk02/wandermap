"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ImagePlus, Loader2, RotateCw, X } from "lucide-react";
import { ApiError, uploadImage } from "@/lib/api";
import { cn } from "@/lib/utils";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const MAX_INPUT_BYTES = 25 * 1024 * 1024; // what we accept from the device
const MAX_UPLOAD_BYTES = 9 * 1024 * 1024; // what we send (server limit is 10 MB)
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;
const MAX_EDGE_PX = 2048;

interface Item {
  id: number;
  file: File;
  preview: string;
  status: "uploading" | "done" | "error";
  url?: string;
  error?: string;
}

interface ImageUploaderProps {
  max: number;
  /** Called whenever the set of uploaded URLs or the busy state changes. */
  onChange: (urls: string[], busy: boolean) => void;
  error?: string;
}

/** Downscales big photos in the browser first: phone photos are often 4–8 MB, which is slow on mobile data. */
async function shrinkImage(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size <= SHRINK_ABOVE_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file); // honours EXIF orientation
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.\w+$/, "")}.webp`, { type: "image/webp" });
  } catch {
    return file; // the server still validates and resizes
  }
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413) return "Ảnh quá lớn";
    if (error.status === 401) return "Phiên đăng nhập đã hết hạn";
    if (error.status === 429) return "Tải lên quá nhanh, thử lại sau";
    return error.message;
  }
  return "Không thể tải ảnh lên";
}

export function ImageUploader({ max, onChange, error }: ImageUploaderProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const onChangeRef = useRef(onChange);
  const itemsRef = useRef<Item[]>([]);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    itemsRef.current = items;
    onChangeRef.current(
      items.filter((i) => i.status === "done").map((i) => i.url as string),
      items.some((i) => i.status === "uploading")
    );
  }, [items]);

  // Release object URLs when the form is left.
  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.preview)), []);

  const patch = (id: number, changes: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...changes } : i)));

  const upload = async (id: number, file: File) => {
    try {
      const prepared = await shrinkImage(file);
      if (prepared.size > MAX_UPLOAD_BYTES) throw new Error("too large");
      const { url } = await uploadImage(prepared);
      patch(id, { status: "done", url, error: undefined });
    } catch (e) {
      patch(id, { status: "error", error: e instanceof Error && e.message === "too large" ? "Ảnh quá lớn" : describeError(e) });
    }
  };

  const addFiles = (files: File[]) => {
    const messages: string[] = [];
    const room = max - items.length;
    const accepted: File[] = [];

    for (const file of files) {
      if (!ACCEPTED_TYPES.includes(file.type)) messages.push(`"${file.name}": chỉ hỗ trợ JPEG, PNG, WebP, GIF, AVIF`);
      else if (file.size > MAX_INPUT_BYTES) messages.push(`"${file.name}": vượt quá 25 MB`);
      else accepted.push(file);
    }
    if (accepted.length > room) messages.push(`Chỉ thêm được tối đa ${max} ảnh`);
    setNotice(messages.join(". "));

    const created: Item[] = accepted.slice(0, Math.max(room, 0)).map((file) => ({
      id: nextId.current++,
      file,
      preview: URL.createObjectURL(file),
      status: "uploading",
    }));
    if (!created.length) return;
    setItems((list) => [...list, ...created]);
    created.forEach((item) => void upload(item.id, item.file));
  };

  const remove = (item: Item) => {
    URL.revokeObjectURL(item.preview);
    setItems((list) => list.filter((i) => i.id !== item.id));
    setNotice("");
  };

  const retry = (item: Item) => {
    patch(item.id, { status: "uploading", error: undefined });
    void upload(item.id, item.file);
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = ""; // allow picking the same file again
        }}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "grid grid-cols-3 gap-2 rounded-2xl border border-dashed p-2 transition-colors sm:grid-cols-4",
          dragging ? "border-brand-500 bg-surface-muted" : "border-border"
        )}
      >
        {items.map((item, index) => (
          <div key={item.id} className="relative aspect-square overflow-hidden rounded-xl bg-surface-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.preview} alt={`Ảnh ${index + 1}`} className="h-full w-full object-cover" />

            {index === 0 && item.status !== "error" && (
              <span className="absolute left-1 top-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
                Ảnh bìa
              </span>
            )}

            {item.status === "uploading" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <Loader2 className="h-6 w-6 animate-spin text-white" />
              </div>
            )}

            {item.status === "error" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red-950/80 p-2 text-center text-white">
                <AlertCircle className="h-5 w-5" />
                <span className="text-[11px] leading-tight">{item.error}</span>
                <button
                  type="button"
                  onClick={() => retry(item)}
                  className="mt-1 flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] hover:bg-white/30"
                >
                  <RotateCw className="h-3 w-3" /> Thử lại
                </button>
              </div>
            )}

            <button
              type="button"
              aria-label={`Xoá ảnh ${index + 1}`}
              onClick={() => remove(item)}
              className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        {items.length < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl bg-surface-muted text-ink-muted transition-colors hover:bg-border hover:text-ink"
          >
            <ImagePlus className="h-6 w-6" />
            <span className="text-xs font-medium">Thêm ảnh</span>
          </button>
        )}
      </div>

      <p className="mt-2 text-xs text-ink-subtle">
        {items.length}/{max} ảnh · Chọn từ thiết bị hoặc kéo thả vào đây. Ảnh đầu tiên là ảnh bìa.
      </p>
      {(notice || error) && <p className="mt-1 text-xs text-red-500">{notice || error}</p>}
    </div>
  );
}