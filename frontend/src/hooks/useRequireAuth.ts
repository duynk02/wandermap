"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/constants";

/**
 * Returns a guard for actions that need an account. For guests it shows a clear message with a
 * "Đăng nhập" button that goes to the login page and brings them back to the current page
 * (`next` is validated by safeNext on the login side).
 *
 *   if (!requireAuth("Đăng nhập để thích bình luận")) return;
 */
export function useRequireAuth() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  return useCallback(
    (message = "Bạn cần đăng nhập để thực hiện thao tác này") => {
      if (isAuthenticated) return true;
      const next = `${window.location.pathname}${window.location.search}`;
      toast(message, {
        id: "auth-required", // one toast at a time, however many times the guest taps
        action: {
          label: "Đăng nhập",
          onClick: () => router.push(`${ROUTES.login}?next=${encodeURIComponent(next)}`),
        },
      });
      return false;
    },
    [isAuthenticated, router]
  );
}

/** Part of comment query keys: is_liked depends on who is viewing. */
export function useViewerKey() {
  const { user } = useAuth();
  return user?.id ?? "guest";
}