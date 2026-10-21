"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/constants";
import { canGoBackWithinApp } from "@/lib/navigation";

export function PostBackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (canGoBackWithinApp()) router.back();
        else router.replace(ROUTES.feed);
      }}
      className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-surface-elevated px-3 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Quay lại
    </button>
  );
}
