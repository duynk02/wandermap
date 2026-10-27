"use client";

import { MediaImage } from "@/components/ui/MediaImage";
import { useState } from "react";
import Link from "next/link";
import { Bookmark, Heart, MapPin, MessageCircle, Star } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { setPostLiked } from "@/lib/api";
import { usePostSave } from "@/hooks/usePostSave";
import { JourneyPostContent } from "@/components/journey/JourneyPostContent";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { CommentSection } from "@/components/comment/CommentSection";
import { FollowButton, FollowedBadge } from "@/components/post/FollowButton";
import { QUERY_KEYS, ROUTES } from "@/constants";
import { cn, formatCount, getAvatarUrl, getPostImageUrl, timeAgo } from "@/lib/utils";
import type { Post } from "@/types";
import { ShareContentButton } from "@/components/messaging/ShareContentButton";
import { postShareTarget } from "@/lib/messaging/share";

const MAX_VISIBLE_IMAGES = 4;

/**
 * Managed images load authorized bytes; legacy public images keep their existing URLs.
 * Each image links to the post detail page.
 */
function PostImages({ images, postId }: { images: string[]; postId: string }) {
    const shown = images.slice(0, MAX_VISIBLE_IMAGES);
    const extra = images.length - shown.length;
    if (shown.length === 0) return null;

    return (
        <div className={cn("grid gap-1", shown.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
            {shown.map((src, index) => (
                <Link
                    key={`${src}-${index}`}
                    href={ROUTES.post(postId)}
                    aria-label="Xem chi tiết bài đăng"
                    className={cn(
                        "relative block overflow-hidden bg-surface-muted",
                        shown.length === 1 && "aspect-[4/3]",
                        shown.length === 2 && "aspect-square",
                        shown.length === 3 && (index === 0 ? "col-span-2 aspect-[16/9]" : "aspect-square"),
                        shown.length === 4 && "aspect-square"
                    )}
                >

                    <MediaImage src={getPostImageUrl(src)} alt={`Ảnh ${index + 1}`} loading="lazy" className="h-full w-full object-cover" />
                    {extra > 0 && index === shown.length - 1 && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-semibold text-white">
                            +{extra}
                        </span>
                    )}
                </Link>
            ))}
        </div>
    );
}

export function FeedPostCard({ post }: { post: Post }) {
    const queryClient = useQueryClient();
    const requireAuth = useRequireAuth();

    const [liked, setLiked] = useState(post.is_liked ?? false);
    const [likesCount, setLikesCount] = useState(post.likes_count);
    const [commentsOpen, setCommentsOpen] = useState(false);
    const [commentsCount, setCommentsCount] = useState(post.comments_count ?? 0);
    const { saved, savesCount, saveMutation } = usePostSave(post);

    // Same behaviour as PostCard: optimistic, rolled back on failure, then the API's counter wins.
    const likeMutation = useMutation({
        mutationFn: (nextLiked: boolean) => setPostLiked(post.id, nextLiked),
        onMutate: (nextLiked) => {
            const previous = { liked, count: likesCount };
            setLiked(nextLiked);
            setLikesCount((count) => Math.max(0, count + (nextLiked ? 1 : -1)));
            return previous;
        },
        onError: (_error, _nextLiked, previous) => {
            if (previous) {
                setLiked(previous.liked);
                setLikesCount(previous.count);
            }
            toast.error("Không thể cập nhật lượt thích");
        },
        onSuccess: (result) => {
            setLiked(result.liked);
            setLikesCount(result.likes_count);
            void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.posts.byId(post.id) });
        },
    });

    const handleLike = () => {
        if (!requireAuth("Đăng nhập để thích bài đăng")) return;
        likeMutation.mutate(!liked);
    };

    const panelId = `comments-${post.id}`;

    return (
        <article className="overflow-hidden rounded-2xl bg-surface-elevated shadow-sm">
            {/* Author */}
            {post.author && (
                <div className="flex items-center gap-3 px-4 pt-4">
                    <div className="relative shrink-0">
                        <Link href={ROUTES.profile(post.author.username)} className="block" aria-hidden tabIndex={-1}>

                            <MediaImage
                                src={getAvatarUrl(post.author.avatar_url, post.author.username)}
                                alt=""
                                className="h-10 w-10 rounded-full object-cover"
                            />
                        </Link>
                        <FollowedBadge authorId={post.author.id} username={post.author.username} displayName={post.author.display_name} initiallyFollowing={post.author.is_following ?? false} />
                    </div>
                    {/* Decorative: the name link next to it carries the accessible label. */}

                    <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-1.5">
                            <Link
                                href={ROUTES.profile(post.author.username)}
                                className="truncate text-sm font-semibold text-ink hover:text-brand-500"
                            >
                                {post.author.display_name}
                            </Link>
                            <FollowButton
                                authorId={post.author.id}
                                username={post.author.username}
                                displayName={post.author.display_name}
                                initiallyFollowing={post.author.is_following ?? false}
                            />
                        </div>
                        <p className="text-xs text-ink-subtle">{timeAgo(post.created_at)}</p>
                    </div>
                </div>
            )}

            {/* Place + rating */}
            {post.post_type !== "journey" && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
                {post.location && (
                    <Link
                        href={ROUTES.location(post.location.id)}
                        className="flex min-w-0 items-center gap-1 text-sm font-medium text-brand-500 hover:text-brand-600"
                    >
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{post.location.name}</span>
                    </Link>
                )}
                <span className="flex items-center gap-0.5" aria-label={`Đánh giá ${post.rating} trên 5 sao`}>
                    {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                            key={star}
                            className={cn("h-3.5 w-3.5", star <= post.rating ? "fill-amber-400 text-amber-400" : "text-border")}
                        />
                    ))}
                </span>
            </div>}

            <p className="whitespace-pre-wrap break-words px-4 pt-2 text-sm text-ink">{post.content}</p>

            {post.post_type === "journey" ? <JourneyPostContent post={post} /> : post.images?.length > 0 && (
                <div className="mt-3">
                    <PostImages images={post.images} postId={post.id} />
                </div>
            )}

            {/* Actions. Buttons only: nothing here navigates, so tapping them can never open the detail page. */}
            <div className="flex flex-wrap items-center gap-4 px-4 py-3">
                <button
                    type="button"
                    onClick={handleLike}
                    disabled={likeMutation.isPending}
                    aria-pressed={liked}
                    aria-label={liked ? "Bỏ thích bài đăng" : "Thích bài đăng"}
                    className="flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-red-500"
                >
                    <Heart className={cn("h-5 w-5", liked && "fill-red-500 text-red-500")} />
                    {formatCount(likesCount)}
                </button>

                <button
                    type="button"
                    onClick={() => setCommentsOpen((open) => !open)}
                    aria-expanded={commentsOpen}
                    aria-controls={panelId}
                    aria-label={commentsOpen ? "Đóng bình luận" : "Mở bình luận"}
                    className={cn(
                        "flex items-center gap-1.5 text-sm transition-colors hover:text-brand-500",
                        commentsOpen ? "text-brand-500" : "text-ink-muted"
                    )}
                >
                    <MessageCircle className={cn("h-5 w-5", commentsOpen && "fill-brand-500/20")} />
                    {formatCount(commentsCount)}
                </button>

                <button type="button" aria-label={saved ? "Bỏ lưu bài đăng" : "Lưu bài đăng"} aria-pressed={saved} disabled={saveMutation.isPending} onClick={() => { if (requireAuth("Đăng nhập để lưu bài đăng")) saveMutation.mutate(!saved); }} className="flex min-h-11 items-center gap-1.5 text-sm text-ink-muted hover:text-brand-500">
                    <Bookmark className={cn("h-5 w-5", saved && "fill-brand-500 text-brand-500")} />{formatCount(savesCount)}
                </button>
                <ShareContentButton target={postShareTarget(post)} iconOnly />
                <Link href={ROUTES.post(post.id)} className="ml-auto text-xs font-medium text-brand-500 hover:text-brand-600">
                    Xem chi tiết
                </Link>
            </div>

            {commentsOpen && (
                <div id={panelId}>
                    <CommentSection postId={post.id} postAuthorId={post.author_id} onCommentsCountChange={setCommentsCount} />
                </div>
            )}
        </article>
    );
}
