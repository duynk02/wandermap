"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowLeft, Settings, Link2, LogOut, Check } from "lucide-react";
import { signOut, useAuth } from "@/hooks/useAuth";

const buttonClass =
  "flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white " +
  "backdrop-blur transition hover:bg-white/20 focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-white/60";

const itemClass =
  "flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-sm " +
  "text-gray-700 outline-none data-[highlighted]:bg-gray-100";

export function BackButton() {
  const router = useRouter();

  const goBack = () => {
    // Nếu mở trực tiếp trang này (không có lịch sử) thì về trang khám phá.
    if (window.history.length > 1) router.back();
    else router.push("/explore");
  };

  return (
    <button type="button" onClick={goBack} className={buttonClass} aria-label="Quay lại">
      <ArrowLeft className="h-5 w-5" />
    </button>
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
      /* signOut đã reset store trong finally, vẫn tiếp tục chuyển trang */
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