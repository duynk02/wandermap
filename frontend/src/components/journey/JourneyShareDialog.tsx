"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  ApiError,
  getJourney,
  getSharedJourneyPost,
  shareJourney,
  uploadImage,
} from "@/lib/api";
import { QUERY_KEYS, ROUTES } from "@/constants";
import {
  assertTravelSession,
  primaryClass,
  secondaryClass,
  travelError,
} from "@/components/location/visited/shared";
import { renderJourneyPoster } from "@/lib/journey-export/render";
import { journeyImageFilename } from "@/lib/journey-export/model";
import type { Journey, TravelMapPoint } from "@/types";
import { JourneyMapCredits } from "./JourneyMapCredits";

export function JourneyShareDialog({
  journey: savedJourney,
  onClose,
  onEdit,
}: {
  journey: Journey;
  onClose: () => void;
  onEdit: () => void;
}) {
  const cache = useQueryClient();
  const router = useRouter();
  const [journey, setJourney] = useState(savedJourney);
  const eligible =
    journey.status === "published" && journey.visibility === "public";
  const [caption, setCaption] = useState("");
  const [source, setSource] = useState<"map" | "cover" | "file">("map");
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [map, setMap] = useState<{ blob: Blob; url: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedPreview, setLoadedPreview] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const uploaded = useRef<{ asset: Blob; url: string } | null>(null);
  const alive = useRef(true);
  const reload = useMutation({
    mutationFn: () => {
      assertTravelSession(journey.user_id);
      return getJourney(journey.id);
    },
    onSuccess: (current) => {
      setJourney(current);
      setNeedsRefresh(false);
      setError(null);
      void cache.invalidateQueries({ queryKey: QUERY_KEYS.journeys.all });
    },
    onError: (cause) => setError(travelError(cause)),
  });
  const status = useQuery({
    queryKey: QUERY_KEYS.posts.byJourney(journey.id, journey.user_id),
    queryFn: () => {
      assertTravelSession(journey.user_id);
      return getSharedJourneyPost(journey.id);
    },
    enabled: eligible,
    staleTime: 0,
    retry: false,
  });
  const points = useMemo<TravelMapPoint[]>(
    () =>
      journey.stops.map((stop) => ({
        id: stop.id,
        location_id: stop.location_id,
        name: stop.location_name_snapshot,
        coordinates: stop.location.coordinates,
        city: stop.location.city,
        country: stop.location.country,
        last_visited_at: stop.visited_at_snapshot,
        visit_count: 0,
      })),
    [journey],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!file) {
      setFileUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!eligible || !status.isSuccess || status.data || source !== "map")
      return;
    const controller = new AbortController();
    let url: string | undefined;
    setMap(null);
    setRenderError(null);
    void renderJourneyPoster(
      { title: journey.title, points, style: journey.style_config },
      "1:1",
      controller.signal,
    )
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setMap({ blob, url });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setRenderError(
            cause instanceof Error
              ? cause.message
              : "Không thể tạo ảnh bản đồ.",
          );
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [
    eligible,
    journey,
    points,
    source,
    attempt,
    status.isSuccess,
    status.data,
  ]);
  const preview =
    source === "map"
      ? map?.url
      : source === "cover"
        ? journey.cover_image_url
        : fileUrl;
  const publish = useMutation({
    mutationFn: async () => {
      assertTravelSession(journey.user_id);
      if (!preview) throw new Error("Vui lòng chờ ảnh preview tải xong.");
      // Recheck before uploading, including retries after a lost response.
      const existing = await getSharedJourneyPost(journey.id);
      if (existing) return { post: existing, created: false };
      let image = journey.cover_image_url;
      if (source !== "cover") {
        const asset = source === "map" ? map?.blob : file;
        if (!asset) throw new Error("Chưa có ảnh để đăng bài.");
        if (uploaded.current?.asset === asset) image = uploaded.current.url;
        else {
          const upload = await uploadImage(
            asset instanceof File
              ? asset
              : new File([asset], journeyImageFilename(journey.title, "1:1"), {
                  type: "image/png",
                }),
          );
          uploaded.current = { asset, url: upload.url };
          image = upload.url;
        }
      }
      assertTravelSession(journey.user_id);
      if (!alive.current)
        throw new Error(
          "Màn hình chia sẻ đã đóng. Vui lòng mở lại để đăng bài.",
        );
      if (!image) throw new Error("Chưa có ảnh đại diện hành trình.");
      return shareJourney({
        journey_id: journey.id,
        revision: journey.revision,
        content: caption.trim(),
        preview_image_url: image,
      });
    },
    onSuccess: async (result) => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: QUERY_KEYS.posts.all }),
        cache.invalidateQueries({ queryKey: QUERY_KEYS.journeys.all }),
      ]);
      if (!alive.current) return;
      toast.success(
        result.created
          ? "Đã chia sẻ hành trình lên Feed"
          : "Hành trình đã được chia sẻ. Đang mở bài đăng hiện có.",
      );
      onClose();
      router.push(ROUTES.post(result.post.id));
    },
    onError: (cause) => {
      if (cause instanceof ApiError && cause.status === 409)
        setNeedsRefresh(true);
      if (alive.current)
        setError(
          cause instanceof ApiError
            ? travelError(cause)
            : cause instanceof Error
              ? cause.message
              : travelError(cause),
        );
    },
  });
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !publish.isPending) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/65 backdrop-blur-sm" />
        <Dialog.Content
          onEscapeKeyDown={(event) => {
            event.stopPropagation();
            if (publish.isPending) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (publish.isPending) event.preventDefault();
          }}
          className="fixed inset-0 z-[111] flex flex-col bg-surface outline-none sm:inset-6 sm:mx-auto sm:max-w-2xl sm:rounded-3xl sm:border sm:border-border"
        >
          <header className="flex items-center justify-between gap-3 border-b border-border p-4">
            <div>
              <Dialog.Title className="font-bold text-ink">
                Chia sẻ hành trình lên Feed
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-ink-muted">
                Xem trước bài đăng, thêm lời kể và chọn ảnh đại diện.
              </Dialog.Description>
            </div>
            <button
              type="button"
              aria-label="Đóng chia sẻ hành trình"
              disabled={publish.isPending}
              onClick={onClose}
              className="rounded-xl p-3 text-ink-muted"
            >
              <X className="h-5 w-5" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {!eligible ? (
              <div className="rounded-2xl bg-surface-muted p-5 text-sm text-ink">
                <p>
                  Chỉ có thể chia sẻ hành trình đã lưu ở trạng thái công khai.
                  Việc mở màn hình này không thay đổi quyền riêng tư của bạn.
                </p>
                <button
                  type="button"
                  onClick={onEdit}
                  className={`${primaryClass} mt-4`}
                >
                  Chỉnh sửa hành trình
                </button>
              </div>
            ) : status.isPending ? (
              <p role="status" className="text-sm text-ink-muted">
                Đang kiểm tra bài chia sẻ…
              </p>
            ) : status.isError ? (
              <div role="alert">
                <p className="text-sm text-red-500">
                  {travelError(status.error)}
                </p>
                <button
                  type="button"
                  onClick={() => status.refetch()}
                  className={`${secondaryClass} mt-3`}
                >
                  Thử lại
                </button>
              </div>
            ) : status.data ? (
              <div className="text-sm text-ink">
                <p>
                  Hành trình đã có bài chia sẻ. Bạn có thể mở bài này để xem và
                  tương tác.
                </p>
                <Link
                  className={`${primaryClass} mt-4`}
                  href={ROUTES.post(status.data.id)}
                  onClick={onClose}
                >
                  Xem bài đăng
                </Link>
              </div>
            ) : (
              <>
                <label className="block text-sm font-semibold text-ink">
                  Lời kể của bạn
                  <textarea
                    aria-label="Caption hành trình"
                    value={caption}
                    onChange={(event) => setCaption(event.target.value)}
                    disabled={publish.isPending}
                    maxLength={5000}
                    rows={3}
                    placeholder="Chia sẻ kỷ niệm trên hành trình này…"
                    className="mt-2 block w-full resize-y rounded-xl border border-border bg-surface p-3 text-sm font-normal outline-none focus:border-brand-500"
                  />
                </label>
                <fieldset
                  disabled={publish.isPending}
                  className="my-4 flex flex-wrap items-center gap-3 text-xs text-ink"
                >
                  <legend className="mb-2 font-semibold">
                    Ảnh đại diện bài đăng
                  </legend>
                  <label>
                    <input
                      type="radio"
                      name="journey-share-image"
                      checked={source === "map"}
                      onChange={() => setSource("map")}
                      className="mr-1"
                    />
                    Bản đồ hành trình
                  </label>
                  {journey.cover_image_url && (
                    <label>
                      <input
                        type="radio"
                        name="journey-share-image"
                        checked={source === "cover"}
                        onChange={() => setSource("cover")}
                        className="mr-1"
                      />
                      Ảnh bìa hiện tại
                    </label>
                  )}
                  <label className="cursor-pointer rounded-lg border border-border px-3 py-2">
                    Chọn ảnh khác
                    <input
                      type="file"
                      aria-label="Chọn ảnh đại diện hành trình"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={(event) => {
                        const next = event.target.files?.[0];
                        event.target.value = "";
                        if (!next) return;
                        if (
                          !["image/jpeg", "image/png", "image/webp"].includes(
                            next.type,
                          ) ||
                          next.size > 10 * 1024 * 1024
                        ) {
                          setError(
                            "Chọn ảnh JPEG, PNG hoặc WebP tối đa 10 MB.",
                          );
                          return;
                        }
                        setFile(next);
                        setSource("file");
                        setError(null);
                      }}
                    />
                  </label>
                </fieldset>
                <article className="overflow-hidden rounded-2xl border border-border bg-surface-elevated">
                  <p className="p-4 text-sm font-semibold text-ink">
                    {journey.author.display_name}
                  </p>
                  {caption && (
                    <p className="whitespace-pre-wrap break-words px-4 pb-4 text-sm text-ink">
                      {caption}
                    </p>
                  )}
                  {source === "map" && !map && !renderError && (
                    <p
                      role="status"
                      className="flex min-h-64 items-center justify-center gap-2 text-sm text-ink-muted"
                    >
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Đang tạo ảnh bản đồ…
                    </p>
                  )}
                  {source === "map" && renderError && (
                    <div role="alert" className="p-4 text-sm text-red-500">
                      <p>{renderError}</p>
                      <button
                        type="button"
                        className={`${secondaryClass} mt-3`}
                        onClick={() => setAttempt((n) => n + 1)}
                      >
                        Thử tạo ảnh lại
                      </button>
                    </div>
                  )}
                  {preview && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={preview}
                        alt={`Preview ${journey.title}`}
                        onLoad={() => setLoadedPreview(preview)}
                        onError={() => {
                          setLoadedPreview(null);
                          setError(
                            "Không thể đọc ảnh preview. Hãy chọn ảnh khác hoặc tạo lại ảnh bản đồ.",
                          );
                        }}
                        className="max-h-[480px] w-full bg-surface-muted object-contain"
                      />
                    </>
                  )}
                  <div className="p-4">
                    <h2 className="break-words font-bold text-ink">
                      {journey.title}
                    </h2>
                    <p className="mt-1 text-xs text-ink-muted">
                      {journey.stops.length} điểm đến · Công khai
                    </p>
                    <p className="mt-2 break-words text-xs text-ink-muted">
                      {journey.stops
                        .slice(0, 3)
                        .map((stop) => stop.location_name_snapshot)
                        .join(" → ")}
                      {journey.stops.length > 3 ? " → …" : ""}
                    </p>
                  </div>
                  {source === "map" && <JourneyMapCredits />}
                </article>
                <p className="mt-4 text-xs leading-relaxed text-ink-muted">
                  Mỗi hành trình có một bài chia sẻ. Ảnh được giữ tại thời điểm
                  đăng; nút xem hành trình luôn mở dữ liệu mới nhất. Khi chuyển
                  hành trình riêng tư hoặc về bản nháp, người khác không xem
                  được bài trong WanderMap. Ảnh đã tải xuống hoặc đường dẫn ảnh
                  công khai đã biết không thể thu hồi.
                </p>
                {needsRefresh && (
                  <button
                    type="button"
                    className={`${secondaryClass} mt-3`}
                    disabled={reload.isPending}
                    onClick={() => reload.mutate()}
                  >
                    {reload.isPending
                      ? "Đang tải lại…"
                      : "Tải lại bản xem trước"}
                  </button>
                )}
                {error && (
                  <p role="alert" className="mt-3 text-sm text-red-500">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>
          {eligible && status.isSuccess && !status.data && (
            <footer className="flex justify-end gap-3 border-t border-border p-4">
              <button
                type="button"
                className={secondaryClass}
                disabled={publish.isPending}
                onClick={onClose}
              >
                Hủy
              </button>
              <button
                type="button"
                className={primaryClass}
                disabled={
                  !preview ||
                  loadedPreview !== preview ||
                  publish.isPending ||
                  needsRefresh ||
                  reload.isPending
                }
                onClick={() => {
                  setError(null);
                  publish.mutate();
                }}
              >
                {publish.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {publish.isPending ? "Đang đăng…" : "Đăng bài"}
              </button>
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
