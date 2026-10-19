"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { useUnreadNotificationCount } from "@/hooks/useUnreadNotificationCount";
import { cn } from "@/lib/utils";
import { NotificationList } from "./NotificationList";

/**
 * Bell icon with the unread counter. Clicking it opens the notification list in a popover over
 * the page; clicking the bell again, clicking anywhere outside, or pressing Esc closes it.
 * Style the button from outside through `className`.
 */
export function NotificationBell({ className }: { className?: string }) {
  const count = useUnreadNotificationCount();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Navigating anywhere closes the popover.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={count > 0 ? `Thông báo, ${count} chưa đọc` : "Thông báo"}
        className={cn("relative", className)}
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:ring-surface">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        // Phones: full width under the bar. Larger screens: anchored to the bell.
        <div
          role="dialog"
          aria-label="Thông báo"
          className="fixed inset-x-3 top-16 z-50 overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96"
        >
          <div className="border-b border-border px-4 py-3 text-sm font-semibold text-ink">Thông báo</div>
          <div className="max-h-[70vh] overflow-y-auto">
            <NotificationList variant="popover" onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}