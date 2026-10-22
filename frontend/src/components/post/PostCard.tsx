"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Heart, Bookmark, Star, MapPin } from "lucide-react";
import { motion } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { setPostLiked } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { timeAgo, formatCount, getAvatarUrl, getPostImageUrl, cn } from "@/lib/utils";
import { ROUTES, QUERY_KEYS } from "@/constants";
import type { Post } from "@/types";
import { JourneyPostCard } from "@/components/journey/JourneyPostCard";

interface PostCardProps {
  post: Post;
  compact?: boolean; // Smaller version for drawer preview
}

// Uploaded images are already resized WebP served by our own API, so the Next.js optimizer adds nothing
// (and would need the API host in `remotePatterns`). SVG avatars cannot go through the optimizer at all.
const skipOptimizer = (src: string) =>
  /\/uploads\/[0-9a-f]{2}\/[0-9a-f]{32}\.webp$/.test(src) || src.includes("api.dicebear.com");


export function PostCard({ post, compact = false }: PostCardProps) {
  return post.post_type === "journey" ? <JourneyPostCard post={post} resolveViewer /> : <LocationPostCard post={post} compact={compact} />;
}

function LocationPostCard({ post, compact = false }: PostCardProps & { post: import("@/types").LocationPost }) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const [optimisticLiked, setOptimisticLiked] = useState(post.is_liked ?? false);
  const [optimisticCount, setOptimisticCount] = useState(post.likes_count);

  const likeMutation = useMutation({
    mutationFn: (nextLiked: boolean) => setPostLiked(post.id, nextLiked),
    onMutate: (nextLiked) => {
      // Optimistic update — instant UI feedback
      const previous = { liked: optimisticLiked, count: optimisticCount };
      setOptimisticLiked(nextLiked);
      setOptimisticCount((count) => Math.max(0, count + (nextLiked ? 1 : -1)));
      return previous;
    },
    onError: (_error, _nextLiked, previous) => {
      // Rollback on failure
      if (previous) {
        setOptimisticLiked(previous.liked);
        setOptimisticCount(previous.count);
      }
      toast.error("Không thể cập nhật lượt thích");
    },
    onSuccess: (result) => {
      // The API returns the authoritative counter
      setOptimisticLiked(result.liked);
      setOptimisticCount(result.likes_count);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.posts.byId(post.id) });
    },
  });

  const firstImage = post.images?.[0];

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group overflow-hidden rounded-2xl bg-surface-elevated transition-shadow hover:shadow-lg",
        compact ? "flex gap-3" : ""
      )}
    >
      {/* Image */}
      {firstImage && (
        <Link href={ROUTES.post(post.id)} className={cn(compact ? "shrink-0" : "block")}>
          <div className={cn(
            "relative overflow-hidden bg-surface-muted",
            compact ? "h-20 w-20 rounded-xl" : "aspect-[4/3] w-full"
          )}>
            <Image
              src={getPostImageUrl(firstImage)}
              unoptimized={skipOptimizer(getPostImageUrl(firstImage))}
              alt={post.content.slice(0, 50)}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              sizes={compact ? "80px" : "(max-width: 768px) 100vw, 50vw"}
            />
            {/* Rating badge */}
            <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-sm">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              {post.rating}
            </div>
          </div>
        </Link>
      )}

      {/* Content */}
      <div className={cn("flex flex-col", compact ? "flex-1 min-w-0 py-1" : "p-4")}>
        {/* Author */}
        {post.author && (
          <Link href={ROUTES.profile(post.author.username)} className="flex items-center gap-2 mb-2">
            <Image
              src={getAvatarUrl(post.author.avatar_url, post.author.username)}
              alt={post.author.display_name}
              width={compact ? 20 : 28}
              height={compact ? 20 : 28}
              className="rounded-full object-cover"
              unoptimized={skipOptimizer(getAvatarUrl(post.author.avatar_url, post.author.username))}
            />
            <span className={cn("font-medium text-ink hover:text-brand-500 transition-colors", compact ? "text-xs" : "text-sm")}>
              {post.author.display_name}
            </span>
            <span className="text-xs text-ink-subtle">{timeAgo(post.created_at)}</span>
          </Link>
        )}

        {/* Post text */}
        <Link href={ROUTES.post(post.id)}>
          <p className={cn(
            "text-ink-muted",
            compact ? "line-clamp-2 text-xs" : "line-clamp-3 text-sm"
          )}>
            {post.content}
          </p>
        </Link>

        {/* Location tag */}
        {post.location && !compact && (
          <Link href={ROUTES.location(post.location.id)} className="mt-2 flex items-center gap-1 text-xs text-brand-500 hover:text-brand-600">
            <MapPin className="h-3 w-3" />
            {post.location.name}
          </Link>
        )}

        {/* Actions */}
        {!compact && (
          <div className="mt-3 flex items-center gap-4">
            <motion.button
              whileTap={{ scale: 0.85 }}
              onClick={() => isAuthenticated && likeMutation.mutate(!optimisticLiked)}
              className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-red-500 transition-colors"
              disabled={!isAuthenticated || likeMutation.isPending}
            >
              <Heart className={cn("h-4 w-4", optimisticLiked && "fill-red-500 text-red-500")} />
              {formatCount(optimisticCount)}
            </motion.button>

            <button className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-brand-500 transition-colors">
              <Bookmark className="h-4 w-4" />
              {formatCount(post.saves_count)}
            </button>
          </div>
        )}
      </div>
    </motion.article>
  );
}
