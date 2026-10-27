"use client";

import { useState } from "react";
import { MediaImage as Image } from "@/components/ui/MediaImage";
import Link from "next/link";
import {
  ArrowUpRight,
  Bookmark,
  Heart,
  MessageCircle,
  RefreshCw,
  Route,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QUERY_KEYS, ROUTES } from "@/constants";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { setPostLiked } from "@/lib/api";
import { usePostSave } from "@/hooks/usePostSave";
import { ShareContentButton } from "@/components/messaging/ShareContentButton";
import { postShareTarget } from "@/lib/messaging/share";
import {
  cn,
  formatCount,
  getAvatarUrl,
  getPostImageUrl,
  timeAgo,
} from "@/lib/utils";
import type { JourneyPost } from "@/types";
import { JourneyMapCredits } from "./JourneyMapCredits";

/** A grid-sized preview; the full Feed card and comments remain on the post detail page. */
export function JourneyPostGridCard({ post }: { post: JourneyPost }) {
  const cache = useQueryClient();
  const requireAuth = useRequireAuth();
  const [liked, setLiked] = useState(post.is_liked ?? false);
  const [likesCount, setLikesCount] = useState(post.likes_count);
  const { saved, savesCount, saveMutation: save } = usePostSave(post);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const journey = post.journey;
  const image = post.images[0];
  const privateJourney =
    journey.visibility !== "public" || journey.status !== "published";
  const updated = journey.revision !== post.preview_revision;
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: QUERY_KEYS.posts.all });
  };
  const like = useMutation({
    mutationFn: (next: boolean) => setPostLiked(post.id, next),
    onMutate: (next) => {
      const previous = { liked, count: likesCount };
      setLiked(next);
      setLikesCount((count) => Math.max(0, count + (next ? 1 : -1)));
      return previous;
    },
    onSuccess: (result) => {
      setLiked(result.liked);
      setLikesCount(result.likes_count);
      refresh();
    },
    onError: (_cause, _next, previous) => {
      if (previous) {
        setLiked(previous.liked);
        setLikesCount(previous.count);
      }
      toast.error("Không thể cập nhật lượt thích");
    },
  });
  return (
    <article
      className="group flex h-full min-w-0 flex-col overflow-hidden rounded-2xl bg-surface-elevated transition-shadow hover:shadow-lg"
      aria-label={`Bài hành trình ${journey.title}`}
    >
      <Link
        href={ROUTES.post(post.id)}
        aria-label={`Xem bài chia sẻ hành trình ${journey.title}`}
        className="relative block aspect-[4/3] shrink-0 overflow-hidden bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
      >
        {image && image !== failedImage ? (
          <Image
            src={getPostImageUrl(image)}
            alt={`Ảnh hành trình ${journey.title}`}
            fill
            unoptimized
            sizes="(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw"
            className="object-contain"
            onError={() => setFailedImage(image)}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-brand-500/5">
            <Route className="h-12 w-12 text-brand-500/40" aria-hidden />
          </div>
        )}
        <span className="pointer-events-none absolute left-2 top-2 inline-flex max-w-[90%] items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
          <Route className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">
            Hành trình · {journey.stop_count} điểm đến
            {privateJourney ? " · Chỉ bạn" : ""}
          </span>
        </span>
      </Link>
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <div className="mb-2 flex h-7 min-w-0 items-center gap-2">
          {post.author && (
            <>
              <Link
                href={ROUTES.profile(post.author.username)}
                className="shrink-0"
                aria-label={`Hồ sơ ${post.author.display_name}`}
              >
                <Image
                  src={getAvatarUrl(
                    post.author.avatar_url,
                    post.author.username,
                  )}
                  alt=""
                  width={28}
                  height={28}
                  unoptimized
                  className="rounded-full object-cover"
                />
              </Link>
              <Link
                href={ROUTES.profile(post.author.username)}
                className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:text-brand-500"
              >
                {post.author.display_name}
              </Link>
            </>
          )}
          <span className="shrink-0 text-[10px] text-ink-subtle">
            {timeAgo(post.created_at)}
          </span>
        </div>
        <div className="flex h-20 min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link
              href={ROUTES.post(post.id)}
              className="min-w-0 flex-1"
              title={journey.title}
            >
              <h3 className="truncate text-sm font-semibold leading-5 text-ink hover:text-brand-500">
                {journey.title}
              </h3>
            </Link>
            {updated && (
              <RefreshCw
                className="h-3 w-3 shrink-0 text-ink-muted"
                role="img"
                aria-label="Ảnh tại thời điểm chia sẻ; hành trình đã được cập nhật"
              />
            )}
          </div>
          {post.content && (
            <Link href={ROUTES.post(post.id)} className="mt-1 min-w-0">
              <p className="line-clamp-2 break-words text-xs leading-4 text-ink-muted">
                {post.content}
              </p>
            </Link>
          )}
          <div className="mt-auto pt-1">
            <JourneyMapCredits compact />
          </div>
        </div>
        <div className="mt-auto flex min-w-0 items-center justify-between gap-1 pt-3">
          <div className="flex items-center gap-1">
            <ShareContentButton target={postShareTarget(post)} iconOnly className="min-h-9" />
            <button
              type="button"
              aria-label={liked ? "Bỏ thích bài đăng" : "Thích bài đăng"}
              aria-pressed={liked}
              disabled={like.isPending}
              onClick={() => {
                if (requireAuth("Đăng nhập để thích bài đăng"))
                  like.mutate(!liked);
              }}
              className="inline-flex min-h-9 min-w-8 items-center justify-center gap-1 text-xs text-ink-muted transition-colors hover:text-red-500 disabled:opacity-50"
            >
              <Heart
                className={cn("h-4 w-4", liked && "fill-red-500 text-red-500")}
              />
              {formatCount(likesCount)}
            </button>
            <Link
              href={ROUTES.post(post.id)}
              aria-label={`Xem bình luận bài đăng, ${post.comments_count} bình luận`}
              className="inline-flex min-h-9 min-w-8 items-center justify-center gap-1 text-xs text-ink-muted hover:text-brand-500"
            >
              <MessageCircle className="h-4 w-4" />
              {formatCount(post.comments_count)}
            </Link>
            <button
              type="button"
              aria-label={saved ? "Bỏ lưu bài đăng" : "Lưu bài đăng"}
              aria-pressed={saved}
              title={`${savesCount} lượt lưu`}
              disabled={save.isPending}
              onClick={() => {
                if (requireAuth("Đăng nhập để lưu bài đăng"))
                  save.mutate(!saved);
              }}
              className="inline-flex min-h-9 min-w-7 items-center justify-center text-ink-muted transition-colors hover:text-brand-500 disabled:opacity-50"
            >
              <Bookmark
                className={cn(
                  "h-4 w-4",
                  saved && "fill-brand-500 text-brand-500",
                )}
              />
            </button>
          </div>
          <Link
            href={ROUTES.journey(journey.id)}
            className="inline-flex min-h-9 shrink-0 items-center gap-0.5 whitespace-nowrap text-[11px] font-medium text-brand-500 hover:text-brand-600"
          >
            Xem hành trình
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      </div>
    </article>
  );
}
