"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Share2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { getAuthSessionVersion } from "@/lib/api/client";
import type { ShareTarget } from "@/lib/messaging/share";
import { cn } from "@/lib/utils";

const ShareContentDialog = dynamic(
  () =>
    import("./ShareContentDialog").then((module) => module.ShareContentDialog),
  { ssr: false },
);

export function ShareContentButton({
  target,
  className,
  iconOnly = false,
  label = "Chia sẻ",
}: {
  target: ShareTarget;
  className?: string;
  iconOnly?: boolean;
  label?: string;
}) {
  const { user, isLoading } = useAuth();
  const requireAuth = useRequireAuth();
  const [opened, setOpened] = useState<{
    target: ShareTarget;
    viewer: string;
    session: number;
  } | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={isLoading}
        aria-busy={isLoading}
        aria-label={
          target.type === "shared_post"
            ? "Chia sẻ bài viết qua tin nhắn"
            : target.type === "shared_location"
              ? "Chia sẻ địa điểm qua tin nhắn"
              : "Chia sẻ hành trình qua tin nhắn"
        }
        title={target.restriction ?? label}
        className={cn(
          "inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg text-sm text-ink-muted transition-colors hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        onClick={() => {
          if (requireAuth("Đăng nhập để chia sẻ qua tin nhắn") && user)
            setOpened({
              target: structuredClone(target),
              viewer: user.id,
              session: getAuthSessionVersion(),
            });
        }}
      >
        <Share2 className="h-4 w-4 shrink-0" aria-hidden />
        {!iconOnly && <span>{label}</span>}
      </button>
      {opened &&
        user?.id === opened.viewer &&
        getAuthSessionVersion() === opened.session && (
          <ShareContentDialog
            key={`${opened.viewer}:${opened.session}:${opened.target.type}:${opened.target.id}`}
            {...opened}
            onClose={() => setOpened(null)}
          />
        )}
    </>
  );
}
