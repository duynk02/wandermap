"use client";

import { useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, Route, X } from "lucide-react";
import { ROUTES } from "@/constants";
import { getPostImageUrl } from "@/lib/utils";
import type { JourneyPost } from "@/types";
import { JourneyMapCredits } from "./JourneyMapCredits";

/** Shared by the Feed, profile grid and post detail, with the usual post actions outside. */
export function JourneyPostContent({ post }: { post: JourneyPost }) {
  const [open, setOpen] = useState(false);
  const journey = post.journey;
  const image = post.images[0];
  return (
    <section className="mt-3" aria-label="Hành trình được chia sẻ">
      {image && (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Phóng to ảnh hành trình"
            className="block w-full bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getPostImageUrl(image)}
              alt={`Ảnh hành trình ${journey.title}`}
              loading="lazy"
              className="mx-auto max-h-[600px] w-full object-contain"
            />
          </button>
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-[120] bg-black/90" />
              <Dialog.Content className="fixed inset-4 z-[121] flex items-center justify-center outline-none">
                <Dialog.Title className="sr-only">
                  Ảnh hành trình {journey.title}
                </Dialog.Title>
                <Dialog.Description className="sr-only">
                  Ảnh tại thời điểm chia sẻ. Mở hành trình để xem tuyến cập
                  nhật.
                </Dialog.Description>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getPostImageUrl(image)}
                  alt={`Ảnh hành trình ${journey.title}`}
                  className="max-h-full max-w-full object-contain"
                />
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label="Đóng ảnh hành trình"
                    className="absolute right-0 top-0 rounded-full bg-black/60 p-3 text-white"
                  >
                    <X className="h-6 w-6" />
                  </button>
                </Dialog.Close>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </>
      )}
      <div className="border-y border-border bg-brand-500/5 p-4">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
          <Route className="h-4 w-4" />
          WanderMap Journey · {journey.stop_count} điểm đến
        </p>
        <h3 className="mt-2 break-words text-lg font-bold text-ink">
          {journey.title}
        </h3>
        <p className="mt-1 break-words text-xs text-ink-muted">
          {journey.preview_names.join(" → ")}
          {journey.stop_count > journey.preview_names.length ? " → …" : ""}
        </p>
        {(journey.status !== "published" ||
          journey.visibility !== "public") && (
          <p className="mt-2 text-xs text-ink-muted">
            Hành trình đang riêng tư hoặc là bản nháp. Chỉ bạn xem được bài này.
          </p>
        )}
        {journey.revision !== post.preview_revision && (
          <p className="mt-2 text-xs text-ink-muted">
            Ảnh tại thời điểm chia sẻ. Hành trình đã được cập nhật.
          </p>
        )}
        <Link
          href={ROUTES.journey(journey.id)}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600"
        >
          Xem hành trình
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
      <JourneyMapCredits />
    </section>
  );
}
