"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Home, MessageCircle, PlusSquare } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useMessagingUnreadCount } from "@/hooks/useMessagingNavigation";
import { NotificationBell } from "@/components/notification/NotificationBell";
import { ThemeSelector } from "@/components/layout/ThemeSelector";
import { ROUTES } from "@/constants";
import { cn, getAvatarUrl } from "@/lib/utils";

const NAV = [
  { href: ROUTES.feed, label: "Bản tin", Icon: Home },
  { href: ROUTES.explore, label: "Khám phá", Icon: Compass },
  { href: ROUTES.messages, label: "Tin nhắn", Icon: MessageCircle },
] as const;

const itemClass =
  "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 md:w-auto md:gap-2 md:px-3";

/** Top navigation of the social pages (feed, notifications). The map page has its own floating bar. */
export function MainHeader() {
  const pathname = usePathname();
  const { isAuthenticated, profile } = useAuth();
  const unreadConversations = useMessagingUnreadCount();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-1 px-2 sm:px-4">
        <Link href={ROUTES.feed} className="mr-auto hidden items-center gap-2 text-lg font-bold text-ink lg:flex">
          {/* <span aria-hidden>🧭</span> */}
          <span>WanderMap</span>
        </Link>

        <nav aria-label="Điều hướng chính" className="flex w-full items-center justify-between gap-0 lg:w-auto lg:gap-1">
          {NAV.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              aria-label={href === ROUTES.messages && unreadConversations > 0 ? `${label}, ${unreadConversations} cuộc trò chuyện chưa đọc` : label}
              title={label}
              className={cn(itemClass, isActive(href) ? "text-brand-600" : "text-ink-muted hover:text-ink")}
            >
              <span className="relative">
                <Icon className="h-5 w-5" aria-hidden />
                {href === ROUTES.messages && unreadConversations > 0 && (
                  <span aria-hidden className="absolute -right-2 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-surface">
                    {unreadConversations > 99 ? "99+" : unreadConversations}
                  </span>
                )}
              </span>
              <span className="hidden md:inline">{label}</span>
            </Link>
          ))}

          <ThemeSelector className="w-10 px-0 md:w-auto md:px-3 [&>span]:hidden md:[&>span]:inline" />

          {isAuthenticated ? (
            <>
              <Link href={ROUTES.newPost} aria-label="Đăng bài" className={cn(itemClass, "text-ink-muted hover:text-ink")}>
                <PlusSquare className="h-5 w-5" />
                <span className="hidden md:inline">Đăng bài</span>
              </Link>
              <NotificationBell
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-surface-muted",
                  isActive(ROUTES.notifications) ? "text-brand-600" : "text-ink-muted hover:text-ink"
                )}
              />
              {profile && (
                <Link href={ROUTES.profile(profile.username)} aria-label="Hồ sơ cá nhân" className="ml-1 shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getAvatarUrl(profile.avatar_url, profile.username)}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover"
                  />
                </Link>
              )}
            </>
          ) : (
            <Link
              href={`${ROUTES.login}?next=${encodeURIComponent(pathname)}`}
              className="ml-1 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
            >
              Đăng nhập
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
