"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowLeft, Settings, Link2, LogOut, Check, Newspaper, Compass, MessageCircle, LoaderCircle } from "lucide-react";
import { signOut, useAuth } from "@/hooks/useAuth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, followUser, unfollowUser } from "@/lib/api";
import { QUERY_KEYS, ROUTES } from "@/constants";
import { canGoBackWithinApp } from "@/lib/navigation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useStartConversation } from "@/hooks/useMessagingNavigation";
import { getAuthSessionVersion } from "@/lib/api/client";
import { useFollowStore } from "@/stores/followStore";
import { useAuthStore } from "@/stores/authStore";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { Profile } from "@/types";

const buttonClass =
  "flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white " +
  "backdrop-blur transition hover:bg-white/20 focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-white/60";

const itemClass =
  "flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-sm " +
  "text-gray-700 outline-none data-[highlighted]:bg-gray-100";

export function BackButton() {
  const router = useRouter();

  const goBack = () => {
    if (canGoBackWithinApp()) router.back();
    else router.replace(ROUTES.feed);
  };

  return (
    <button type="button" onClick={goBack} className={buttonClass} aria-label="Quay lại">
      <ArrowLeft className="h-5 w-5" />
    </button>
  );
}

export function ProfileNavigation() {
  return (
    <nav aria-label="Điều hướng hồ sơ" className="flex items-center gap-1">
      <Link href={ROUTES.feed} aria-label="Bản tin" title="Bản tin" className={buttonClass}>
        <Newspaper className="h-5 w-5" aria-hidden />
      </Link>
      <Link href={ROUTES.explore} aria-label="Khám phá" title="Khám phá" className={buttonClass}>
        <Compass className="h-5 w-5" aria-hidden />
      </Link>
    </nav>
  );
}

export function ProfileFollowButton({ profile, loading }: { profile: Profile; loading: boolean }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const requireAuth = useRequireAuth();
  const startConversation = useStartConversation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const key = user ? `${user.id}:${profile.id}` : null;
  const override = useFollowStore((state) => key ? state.overrides[key] : undefined);
  const followed = !!user && (override ?? profile.is_following ?? false);
  const mutation = useMutation({
    mutationFn: (next: boolean) => next ? followUser(profile.username) : unfollowUser(profile.username),
    onSuccess: (result, next) => {
      if (key && useAuthStore.getState().user?.id === user?.id) {
        useFollowStore.getState().setFollowing(key, next);
      }
      setConfirmOpen(false);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.profiles.byUsername(profile.username) });
      router.refresh();
      if (result.changed) toast.success(next ? `Đã theo dõi ${profile.display_name}` : `Đã hủy theo dõi ${profile.display_name}`);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Không thể cập nhật theo dõi lúc này"),
  });

  if (isLoading || user?.id === profile.id) return null;

  return (
    <>
      <button
        type="button"
        disabled={startConversation.isPending}
        aria-busy={startConversation.isPending}
        onClick={() => {
          if (!requireAuth("Đăng nhập để nhắn tin")) return;
          const owner = useAuthStore.getState().user?.id;
          const session = getAuthSessionVersion();
          const current = () => !!owner && useAuthStore.getState().user?.id === owner && getAuthSessionVersion() === session;
          startConversation.mutate(profile.id, {
            onSuccess: (result) => {
              if (current()) router.push(ROUTES.conversation(result.conversation.id));
            },
            onError: (error) => {
              if (current()) toast.error(error instanceof ApiError && error.status === 403
                ? "Bạn chưa thể nhắn tin với người này."
                : error instanceof ApiError && error.status === 404
                  ? "Người nhận hiện không khả dụng."
                  : "Chưa thể mở cuộc trò chuyện. Vui lòng thử lại.");
            },
          });
        }}
        className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-brand-800 transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-700 disabled:opacity-60"
      >
        {startConversation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <MessageCircle className="h-4 w-4" aria-hidden />}
        {startConversation.isPending ? "Đang mở…" : "Nhắn tin"}
      </button>
      <button type="button" disabled={loading || mutation.isPending} onClick={() => {
        if (!requireAuth("Đăng nhập để theo dõi")) return;
        if (followed) setConfirmOpen(true);
        else mutation.mutate(true);
      }} className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60">
        {loading || mutation.isPending ? "Đang xử lý…" : followed ? "Đang theo dõi" : "Theo dõi"}
      </button>
      <ConfirmDialog open={confirmOpen} title={`Hủy theo dõi ${profile.display_name}?`} confirmLabel="Hủy theo dõi" cancelLabel="Quay lại" pending={mutation.isPending} onConfirm={() => mutation.mutate(false)} onCancel={() => setConfirmOpen(false)} />
    </>
  );
}

export function SettingsMenu({ profileId }: { profileId: string }) {
  const router = useRouter();
  const { profile } = useAuth();
  const [copied, setCopied] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Chỉ hiện menu cài đặt trên trang của chính mình.
  if (profile?.id !== profileId) return null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* trình duyệt chặn clipboard */
    }
  };

  const handleSignOut = async () => {
    setLoggingOut(true);
    try {
      await signOut();
    } catch {
      /* signOut đã reset store trước request, vẫn tiếp tục chuyển trang */
    }
    router.replace("/auth/login");
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={buttonClass} aria-label="Cài đặt">
          <Settings className="h-5 w-5" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-[220px] rounded-xl border border-gray-100 bg-white p-1.5 shadow-xl"
        >
          <DropdownMenu.Item
            className={itemClass}
            onSelect={(e) => {
              e.preventDefault(); // giữ menu mở để hiện trạng thái "Đã sao chép"
              copyLink();
            }}
          >
            {copied ? <Check className="h-4 w-4 text-green-600" /> : <Link2 className="h-4 w-4" />}
            {copied ? "Đã sao chép" : "Sao chép liên kết hồ sơ"}
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px bg-gray-100" />

          <DropdownMenu.Item
            className={`${itemClass} text-red-600 data-[highlighted]:bg-red-50`}
            disabled={loggingOut}
            onSelect={handleSignOut}
          >
            <LogOut className="h-4 w-4" />
            {loggingOut ? "Đang đăng xuất..." : "Đăng xuất"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
