"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { ImagePlus, Loader2, Star, X } from "lucide-react";
import { ApiError, createLocation, createPost } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { createPostSchema } from "@/lib/validations";
import { LOCATION_CATEGORIES, MAX_POST_IMAGES, QUERY_KEYS, ROUTES } from "@/constants";
import { cn } from "@/lib/utils";
import type { LocationCategory, PostVisibility } from "@/types";
import { LocationPicker, mapboxPlaceKey, type PickedLocation } from "./LocationPicker";

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

export function NewPostForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const today = format(new Date(), "yyyy-MM-dd");
  const [picked, setPicked] = useState<PickedLocation | null>(null);
  const [category, setCategory] = useState<LocationCategory>("other");
  const [content, setContent] = useState("");
  const [rating, setRating] = useState(0);
  const [visitedAt, setVisitedAt] = useState(today);
  const [visibility, setVisibility] = useState<PostVisibility>("public");
  const [images, setImages] = useState<string[]>([]);
  const [imageInput, setImageInput] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // The access token only exists in the browser, so the redirect for guests happens here.
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace(`${ROUTES.login}?next=${encodeURIComponent(ROUTES.newPost)}`);
    }
  }, [authLoading, isAuthenticated, router]);

  if (authLoading || !isAuthenticated) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
      </div>
    );
  }

  const addImage = () => {
    const url = imageInput.trim();
    if (!url) return;
    try {
      const { protocol } = new URL(url);
      if (protocol !== "http:" && protocol !== "https:") throw new Error();
    } catch {
      setErrors((e) => ({ ...e, images: "Liên kết ảnh phải bắt đầu bằng http:// hoặc https://" }));
      return;
    }
    if (images.includes(url)) {
      setImageInput("");
      return;
    }
    if (images.length >= MAX_POST_IMAGES) {
      setErrors((e) => ({ ...e, images: `Tối đa ${MAX_POST_IMAGES} ảnh` }));
      return;
    }
    setImages((list) => [...list, url]);
    setImageInput("");
    setErrors((e) => ({ ...e, images: "" }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

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
        const g = picked.result;
        const location = await createLocation({
          name: g.name.slice(0, 200),
          address: g.address.slice(0, 500),
          coordinates: g.coordinates,
          city: g.city,
          country: g.country,
          category,
          google_place_id: mapboxPlaceKey(g.place_id),
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
            setErrors((e) => ({ ...e, location: "" }));
          }}
          error={errors.location}
        />
        {picked?.kind === "new" && (
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-ink-muted">
              Loại địa điểm (địa điểm mới)
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

      {/* Images (URLs: the API has no upload endpoint yet) */}
      <section>
        <label className="mb-2 block text-sm font-medium text-ink">
          Ảnh ({images.length}/{MAX_POST_IMAGES})
        </label>
        <div className="flex gap-2">
          <input
            value={imageInput}
            onChange={(e) => setImageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addImage();
              }
            }}
            placeholder="Dán liên kết ảnh (https://...)"
            className={fieldClass}
          />
          <button
            type="button"
            onClick={addImage}
            className="flex shrink-0 items-center gap-2 rounded-2xl bg-surface-muted px-4 text-sm font-medium text-ink hover:bg-border"
          >
            <ImagePlus className="h-4 w-4" />
            Thêm
          </button>
        </div>
        {errors.images && <p className="mt-1 text-xs text-red-500">{errors.images}</p>}

        {images.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {images.map((src, i) => (
              <div key={src} className="relative aspect-square overflow-hidden rounded-xl bg-surface-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Ảnh ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label={`Xoá ảnh ${i + 1}`}
                  onClick={() => setImages((list) => list.filter((_, idx) => idx !== i))}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <button
        type="submit"
        disabled={submitting}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {submitting ? "Đang đăng..." : "Đăng bài"}
      </button>
    </form>
  );
}
