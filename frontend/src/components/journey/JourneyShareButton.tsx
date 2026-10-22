"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Share2 } from "lucide-react";
import type { Journey } from "@/types";

const JourneyShareDialog = dynamic(
  () =>
    import("./JourneyShareDialog").then((module) => module.JourneyShareDialog),
  { ssr: false },
);

export function JourneyShareButton({
  journey,
  onEdit,
}: {
  journey: Journey;
  onEdit: () => void;
}) {
  // Keep one saved revision throughout the preview, even if a background query updates.
  const [snapshot, setSnapshot] = useState<Journey | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => setSnapshot(structuredClone(journey))}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold backdrop-blur hover:bg-white/25"
      >
        <Share2 className="h-4 w-4" />
        Chia sẻ lên Feed
      </button>
      {snapshot && (
        <JourneyShareDialog
          journey={snapshot}
          onClose={() => setSnapshot(null)}
          onEdit={() => {
            setSnapshot(null);
            onEdit();
          }}
        />
      )}
    </>
  );
}
