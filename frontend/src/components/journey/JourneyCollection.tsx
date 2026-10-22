"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowUpRight,
  Globe2,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  Route,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { deleteJourney, getJourney, getJourneys } from "@/lib/api";
import { QUERY_KEYS, ROUTES } from "@/constants";
import type { Journey, JourneySummary } from "@/types";
import {
  assertTravelSession,
  primaryClass,
  secondaryClass,
  TravelConfirm,
  travelError,
} from "@/components/location/visited/shared";
const JourneyBuilder = dynamic(
  () => import("./JourneyBuilder").then((module) => module.JourneyBuilder),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        className="fixed inset-0 z-[80] grid place-items-center bg-black/50"
      >
        <p className="rounded-2xl bg-surface px-6 py-4 text-sm text-ink">
          Đang mở trình tạo hành trình…
        </p>
      </div>
    ),
  },
);

export function JourneyEditor({
  id,
  viewer,
  onClose,
}: {
  id?: string;
  viewer: string;
  onClose: () => void;
}) {
  const full = useQuery({
    queryKey: QUERY_KEYS.journeys.byId(id ?? "new", viewer),
    queryFn: () => getJourney(id!),
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: "always",
  });
  // Capture the loaded revision once. Background refetches must never replace a dirty form.
  const captured = useRef<Journey | undefined>(undefined);
  if (full.data && !full.isFetching && !full.isError && !captured.current)
    captured.current = full.data;
  if (!id || captured.current)
    return (
      <JourneyBuilder
        viewer={viewer}
        initial={captured.current}
        onClose={onClose}
      />
    );
  return (
    <div
      role="status"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-6"
    >
      <div className="rounded-2xl bg-surface p-6 text-sm text-ink">
        {full.isError
          ? "Không thể mở hành trình. Vui lòng thử lại."
          : "Đang mở hành trình…"}
        <div className="mt-4 flex gap-2">
          {full.isError && (
            <button
              type="button"
              className={primaryClass}
              onClick={() => full.refetch()}
            >
              Thử lại
            </button>
          )}
          <button type="button" className={secondaryClass} onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

export function JourneyCollection({
  username,
  viewer,
  isOwner,
  createOpen,
  onCreateClose,
  onCreate,
}: {
  username: string;
  viewer: string;
  isOwner: boolean;
  createOpen: boolean;
  onCreateClose: () => void;
  onCreate: () => void;
}) {
  const cache = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<JourneySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: QUERY_KEYS.journeys.list(username, viewer),
    queryFn: ({ pageParam }) => getJourneys({ username, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) =>
      last.hasMore ? pages.length + 1 : undefined,
  });
  const remove = useMutation({
    mutationFn: async (journey: JourneySummary) => {
      assertTravelSession(viewer);
      return deleteJourney(journey.id, journey.revision);
    },
    onSuccess: async () => {
      setRemoving(null);
      setError(null);
      await Promise.all([
        cache.invalidateQueries({ queryKey: QUERY_KEYS.journeys.all }),
        cache.invalidateQueries({ queryKey: QUERY_KEYS.travelMap.all }),
        cache.invalidateQueries({ queryKey: QUERY_KEYS.posts.all }),
      ]);
      toast.success("Đã xóa hành trình");
    },
    onError: (cause) => setError(travelError(cause)),
  });
  const items = list.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <section className="mt-8" aria-label="Hành trình đã lưu">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
            <Route className="h-5 w-5 text-brand-500" />
            Những hành trình
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            {isOwner
              ? "Từ những dấu chân, kể câu chuyện của riêng bạn."
              : "Những câu chuyện được chia sẻ qua từng điểm đến."}
          </p>
        </div>
        {isOwner && (
          <button type="button" className={secondaryClass} onClick={onCreate}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Tạo hành trình</span>
          </button>
        )}
      </div>
      {list.isPending && (
        <div className="h-40 animate-pulse rounded-2xl bg-surface-muted" />
      )}
      {list.isError && (
        <div
          role="alert"
          className="rounded-xl border border-border p-4 text-sm text-ink-muted"
        >
          Chưa tải được hành trình.{" "}
          <button
            type="button"
            onClick={() => list.refetch()}
            className="font-semibold text-brand-600"
          >
            Thử lại
          </button>
        </div>
      )}
      {list.isSuccess && !items.length && (
        <div className="rounded-2xl border border-dashed border-border bg-surface-muted/30 px-5 py-9 text-center">
          <Route className="mx-auto mb-3 h-7 w-7 text-brand-500/60" />
          <p className="text-sm font-medium text-ink">
            {isOwner
              ? "Chuyến đi nào bạn muốn lưu lại?"
              : "Chưa có hành trình công khai"}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {isOwner
              ? "Chọn những nơi đã đến và nối thành một hành trình."
              : "Hãy quay lại để khám phá những câu chuyện mới."}
          </p>
          {isOwner && (
            <button
              type="button"
              className={`${primaryClass} mt-4`}
              onClick={onCreate}
            >
              <Plus className="h-4 w-4" />
              Tạo hành trình đầu tiên
            </button>
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((journey) => (
          <article
            key={journey.id}
            className="group overflow-hidden rounded-2xl border border-border bg-surface transition-shadow hover:shadow-lg"
          >
            <Link
              href={ROUTES.journey(journey.id)}
              className="relative block h-32 overflow-hidden bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500"
            >
              {journey.cover_image_url ? (
                <Image
                  src={journey.cover_image_url}
                  alt=""
                  fill
                  unoptimized
                  sizes="(max-width: 640px) 100vw, 480px"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center gap-5 text-white/60">
                  <span className="h-3 w-3 rounded-full border-2 border-current" />
                  <span className="w-12 border-t-2 border-dashed border-current" />
                  <MapPinIcon />
                  <span className="w-12 border-t-2 border-dashed border-current" />
                  <span className="h-3 w-3 rounded-full border-2 border-current" />
                </div>
              )}
              <span className="absolute bottom-3 left-3 rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur">
                {journey.stop_count} điểm đến
              </span>
              {isOwner && (
                <span className="absolute right-3 top-3 rounded-full bg-surface/95 px-2.5 py-1 text-[10px] text-ink">
                  {journey.status === "draft"
                    ? "Bản nháp"
                    : journey.visibility === "private"
                      ? "Chỉ mình tôi"
                      : "Công khai"}
                </span>
              )}
            </Link>
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <Link href={ROUTES.journey(journey.id)} className="min-w-0">
                  <h4 className="truncate font-semibold text-ink transition-colors group-hover:text-brand-600">
                    {journey.title}
                  </h4>
                  <p className="mt-1 truncate text-xs text-ink-muted">
                    {journey.preview_names.join(" → ") || "Chưa chọn điểm đến"}
                    {journey.stop_count > 3 ? " → …" : ""}
                  </p>
                </Link>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-ink-muted" />
              </div>
              {isOwner && (
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                  <span className="flex items-center gap-1.5 text-[10px] text-ink-muted">
                    {journey.visibility === "public" &&
                    journey.status === "published" ? (
                      <Globe2 className="h-3 w-3" />
                    ) : (
                      <LockKeyhole className="h-3 w-3" />
                    )}
                    {journey.status === "draft"
                      ? "Chỉ bạn thấy bản nháp này"
                      : journey.visibility === "private"
                        ? "Chỉ bạn có thể xem"
                        : "Mọi người có thể xem"}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      aria-label={`Sửa ${journey.title}`}
                      onClick={() => setEditing(journey.id)}
                      className="rounded-lg p-2 text-ink-muted hover:bg-surface-muted"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Xóa ${journey.title}`}
                      onClick={() => {
                        setError(null);
                        setRemoving(journey);
                      }}
                      className="rounded-lg p-2 text-ink-muted hover:bg-red-500/10 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      {list.hasNextPage && (
        <button
          type="button"
          disabled={list.isFetchingNextPage}
          onClick={() => list.fetchNextPage()}
          className={`${secondaryClass} mx-auto mt-4 flex`}
        >
          {list.isFetchingNextPage && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Xem thêm hành trình
        </button>
      )}
      {isOwner && (createOpen || editing) && (
        <JourneyEditor
          key={editing ?? "new"}
          id={editing ?? undefined}
          viewer={viewer}
          onClose={() => {
            setEditing(null);
            onCreateClose();
          }}
        />
      )}
      <TravelConfirm
        open={!!removing}
        title="Xóa hành trình này?"
        description={
          error ??
          "Hành trình sẽ bị xóa. Những địa điểm đã ghé thăm vẫn được giữ trên bản đồ của bạn."
        }
        label="Xóa hành trình"
        pending={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove.mutate(removing);
        }}
      />
    </section>
  );
}

function MapPinIcon() {
  return <Route className="h-8 w-8" strokeWidth={1.5} />;
}
