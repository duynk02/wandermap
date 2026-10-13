import { PostCard } from "./PostCard";
import type { Post } from "@/types";

interface PostGridProps {
  posts: Post[];
}

export function PostGrid({ posts }: PostGridProps) {
  if (!posts.length) {
    return (
      <div className="py-20 text-center text-ink-muted">
        <p className="text-4xl mb-3">📍</p>
        <p className="font-medium">Chưa có bài đăng nào</p>
        <p className="text-sm mt-1">Hãy là người đầu tiên chia sẻ về địa điểm này!</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}
