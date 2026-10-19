import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { FeedList } from "@/components/feed/FeedList";
import { ROUTES } from "@/constants";

export const metadata: Metadata = {
  title: "Bản tin",
  description: "Lướt các bài đăng du lịch mới nhất của cộng đồng WanderMap",
};

// Posts load on the client so the first request can carry the session (likes are per viewer).
export default function FeedPage() {
  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <Link
            href={ROUTES.explore}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            Bản đồ
          </Link>
          <h1 className="text-lg font-bold text-ink">Bản tin</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <FeedList />
      </main>
    </div>
  );
}