"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Download, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import {
  primaryClass,
  secondaryClass,
} from "@/components/location/visited/shared";
import {
  journeyImageFilename,
  posterDimensions,
  type JourneyExportRatio,
  type JourneyPosterInput,
} from "@/lib/journey-export/model";
import { renderJourneyPoster } from "@/lib/journey-export/render";

export function JourneyExportDialog({
  input,
  onClose,
}: {
  input: JourneyPosterInput;
  onClose: () => void;
}) {
  const [ratio, setRatio] = useState<JourneyExportRatio>("1:1");
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    url: string;
    ratio: JourneyExportRatio;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // The parent captures a snapshot at open time. Closing never touches the Builder's form.
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    setLoading(true);
    setError(null);
    setResult(null);
    void renderJourneyPoster(input, ratio, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setResult({ url, ratio });
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setError(
          cause instanceof Error
            ? cause.message
            : "Chưa tạo được ảnh. Vui lòng thử lại.",
        );
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [input, ratio, attempt]);
  const ready = result?.ratio === ratio && !loading && !error;
  const download = () => {
    if (!ready || !result) return;
    const link = document.createElement("a");
    link.href = result.url;
    link.download = journeyImageFilename(input.title, ratio);
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast.success("Đã tạo ảnh PNG và gửi yêu cầu tải xuống.");
  };
  const dimensions = posterDimensions(ratio);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/65 backdrop-blur-sm" />
        <Dialog.Content
          onEscapeKeyDown={(event) => event.stopPropagation()}
          className="fixed inset-0 z-[111] flex flex-col bg-surface outline-none sm:inset-4 sm:rounded-3xl sm:border sm:border-border lg:inset-x-[max(1rem,calc((100vw-1060px)/2))]"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
            <div>
              <Dialog.Title className="font-bold text-ink">
                Xuất ảnh hành trình
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-ink-muted">
                Tạo poster để lưu kỷ niệm. Ảnh chỉ được tải về thiết bị của bạn.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Đóng xuất ảnh"
                className="rounded-xl p-3 text-ink-muted hover:bg-surface-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <fieldset className="mb-5 flex flex-wrap items-center gap-2">
              <legend className="mb-2 text-xs font-semibold text-ink">
                Tỷ lệ ảnh PNG
              </legend>
              {(["1:1", "4:5"] as const).map((value) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-xl border px-4 py-2.5 text-sm ${ratio === value ? "border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-400" : "border-border text-ink"}`}
                >
                  <input
                    type="radio"
                    name="journey-export-ratio"
                    value={value}
                    checked={ratio === value}
                    onChange={() => {
                      setLoading(true);
                      setRatio(value);
                    }}
                    className="mr-2 accent-green-600"
                  />
                  {value === "1:1" ? "Vuông 1:1" : "Dọc 4:5"}
                </label>
              ))}
              <span className="text-xs text-ink-muted">
                {dimensions.width} × {dimensions.height} px
              </span>
            </fieldset>
            <div
              aria-busy={loading}
              className="mx-auto flex min-h-64 max-w-[560px] items-center justify-center overflow-hidden rounded-2xl bg-surface-muted"
            >
              {loading && (
                <div
                  role="status"
                  className="flex flex-col items-center gap-3 px-6 py-24 text-center text-sm text-ink-muted"
                >
                  <Loader2 className="h-7 w-7 animate-spin text-brand-500" />
                  Đang dựng bản đồ và tạo ảnh…
                </div>
              )}
              {error && (
                <div role="alert" className="px-6 py-16 text-center">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {error}
                  </p>
                  <button
                    type="button"
                    onClick={() => setAttempt((n) => n + 1)}
                    className={`${secondaryClass} mt-4`}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Thử lại
                  </button>
                </div>
              )}
              {ready && result && (
                // The preview is the exact generated PNG, not a DOM approximation.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={result.url}
                  alt={`Poster hành trình ${input.title}`}
                  width={dimensions.width}
                  height={dimensions.height}
                  className="h-auto w-full"
                />
              )}
            </div>
            <p className="mx-auto mt-4 max-w-[560px] text-xs leading-relaxed text-ink-muted">
              Đường nối minh họa thứ tự điểm đến. Khoảng thời gian chỉ hiện khi
              mọi điểm đều có ngày ghé thăm. Ảnh giữ logo và nguồn dữ liệu bản
              đồ.
            </p>
            <p className="mx-auto mt-2 max-w-[560px] text-[11px] text-ink-muted">
              ©{" "}
              <a
                href="https://www.mapbox.com/about/maps/"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Mapbox
              </a>{" "}
              · ©{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                OpenStreetMap
              </a>{" "}
              ·{" "}
              <a
                href="https://apps.mapbox.com/feedback/"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Improve this map
              </a>
            </p>
          </div>
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-6">
            <Dialog.Close asChild>
              <button type="button" className={secondaryClass}>
                Quay lại
              </button>
            </Dialog.Close>
            <button
              type="button"
              disabled={!ready}
              onClick={download}
              className={primaryClass}
            >
              <Download className="h-4 w-4" />
              Tải PNG
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
