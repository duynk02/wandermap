"use client";

import { useEffect } from "react";
import { trackNavigationHistory } from "@/lib/navigation";

export function NavigationHistory() {
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    // Compose with Next's native-history support after its mount effects finish.
    queueMicrotask(() => {
      if (!cancelled) cleanup = trackNavigationHistory();
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);
  return null;
}
