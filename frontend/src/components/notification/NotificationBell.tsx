"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useUnreadNotificationCount } from "@/hooks/useUnreadNotificationCount";
import { ROUTES } from "@/constants";
import { cn } from "@/lib/utils";

/** Bell icon with the unread counter. Style the link from outside through `className`. */
export function NotificationBell({ className }: { className?: string }) {
  const count = useUnreadNotificationCount();

  return (
    <Link
      href={ROUTES.notifications}
      aria-label={count > 0 ? `Thông báo, ${count} chưa đọc` : "Thông báo"}
      className={cn("relative", className)}
    >
      <Bell className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:ring-surface">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}