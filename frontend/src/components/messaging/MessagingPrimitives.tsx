"use client";

import type { ReactNode } from "react";
import { Compass } from "lucide-react";
import { cn, getAvatarUrl } from "@/lib/utils";
import type { MessagingProfile } from "@/types/messaging";

export function MessagingAvatar({
  profile,
  className,
}: {
  profile: MessagingProfile;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={getAvatarUrl(profile.avatar_url, profile.username)}
      alt=""
      width={44}
      height={44}
      className={cn(
        "h-11 w-11 shrink-0 rounded-full bg-surface-muted object-cover",
        className,
      )}
    />
  );
}

export function MessagingEmpty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
        <Compass className="h-8 w-8" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-2 max-w-xs text-sm leading-6 text-ink-muted">
        {children}
      </div>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export const messagingButtonClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
