import type { Metadata } from "next";
import { FeedList } from "@/components/feed/FeedList";

export const metadata: Metadata = {
  title: "Bản tin",
  description: "Lướt các bài đăng du lịch mới nhất của cộng đồng WanderMap",
};

// Posts load on the client so the first request can carry the session (likes are per viewer).
export default function FeedPage() {
  return <FeedList />;
}