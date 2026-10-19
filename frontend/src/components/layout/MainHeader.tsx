"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Home, PlusSquare } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { NotificationBell } from "@/components/notification/NotificationBell";
import { ROUTES } from "@/constants";
import { cn, getAvatarUrl } from "@/lib/utils";

const NAV = [
  { href: ROUTES.feed, label: "Bản tin", Icon: Home },
  { href: ROUTES.explore, label: "Khám phá", Icon: Compass },
] as const;

const itemClass =
  "flex h-10 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors hover:bg-surface-muted";

/** Top navigation of the social pages (feed, notifications). The map page has its own floating bar. */
export function MainHeader() {
  const pathname = usePathname();
  const { isAuthenticated, profile } = useAuth();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-1 px-4">
        <Link href={ROUTES.feed} className="mr-auto flex items-center gap-2 text-lg font-bold text-ink">
          {/* <span aria-hidden>🧭</span> */}
          <span className="hidden sm:inline">WanderMap</span>
        </Link>

        <nav aria-label="Điều hướng chính" className="flex items-center gap-1">
          {NAV.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              aria-label={label}
              className={cn(itemClass, isActive(href) ? "text-brand-600" : "text-ink-muted hover:text-ink")}
            >
              <Icon className="h-5 w-5" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}

          {isAuthenticated ? (
            <>
              <Link href={ROUTES.newPost} aria-label="Đăng bài" className={cn(itemClass, "text-ink-muted hover:text-ink")}>
                <PlusSquare className="h-5 w-5" />
                <span className="hidden sm:inline">Đăng bài</span>
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