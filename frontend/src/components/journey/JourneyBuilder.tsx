"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, Reorder, useDragControls } from "framer-motion";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Eye,
  GripVertical,
  ImagePlus,
  Loader2,
  MapPin,
  Plus,
  Route,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  createJourney,
  getMyVisitedLocations,
  updateJourney,
  uploadImage,
} from "@/lib/api";
import {
  DEFAULT_JOURNEY_STYLE,
  journeySchema,
  type JourneyInput,
} from "@/lib/validations/journey";
import { QUERY_KEYS } from "@/constants";
import type {
  Journey,
  JourneyStopInput,
  JourneyWriteInput,
  TravelMapPoint,
} from "@/types";
import { TravelMap } from "@/components/map/TravelMap";
import {
  assertTravelSession,
  fieldClass,
  formatTravelDate,
  primaryClass,
  secondaryClass,
  TravelConfirm,
  travelError,
} from "@/components/location/visited/shared";
import { useAuth } from "@/hooks/useAuth";
import { JourneyExportButton } from "./JourneyExportButton";

function StopRow({
  stop,
  point,
  index,
  count,
  onMove,
  onRemove,
}: {
  stop: JourneyStopInput;
  point?: TravelMapPoint;
  index: number;
  count: number;
  onMove: (offset: number) => void;
  onRemove: () => void;
}) {
  const drag = useDragControls();
  return (
    <Reorder.Item
      value={stop}
      dragListener={false}
      dragControls={drag}
      dragMomentum={false}
      className="relative flex items-center gap-2 rounded-xl border border-border bg-surface p-2.5 shadow-sm"
    >
      <button
        type="button"
        aria-label={`Kéo để sắp xếp ${point?.name ?? "điểm đến"}`}
        onPointerDown={(event) => drag.start(event)}
        className="touch-none cursor-grab rounded-lg p-2 text-ink-muted active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-xs font-bold text-brand-600">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">
          {point?.name ?? "Điểm đến"}
        </p>
        <p className="text-[11px] text-ink-muted">
          {point?.last_visited_at
            ? formatTravelDate(point.last_visited_at)
            : "Chưa có ngày ghé thăm"}
        </p>
      </div>
      <div className="flex shrink-0">
        <button
          type="button"
          disabled={!index}
          onClick={() => onMove(-1)}
          aria-label={`Đưa điểm ${index + 1} lên`}
          className="rounded-lg p-2 text-ink-muted hover:bg-surface-muted disabled:opacity-25"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
          aria-label={`Đưa điểm ${index + 1} xuống`}
          className="rounded-lg p-2 text-ink-muted hover:bg-surface-muted disabled:opacity-25"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Xóa điểm ${index + 1}`}
          className="rounded-lg p-2 text-ink-muted hover:bg-red-500/10 hover:text-red-500"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </Reorder.Item>
  );
}

export function JourneyBuilder({
  viewer,
  initial,
  onClose,
}: {
  viewer: string;
  initial?: Journey;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const cache = useQueryClient();
  const [requestId] = useState(() => crypto.randomUUID());
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [preview, setPreview] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [publicSave, setPublicSave] = useState<JourneyWriteInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [places, setPlaces] = useState<Record<string, TravelMapPoint>>(() =>
    Object.fromEntries(
      (initial?.stops ?? []).map((stop) => [
        stop.location_id,
        {
          id: stop.id,
          location_id: stop.location_id,
          name: stop.location_name_snapshot,
          city: stop.location.city,
          country: stop.location.country,
          coordinates: stop.location.coordinates,
          last_visited_at: stop.visited_at_snapshot,
          visit_count: 0,
        },
      ]),
    ),
  );
  const {
    register,
    watch,
    setValue,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<JourneyInput>({
    resolver: zodResolver(journeySchema),
    defaultValues: {
      title: initial?.title ?? "",
      description: initial?.description ?? "",
      cover_image_url: initial?.cover_image_url ?? "",
      visibility: initial?.visibility ?? "private",
      style_config: initial?.style_config ?? { ...DEFAULT_JOURNEY_STYLE },
      stops:
        initial?.stops.map(({ location_id, visit_id }) => ({
          location_id,
          visit_id,
        })) ?? [],
    },
  });
  const stops = watch("stops");
  const style = watch("style_config");
  const cover = watch("cover_image_url");
  const points = useMemo(
    () =>
      stops.flatMap((stop) =>
        places[stop.location_id] ? [places[stop.location_id]] : [],
      ),
    [stops, places],
  );
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (isDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [isDirty]);
  const candidates = useInfiniteQuery({
    queryKey: [
      ...QUERY_KEYS.visitedLocations.all,
      "journey-picker",
      viewer,
      debounced,
    ],
    queryFn: ({ pageParam }) => {
      assertTravelSession(viewer);
      return getMyVisitedLocations({
        search: debounced || undefined,
        page: pageParam,
        pageSize: 20,
      });
    },
    initialPageParam: 1,
    getNextPageParam: (last, pages) =>
      last.hasMore ? pages.length + 1 : undefined,
    enabled: user?.id === viewer,
  });
  const save = useMutation({
    mutationFn: (body: JourneyWriteInput) => {
      assertTravelSession(viewer);
      return initial
        ? updateJourney(initial.id, { ...body, revision: initial.revision })
        : createJourney({ ...body, request_id: requestId });
    },
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: QUERY_KEYS.journeys.all }),
        cache.invalidateQueries({ queryKey: QUERY_KEYS.travelMap.all }),
      ]);
      toast.success("Đã lưu hành trình của bạn");
      onClose();
    },
    onError: (cause) => {
      setPublicSave(null);
      setError(travelError(cause));
    },
  });
  const pending = save.isPending || uploading;
  const close = () => {
    if (!pending) {
      if (isDirty) setDiscard(true);
      else onClose();
    }
  };
  const order = (next: JourneyStopInput[]) =>
    setValue("stops", next, { shouldDirty: true, shouldValidate: true });
  const submit = (status: "draft" | "published") =>
    handleSubmit(
      (values) => {
        setError(null);
        if (status === "published" && values.stops.length < 2) {
          setError("Thêm ít nhất 2 địa điểm để hoàn tất hành trình.");
          return;
        }
        const body: JourneyWriteInput = {
          ...values,
          description: values.description || null,
          cover_image_url: values.cover_image_url || null,
          status,
        };
        if (status === "published" && values.visibility === "public")
          setPublicSave(body);
        else save.mutate(body);
      },
      () => {
        setPreview(false);
        setError("Hãy kiểm tra các trường được đánh dấu trước khi lưu.");
      },
    )();
  if (user?.id !== viewer) return null;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby="journey-builder-description"
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            if (!discard && !publicSave) close();
          }}
          className="fixed inset-0 z-[81] flex flex-col bg-surface outline-none md:inset-5 md:rounded-3xl md:border md:border-border md:shadow-2xl xl:inset-x-[max(2rem,calc((100vw-1440px)/2))]"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-brand-500/10 p-2.5 text-brand-500">
                <Route className="h-5 w-5" />
              </span>
              <div>
                <Dialog.Title className="font-bold text-ink">
                  {initial ? "Chỉnh sửa hành trình" : "Tạo hành trình"}
                </Dialog.Title>
                <Dialog.Description
                  id="journey-builder-description"
                  className="text-xs text-ink-muted"
                >
                  Nối những nơi đã đến, giữ những điều đáng nhớ.
                </Dialog.Description>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <JourneyExportButton
                input={{ title: watch("title"), points, style }}
                disabled={pending || points.length !== stops.length}
              />
              <button
                type="button"
                className="rounded-xl p-3 text-ink-muted hover:bg-surface-muted"
                aria-label={
                  preview ? "Tiếp tục chỉnh sửa" : "Xem trước hành trình"
                }
                onClick={() => setPreview(!preview)}
              >
                <Eye className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Đóng trình tạo hành trình"
                disabled={pending}
                onClick={close}
                className="rounded-xl p-3 text-ink-muted hover:bg-surface-muted disabled:opacity-40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </header>
          <motion.div
            layoutScroll
            className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden"
          >
            {!preview && (
              <motion.fieldset
                layoutScroll
                disabled={pending}
                className="order-2 w-full shrink-0 space-y-5 p-4 disabled:opacity-70 md:order-1 md:w-[390px] md:overflow-y-auto md:border-r md:border-border md:p-6 xl:w-[420px]"
              >
                <label className="block space-y-2 text-xs font-semibold text-ink">
                  Tên hành trình
                  <input
                    {...register("title")}
                    placeholder="Một dải ký ức miền Trung"
                    maxLength={200}
                    className={fieldClass}
                  />
                  {errors.title && (
                    <span role="alert" className="block text-red-500">
                      {errors.title.message}
                    </span>
                  )}
                </label>
                <label className="block space-y-2 text-xs font-semibold text-ink">
                  Mô tả
                  <textarea
                    {...register("description")}
                    rows={2}
                    placeholder="Điều gì khiến chuyến đi này đặc biệt?"
                    className={fieldClass}
                  />
                  {errors.description && (
                    <span role="alert" className="block text-red-500">
                      {errors.description.message}
                    </span>
                  )}
                </label>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-ink">
                      Điểm đến{" "}
                      <span className="text-ink-muted">{stops.length}/100</span>
                    </h3>
                    <span className="text-[10px] text-ink-muted">
                      Kéo hoặc dùng mũi tên
                    </span>
                  </div>
                  <Reorder.Group
                    axis="y"
                    values={stops}
                    onReorder={order}
                    className="space-y-2"
                    aria-label="Thứ tự điểm đến"
                  >
                    {stops.map((stop, index) => (
                      <StopRow
                        key={stop.location_id}
                        stop={stop}
                        point={places[stop.location_id]}
                        index={index}
                        count={stops.length}
                        onRemove={() =>
                          order(
                            stops.filter(
                              (item) => item.location_id !== stop.location_id,
                            ),
                          )
                        }
                        onMove={(offset) => {
                          const next = [...stops];
                          [next[index], next[index + offset]] = [
                            next[index + offset],
                            next[index],
                          ];
                          order(next);
                        }}
                      />
                    ))}
                  </Reorder.Group>
                  {!stops.length && (
                    <p className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-ink-muted">
                      Chọn địa điểm đã ghé thăm bên dưới để bắt đầu.
                    </p>
                  )}
                  {errors.stops && (
                    <p role="alert" className="text-xs text-red-500">
                      {errors.stops.message}
                    </p>
                  )}
                  <div className="rounded-xl border border-border bg-surface-muted/40 p-2">
                    <label className="flex items-center gap-2 px-2">
                      <Search className="h-4 w-4 text-ink-muted" />
                      <input
                        aria-label="Tìm địa điểm để thêm vào hành trình"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        maxLength={100}
                        placeholder="Tìm trong những nơi đã đến…"
                        className="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink outline-none"
                      />
                    </label>
                    <div className="max-h-48 space-y-1 overflow-y-auto">
                      {candidates.data?.pages
                        .flatMap((page) => page.data)
                        .map((mark) => {
                          const selected = stops.some(
                            (stop) => stop.location_id === mark.location_id,
                          );
                          return (
                            <button
                              key={mark.id}
                              type="button"
                              disabled={selected || stops.length >= 100}
                              onClick={() => {
                                setPlaces((previous) => ({
                                  ...previous,
                                  [mark.location_id]: {
                                    ...mark.location,
                                    id: mark.id,
                                    location_id: mark.location_id,
                                    last_visited_at: mark.last_visited_at,
                                    visit_count: mark.visit_count,
                                  },
                                }));
                                order([
                                  ...stops,
                                  { location_id: mark.location_id },
                                ]);
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-left text-sm text-ink hover:bg-surface disabled:opacity-45"
                            >
                              <MapPin className="h-4 w-4 shrink-0 text-brand-500" />
                              <span className="min-w-0 flex-1 truncate">
                                {mark.location.name}
                              </span>
                              {selected ? (
                                <Check className="h-4 w-4" />
                              ) : (
                                <Plus className="h-4 w-4" />
                              )}
                            </button>
                          );
                        })}
                      {candidates.isPending && (
                        <p className="p-3 text-xs text-ink-muted">
                          Đang tìm địa điểm…
                        </p>
                      )}
                      {candidates.isError && (
                        <button
                          type="button"
                          onClick={() => candidates.refetch()}
                          className="p-3 text-xs text-red-500"
                        >
                          Không tải được địa điểm. Thử lại
                        </button>
                      )}
                      {candidates.data?.pages[0].count === 0 && (
                        <p className="p-3 text-xs text-ink-muted">
                          Chưa tìm thấy. Hãy đánh dấu địa điểm đã đến trước.
                        </p>
                      )}
                      {candidates.hasNextPage && (
                        <button
                          type="button"
                          disabled={candidates.isFetchingNextPage}
                          onClick={() => candidates.fetchNextPage()}
                          className="w-full p-2 text-xs font-semibold text-brand-600"
                        >
                          {candidates.isFetchingNextPage
                            ? "Đang tải…"
                            : "Xem thêm địa điểm"}
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[10px] text-ink-muted">
                    Thứ tự do bạn chọn. Ngày hiển thị lấy từ lần ghé thăm gần
                    nhất khi thêm điểm.
                  </p>
                </div>
                <details className="group rounded-xl border border-border p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-ink">
                    Phong cách bản đồ
                  </summary>
                  <div className="mt-4 space-y-4">
                    <label className="flex items-center justify-between text-xs text-ink">
                      Màu đường nối
                      <input
                        type="color"
                        aria-label="Màu đường nối"
                        {...register("style_config.line_color")}
                        className="h-8 w-10 cursor-pointer rounded bg-transparent"
                      />
                    </label>
                    <label className="block space-y-1 text-xs text-ink">
                      Kiểu đường
                      <span className="relative block">
                        <select
                          {...register("style_config.line_style")}
                          className={`${fieldClass} appearance-none pr-10`}
                        >
                          <option value="solid">Nét liền</option>
                          <option value="dashed">Nét đứt</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
                      </span>
                    </label>
                    <label className="block space-y-1 text-xs text-ink">
                      Nền bản đồ
                      <span className="relative block">
                        <select
                          {...register("style_config.map_style")}
                          className={`${fieldClass} appearance-none pr-10`}
                        >
                          <option value="outdoors-v12">Thiên nhiên</option>
                          <option value="dark-v11">Đêm thành phố</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-ink">
                      <input
                        type="checkbox"
                        {...register("style_config.show_labels")}
                        className="accent-green-600"
                      />
                      Hiện tên địa điểm
                    </label>
                    <label className="flex items-center gap-2 text-xs text-ink">
                      <input
                        type="checkbox"
                        {...register("style_config.show_order")}
                        className="accent-green-600"
                      />
                      Hiện số thứ tự
                    </label>
                  </div>
                </details>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-ink">
                      Ảnh bìa (tùy chọn)
                    </span>
                    <button
                      type="button"
                      onClick={() => file.current?.click()}
                      className="flex items-center gap-1 text-xs font-semibold text-brand-600"
                    >
                      <ImagePlus className="h-4 w-4" />
                      Tải ảnh lên
                    </button>
                  </div>
                  <input
                    ref={file}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    aria-label="Tải ảnh bìa hành trình"
                    onChange={async (event) => {
                      const image = event.target.files?.[0];
                      event.target.value = "";
                      if (!image) return;
                      if (image.size > 10 * 1024 * 1024) {
                        setError("Chọn ảnh nhỏ hơn 10 MB.");
                        return;
                      }
                      setUploading(true);
                      setError(null);
                      try {
                        assertTravelSession(viewer);
                        const uploaded = await uploadImage(image);
                        assertTravelSession(viewer);
                        setValue("cover_image_url", uploaded.url, {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                      } catch (cause) {
                        setError(travelError(cause));
                      } finally {
                        setUploading(false);
                      }
                    }}
                  />
                  {cover && (
                    <div className="relative">
                      <Image
                        src={cover}
                        alt="Ảnh bìa hành trình"
                        width={840}
                        height={560}
                        unoptimized
                        className="h-28 w-full rounded-xl object-cover"
                      />
                      <button
                        type="button"
                        aria-label="Bỏ ảnh bìa"
                        onClick={() =>
                          setValue("cover_image_url", "", { shouldDirty: true })
                        }
                        className="absolute right-2 top-2 rounded-full bg-black/60 p-2 text-white"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-ink-muted">
                    Ảnh được lưu bằng đường dẫn công khai. Chọn ảnh bạn muốn
                    chia sẻ.
                  </p>
                </div>
                <label className="block space-y-2 text-xs font-semibold text-ink">
                  Ai có thể xem?
                  <span className="relative block">
                    <select {...register("visibility")} className={`${fieldClass} appearance-none pr-10`}>
                      <option value="private">Chỉ mình tôi</option>
                      <option value="public">Mọi người (khi công khai)</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
                  </span>
                </label>
              </motion.fieldset>
            )}
            <div
              className={`relative order-1 shrink-0 md:order-2 ${preview ? "min-h-[360px] flex-1" : "h-[34vh] min-h-[250px] md:h-auto md:min-h-0 md:flex-1"}`}
            >
              <TravelMap points={points} journey style={style} />
              {!points.length && (
                <div className="pointer-events-none absolute inset-x-8 bottom-12 rounded-2xl border border-white/20 bg-surface/90 p-4 text-center text-sm text-ink shadow-lg">
                  Hành trình của bạn sẽ hiện ở đây.
                </div>
              )}
              {preview && (
                <div className="pointer-events-none absolute left-4 top-4 max-w-[70%] rounded-2xl bg-surface/95 p-4 shadow-lg">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-brand-600">
                    WanderMap Journey
                  </p>
                  <h2 className="mt-1 break-words text-lg font-bold text-ink">
                    {watch("title") || "Hành trình của tôi"}
                  </h2>
                  <p className="mt-1 text-xs text-ink-muted">
                    {points.length} điểm đến · Theo thứ tự bạn chọn
                  </p>
                </div>
              )}
            </div>
          </motion.div>
          <footer className="shrink-0 border-t border-border bg-surface px-4 py-3 md:px-6">
            {error && (
              <p
                role="alert"
                className="mb-3 rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400"
              >
                {error}
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="hidden text-xs text-ink-muted sm:block">
                {uploading
                  ? "Đang tải ảnh…"
                  : "Lưu lại những nơi bạn đã đi qua."}
              </span>
              <div className="flex w-full gap-2 sm:w-auto">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => submit(initial?.status ?? "draft")}
                  className={`${secondaryClass} flex-1 sm:flex-none`}
                >
                  <Save className="h-4 w-4" />
                  {initial?.status === "published"
                    ? "Lưu thay đổi"
                    : "Lưu bản nháp"}
                </button>
                {initial?.status !== "published" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => submit("published")}
                    className={`${primaryClass} flex-1 sm:flex-none`}
                  >
                    {save.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Hoàn tất hành trình
                  </button>
                )}
                {initial?.status === "published" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => submit("draft")}
                    className={secondaryClass}
                  >
                    Về bản nháp
                  </button>
                )}
              </div>
            </div>
          </footer>
        </Dialog.Content>
        <TravelConfirm
          open={discard}
          title="Rời khỏi bản chỉnh sửa?"
          description="Các thay đổi chưa lưu sẽ bị mất. Bạn có thể quay lại và lưu bản nháp trước."
          label="Bỏ thay đổi"
          onCancel={() => setDiscard(false)}
          onConfirm={onClose}
        />
        <TravelConfirm
          open={!!publicSave}
          title="Công khai hành trình?"
          tone="primary"
          description="Mọi người sẽ thấy các điểm đến và ngày ghé thăm trong hành trình này, kể cả những điểm bạn đánh dấu riêng tư trên bản đồ cá nhân."
          label="Công khai hành trình"
          pending={save.isPending}
          onCancel={() => setPublicSave(null)}
          onConfirm={() => {
            if (publicSave) save.mutate(publicSave);
          }}
        />
      </Dialog.Portal>
    </Dialog.Root>
  );
}
