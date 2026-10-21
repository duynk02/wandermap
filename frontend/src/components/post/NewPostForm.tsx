"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { Loader2, Star } from "lucide-react";
import { ApiError, createLocation, createPost } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { createPostSchema } from "@/lib/validations";
import { LOCATION_CATEGORIES, MAX_POST_IMAGES, QUERY_KEYS, ROUTES } from "@/constants";
import { cn } from "@/lib/utils";
import type { LocationCategory, PostVisibility } from "@/types";
import { ImageUploader } from "./ImageUploader";
import { LocationPicker } from "./LocationPicker";
import type { PickedLocation } from "@/lib/post-location";

const VISIBILITY_OPTIONS: { value: PostVisibility; label: string }[] = [
  { value: "public", label: "Công khai" },
  { value: "followers", label: "Người theo dõi" },
  { value: "private", label: "Chỉ mình tôi" },
];

const fieldClass =
  "w-full rounded-2xl border border-border bg-surface-muted px-4 py-3 text-sm text-ink " +
  "placeholder:text-ink-subtle outline-none transition-colors " +
  "focus:border-brand-500 focus:ring-1 focus:ring-brand-500";

const MAX_CONTENT = 2000;

export function NewPostForm({ initialLocation = null, locationError }: {
  initialLocation?: PickedLocation | null;
  locationError?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const today = format(new Date(), "yyyy-MM-dd");
  const [picked, setPicked] = useState<PickedLocation | null>(initialLocation);
  const [category, setCategory] = useState<LocationCategory>(initialLocation?.kind === "new" ? initialLocation.place.category : "other");
  const [content, setContent] = useState("");
  const [rating, setRating] = useState(0);
  const [visitedAt, setVisitedAt] = useState(today);
  const [visibility, setVisibility] = useState<PostVisibility>("public");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>(locationError ? { location: locationError } : {});
  const [submitting, setSubmitting] = useState(false);

  // The access token only exists in the browser, so the redirect for guests happens here.
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      const next = `${window.location.pathname}${window.location.search}`;
      router.replace(`${ROUTES.login}?next=${encodeURIComponent(next)}`);
    }
  }, [authLoading, isAuthenticated, router]);

  if (authLoading || !isAuthenticated) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
      </div>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (uploading) {
      setErrors((e) => ({ ...e, images: "Ảnh đang được tải lên, vui lòng đợi một chút" }));
      return;
    }

    const parsed = createPostSchema.omit({ location_id: true }).safeParse({
      content: content.trim(),
      images,
      rating,
      visited_at: visitedAt,
      visibility,
    });

    const next: Record<string, string> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
    }
    if (!picked) next.location = "Vui lòng chọn địa điểm";
    if (!rating) next.rating = "Vui lòng chọn số sao";
    if (!visitedAt) next.visited_at = "Vui lòng chọn ngày";
    else if (visitedAt > today) next.visited_at = "Ngày ghé thăm không thể ở tương lai";

    setErrors(next);
    if (!parsed.success || Object.keys(next).length > 0 || !picked) return;

    setSubmitting(true);
    try {
      let locationId: string;
      if (picked.kind === "existing") {
        locationId = picked.location.id;
      } else {
        const place = picked.place;
        const location = await createLocation({
          name: place.name.slice(0, 200),
          address: place.address ? place.address.slice(0, 500) : undefined,
          coordinates: place.coordinates,
          city: place.city,
          country: place.country,
          category,
          google_place_id: place.key,
        });
        locationId = location.id;
      }

      const post = await createPost({ ...parsed.data, location_id: locationId });

      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.posts.all });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.locations.all });
      toast.success("Đã đăng bài");
      router.push(ROUTES.post(post.id));
    } catch (error) {
      toast.error("Không thể đăng bài", {
        description: error instanceof ApiError ? error.message : "Đã có lỗi xảy ra, thử lại sau.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-3xl bg-surface-elevated p-6 shadow-sm">
      {/* Location */}
      <section>
        <label className="mb-2 block text-sm font-medium text-ink">Địa điểm</label>
        <LocationPicker
          value={picked}
          onChange={(v) => {
            setPicked(v);
            if (v?.kind === "new") setCategory(v.place.category);
            setErrors((e) => ({ ...e, location: "" }));
          }}
          error={errors.location}
        />
        {picked?.kind === "new" && (
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-ink-muted">
              Loại địa điểm (đã đoán từ bản đồ, có thể đổi)
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as LocationCategory)}
              className={fieldClass}
            >
              {LOCATION_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.icon} {c.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {/* Rating */}
      <section>
        <label className="mb-2 block text-sm font-medium text-ink">Đánh giá</label>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Số sao">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={rating === s}
              aria-label={`${s} sao`}
              onClick={() => {
                setRating(s);
                setErrors((e) => ({ ...e, rating: "" }));
              }}
              className="rounded p-0.5 transition-transform hover:scale-110"
            >
              <Star
                className={cn(
                  "h-7 w-7",
                  s <= rating ? "fill-amber-400 text-amber-400" : "text-border"
                )}
              />
            </button>
          ))}
        </div>
        {errors.rating && <p className="mt-1 text-xs text-red-500">{errors.rating}</p>}
      </section>

      {/* Visited date + visibility */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm font-medium text-ink">Ngày ghé thăm</label>
          <input
            type="date"
            value={visitedAt}
            max={today}
            onChange={(e) => setVisitedAt(e.target.value)}
            className={fieldClass}
          />
          {errors.visited_at && <p className="mt-1 text-xs text-red-500">{errors.visited_at}</p>}
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-ink">Ai có thể xem</label>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as PostVisibility)}
            className={fieldClass}
          >
            {VISIBILITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Content */}
      <section>
        <label className="mb-2 block text-sm font-medium text-ink">Cảm nhận của bạn</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          maxLength={MAX_CONTENT}
          placeholder="Chia sẻ trải nghiệm, mẹo đi lại, món nên thử..."
          className={cn(fieldClass, "resize-y")}
        />
        <div className="mt-1 flex justify-between text-xs">
          <span className="text-red-500">{errors.content}</span>
          <span className="text-ink-subtle">
            {content.length}/{MAX_CONTENT}
          </span>
        </div>
      </section>

      {/* Images */}
      <section>
        <label className="mb-2 block text-sm font-medium text-ink">Ảnh</label>
        <ImageUploader
          max={MAX_POST_IMAGES}
          error={errors.images}
          onChange={(urls, busy) => {
            setImages(urls);
            setUploading(busy);
            if (urls.length) setErrors((e) => ({ ...e, images: "" }));
          }}
        />
      </section>

      <button
        type="submit"
        disabled={submitting || uploading}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {submitting ? "Đang đăng..." : uploading ? "Đang tải ảnh lên..." : "Đăng bài"}
      </button>
    </form>
  );
}
