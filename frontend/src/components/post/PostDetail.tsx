import Link from "next/link";
import { ArrowLeft, Calendar, Star } from "lucide-react";
import { LOCATION_CATEGORIES, ROUTES } from "@/constants";
import { cn, formatDate, getAvatarUrl, timeAgo } from "@/lib/utils";
import type { Post } from "@/types";
import { JourneyPostCard } from "@/components/journey/JourneyPostCard";
import { ShareContentButton } from "@/components/messaging/ShareContentButton";
import { postShareTarget } from "@/lib/messaging/share";

const VISIBILITY_LABEL: Record<string, string> = {
  followers: "Chỉ người theo dõi",
  private: "Chỉ mình tôi",
};

/**
 * Presentational post view (no hooks), so it renders both from the server page and from the
 * client fallback used for non-public posts.
 *
 * Plain <img> on purpose: post images are arbitrary https URLs, which next/image would
 * reject unless every host is listed in next.config.ts `remotePatterns`.
 */
export function PostDetail({ post }: { post: Post }) {
  if (post.post_type === "journey") return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link href={ROUTES.feed} className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm text-ink-muted"><ArrowLeft className="h-4 w-4" />Về bảng tin</Link>
      <JourneyPostCard post={post} />
    </div>
  );
  const images = post.images ?? [];
  const { author, location } = post;
  const icon = LOCATION_CATEGORIES.find((c) => c.value === location?.category)?.icon ?? "📍";
  const place = [location?.city, location?.country].filter(Boolean).join(", ");

  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Link
          href={ROUTES.feed}
          // href={location ? ROUTES.location(location.id) : ROUTES.feed}
          className="mb-6 flex items-center gap-2 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Quay lại
        </Link>

        <article className="overflow-hidden rounded-3xl bg-surface-elevated shadow-sm">
          {images.length > 0 && (
            <div className={cn("grid gap-1", images.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
              {images.map((src, i) => (
                <div
                  key={`${src}-${i}`}
                  className={cn(
                    "relative overflow-hidden bg-surface-muted",
                    images.length === 1
                      ? "aspect-[4/3]"
                      : i === 0 && images.length % 2 !== 0
                        ? "col-span-2 aspect-[16/9]"
                        : "aspect-square"
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`Ảnh ${i + 1}`} className="h-full w-full object-cover" />
                </div>
              ))}
            </div>
          )}

          <div className="p-6">
            {author && (
              <Link href={ROUTES.profile(author.username)} className="mb-4 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getAvatarUrl(author.avatar_url, author.username)}
                  alt={author.display_name}
                  className="h-10 w-10 rounded-2xl object-cover"
                />
                <div>
                  <p className="font-semibold text-ink">{author.display_name}</p>
                  <p className="text-xs text-ink-subtle">
                    {timeAgo(post.created_at)}
                    {VISIBILITY_LABEL[post.visibility] && ` · ${VISIBILITY_LABEL[post.visibility]}`}
                  </p>
                </div>
              </Link>
            )}

            {location && (
              <Link
                href={ROUTES.location(location.id)}
                className="mb-3 flex items-center gap-2 text-sm text-brand-600 hover:text-brand-700"
              >
                <span>{icon}</span>
                <span className="font-medium">{location.name}</span>
                {place && <span className="text-ink-subtle">· {place}</span>}
              </Link>
            )}

            <div className="mb-4 flex items-center gap-4 text-sm text-ink-muted">
              <span className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    className={cn(
                      "h-4 w-4",
                      s <= post.rating ? "fill-amber-400 text-amber-400" : "text-border"
                    )}
                  />
                ))}
                <span className="ml-1 font-medium text-ink">{post.rating}/5</span>
              </span>
              {post.visited_at && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatDate(post.visited_at)}
                </span>
              )}
            </div>

            <p className="whitespace-pre-wrap leading-relaxed text-ink">{post.content}</p>
            <div className="mt-4 border-t border-border pt-3"><ShareContentButton target={postShareTarget(post)} /></div>
          </div>
        </article>
      </div>
    </div>
  );
}
