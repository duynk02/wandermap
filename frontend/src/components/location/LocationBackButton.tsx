"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ROUTES } from "@/constants";
import { canGoBackWithinApp } from "@/lib/navigation";

export function LocationBackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (canGoBackWithinApp()) router.back();
        else router.replace(ROUTES.explore);
      }}
      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Quay lại
    </button>
  );
}
