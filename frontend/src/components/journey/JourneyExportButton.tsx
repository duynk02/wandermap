"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Download } from "lucide-react";
import type { JourneyPosterInput } from "@/lib/journey-export/model";

const JourneyExportDialog = dynamic(
  () =>
    import("./JourneyExportDialog").then(
      (module) => module.JourneyExportDialog,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        className="fixed inset-0 z-[111] grid place-items-center bg-black/60"
      >
        <p className="rounded-2xl bg-surface px-6 py-4 text-sm text-ink">
          Đang mở trình xuất ảnh…
        </p>
      </div>
    ),
  },
);

export function JourneyExportButton({
  input,
  disabled = false,
  className,
}: {
  input: JourneyPosterInput;
  disabled?: boolean;
  className?: string;
}) {
  const [snapshot, setSnapshot] = useState<JourneyPosterInput | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-label="Xuất ảnh hành trình"
        onClick={() => setSnapshot(structuredClone(input))}
        className={
          className ??
          "inline-flex min-h-11 items-center gap-2 rounded-xl p-3 text-ink-muted hover:bg-surface-muted disabled:opacity-50"
        }
      >
        <Download className="h-4 w-4" />
        <span className="hidden sm:inline">Xuất ảnh</span>
      </button>
      {snapshot && (
        <JourneyExportDialog
          input={snapshot}
          onClose={() => {
            setSnapshot(null);
            requestAnimationFrame(() => button.current?.focus());
          }}
        />
      )}
    </>
  );
}
