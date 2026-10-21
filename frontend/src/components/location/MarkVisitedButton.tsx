"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Footprints,
  Globe2,
  Loader2,
  LockKeyhole,
  MapPin,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  getMyVisitedLocations,
  markLocationVisited,
  removeVisitedLocation,
  updateVisitedLocation,
} from "@/lib/api";
import {
  visitedLocationSchema,
  type VisitedLocationInput,
} from "@/lib/validations";
import { useAuth } from "@/hooks/useAuth";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAuthStore } from "@/stores/authStore";
import { QUERY_KEYS } from "@/constants";
import { cn } from "@/lib/utils";
import type { Location, PaginatedResponse, VisitedLocation } from "@/types";
import { VisitHistory } from "./visited/VisitHistory";
import {
  assertTravelSession,
  fieldClass,
  formatTravelDate,
  primaryClass,
  secondaryClass,
  TravelConfirm,
  travelError,
} from "./visited/shared";

type Place = Pick<Location, "id" | "name" | "city" | "country">;
const statusKey = (viewer: string, locationId: string) =>
  QUERY_KEYS.visitedLocations.mine(viewer, { location_id: locationId });

export function MarkVisitedButton({
  location,
  variant = "default",
}: {
  location: Place;
  variant?: "default" | "hero";
}) {
  const { user, isLoading } = useAuth();
  const requireAuth = useRequireAuth();
  const [open, setOpen] = useState(false);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const viewer = user?.id ?? "guest";
  const status = useQuery({
    queryKey: statusKey(viewer, location.id),
    queryFn: () =>
      getMyVisitedLocations({ location_id: location.id, pageSize: 1 }),
    enabled: !!user && !isLoading,
    retry: 1,
  });
  const mark = status.data?.data[0];
  const checking = isLoading || (!!user && status.isPending);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={checking}
        aria-haspopup="dialog"
        onClick={() => {
          if (requireAuth("Đăng nhập để lưu những địa điểm bạn đã ghé thăm")) {
            setOpenedFor(viewer);
            setOpen(true);
          }
        }}
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60",
          variant === "hero"
            ? "border-white/20 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20 focus-visible:ring-offset-brand-800"
            : "w-full border-brand-200 bg-brand-50 text-brand-800 hover:bg-brand-100 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-300 dark:hover:bg-brand-900",
        )}
      >
        {checking ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : mark ? (
          <Check className="h-4 w-4" aria-hidden />
        ) : (
          <Footprints className="h-4 w-4" aria-hidden />
        )}
        {checking
          ? "Đang kiểm tra…"
          : mark
            ? "Đã ghé thăm"
            : status.isError && user
              ? "Quản lý địa điểm đã đến"
              : "Đánh dấu đã đến"}
        {mark && (
          <span
            className={cn(
              "ml-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
              variant === "hero"
                ? "bg-white/15"
                : "bg-brand-100 dark:bg-brand-900",
            )}
          >
            Chỉnh sửa
          </span>
        )}
      </button>
      {open && user && openedFor === viewer && (
        <VisitedDialog
          key={`${viewer}:${location.id}`}
          location={location}
          viewer={viewer}
          onClose={() => {
            setOpen(false);
            requestAnimationFrame(() => triggerRef.current?.focus());
          }}
          status={status}
        />
      )}
    </>
  );
}

function VisitedDialog({
  location,
  viewer,
  status,
  onClose,
}: {
  location: Place;
  viewer: string;
  onClose: () => void;
  status: ReturnType<typeof useQuery<PaginatedResponse<VisitedLocation>>>;
}) {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const requestClose = () => {
    if (!busy) {
      if (dirty) setDiscard(true);
      else onClose();
    }
  };
  const mark = status.data?.data[0];
  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-sm motion-safe:animate-[travel-fade-in_180ms_ease-out]" />
        <Dialog.Content
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
          className="fixed inset-x-0 bottom-0 z-[81] flex max-h-[94dvh] flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-2xl outline-none motion-safe:animate-[travel-fade-in_200ms_ease-out] sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88dvh] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
        >
          <div className="shrink-0 border-b border-border bg-gradient-to-br from-brand-50 via-surface to-surface px-6 pb-5 pt-6 dark:from-brand-950/60">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-sm">
                <Footprints className="h-5 w-5" aria-hidden />
              </div>
              <button
                type="button"
                aria-label="Đóng quản lý địa điểm đã đến"
                disabled={busy}
                onClick={requestClose}
                className="rounded-full p-2 text-ink-muted transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <Dialog.Title className="text-xl font-semibold tracking-tight text-ink">
              {mark ? "Một nơi, nhiều kỷ niệm" : "Thêm một dấu chân mới"}
            </Dialog.Title>
            <Dialog.Description className="mt-1.5 text-sm leading-relaxed text-ink-muted">
              Lưu nơi bạn đã đến, theo cách của riêng bạn.
            </Dialog.Description>
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-brand-100 bg-surface/80 p-3 dark:border-brand-900">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-ink">
                  {location.name}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {[location.city, location.country]
                    .filter(Boolean)
                    .join(" · ") || "Địa điểm trong bản đồ của bạn"}
                </p>
              </div>
            </div>
          </div>
          {status.isPending ? (
            <div
              className="space-y-4 p-6"
              role="status"
              aria-label="Đang tải địa điểm đã đến"
            >
              <div className="h-24 animate-pulse rounded-xl bg-surface-muted" />
              <div className="h-28 animate-pulse rounded-xl bg-surface-muted" />
            </div>
          ) : status.isError ? (
            <div className="p-6">
              <p className="text-sm text-ink-muted" role="alert">
                Không thể kiểm tra trạng thái đã đến. Thông tin của bạn vẫn được
                giữ an toàn.
              </p>
              <button
                type="button"
                onClick={() => void status.refetch()}
                className={`${secondaryClass} mt-4`}
              >
                Thử lại
              </button>
            </div>
          ) : (
            <VisitedEditor
              key={mark?.id ?? "new"}
              location={location}
              viewer={viewer}
              mark={mark}
              onClose={onClose}
              onDirty={setDirty}
              onBusy={setBusy}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
      <TravelConfirm
        open={discard}
        title="Bạn còn thay đổi chưa lưu"
        description="Đóng cửa sổ sẽ bỏ phần đang nhập. Các kỷ niệm đã lưu trước đó vẫn được giữ."
        label="Bỏ thay đổi"
        onCancel={() => setDiscard(false)}
        onConfirm={onClose}
      />
    </Dialog.Root>
  );
}

function VisitedEditor({
  location,
  viewer,
  mark,
  onClose,
  onDirty,
  onBusy,
}: {
  location: Place;
  viewer: string;
  mark?: VisitedLocation;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const client = useQueryClient();
  const router = useRouter();
  const [historyDirty, setHistoryDirty] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const form = useForm<VisitedLocationInput>({
    resolver: zodResolver(visitedLocationSchema),
    defaultValues: {
      note: mark?.note ?? "",
      visibility: mark?.visibility ?? "private",
      visited_at: "",
    },
    mode: "onBlur",
  });
  const { errors, isDirty, isSubmitting } = form.formState;
  const sync = useCallback(
    async (updated?: VisitedLocation | null) => {
      if (useAuthStore.getState().user?.id !== viewer) return;
      if (updated !== undefined)
        client.setQueryData(statusKey(viewer, location.id), {
          data: updated ? [updated] : [],
          count: updated ? 1 : 0,
          page: 1,
          pageSize: 1,
          hasMore: false,
        });
      await Promise.all([
        client.invalidateQueries({ queryKey: QUERY_KEYS.visitedLocations.all }),
        client.invalidateQueries({ queryKey: QUERY_KEYS.travelMap.all }),
        client.invalidateQueries({ queryKey: QUERY_KEYS.journeys.all }),
        client.invalidateQueries({ queryKey: ["user-pins", viewer] }),
        client.invalidateQueries({ queryKey: ["profiles"] }),
      ]);
      router.refresh();
    },
    [client, location.id, router, viewer],
  );
  const save = useMutation({
    mutationFn: (values: VisitedLocationInput) => {
      assertTravelSession(viewer);
      const metadata = {
        note: values.note || null,
        visibility: values.visibility,
      };
      return mark
        ? updateVisitedLocation(mark.id, metadata)
        : markLocationVisited({
            ...metadata,
            location_id: location.id,
            visited_at: values.visited_at || null,
          });
    },
    onSuccess: async (updated, values) => {
      if (useAuthStore.getState().user?.id !== viewer) return;
      form.reset(values);
      await sync(updated);
      toast.success(
        mark
          ? "Đã lưu thông tin địa điểm"
          : "Đã thêm một dấu chân vào bản đồ của bạn",
        { id: "visited-locations-feedback", duration: 2500 },
      );
      if (!mark) onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => {
      assertTravelSession(viewer);
      return removeVisitedLocation(mark!.id);
    },
    onSuccess: async () => {
      if (useAuthStore.getState().user?.id !== viewer) return;
      onClose();
      await sync(null);
      toast.success("Đã bỏ đánh dấu địa điểm", {
        id: "visited-locations-feedback",
        duration: 2500,
      });
    },
    onError: (error) => {
      toast.error(travelError(error), { id: "visited-locations-feedback" });
    },
  });
  const pending = save.isPending || remove.isPending || isSubmitting;
  const blocked = pending || historyBusy;
  // Report unsaved changes and pending writes to the modal's close guard.
  useReportState(isDirty || historyDirty, blocked, onDirty, onBusy);
  const visibility = form.watch("visibility");
  const note = form.watch("note");
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
        {mark && (
          <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1.5 font-medium text-brand-800 dark:bg-brand-950 dark:text-brand-300">
              <Check className="h-3.5 w-3.5" />
              Đã có trên bản đồ của bạn
            </span>
            {mark.last_visited_at && (
              <span className="text-ink-muted">
                Gần nhất {formatTravelDate(mark.last_visited_at)}
              </span>
            )}
          </div>
        )}
        <form
          id="visited-location-form"
          className="space-y-5"
          onSubmit={form.handleSubmit(async (values) => {
            try {
              await save.mutateAsync(values);
            } catch (error) {
              form.setError("root", { message: travelError(error) });
            }
          })}
        >
          {!mark && (
            <div>
              <label
                htmlFor="marked-visit-date"
                className="mb-2 flex items-center gap-2 text-sm font-medium text-ink"
              >
                <CalendarDays className="h-4 w-4 text-ink-muted" />
                Bạn đã đến khi nào?{" "}
                <span className="ml-auto text-xs font-normal text-ink-muted">
                  Tùy chọn
                </span>
              </label>
              <input
                id="marked-visit-date"
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                disabled={blocked}
                className={fieldClass}
                aria-invalid={!!errors.visited_at}
                aria-describedby="marked-date-hint"
                {...form.register("visited_at")}
              />
              <p id="marked-date-hint" className="mt-2 text-xs text-ink-muted">
                Không nhớ ngày? Bạn có thể để trống và thêm sau.
              </p>
              {errors.visited_at && (
                <p role="alert" className="mt-1 text-xs text-red-600">
                  {errors.visited_at.message}
                </p>
              )}
            </div>
          )}
          <div>
            <label
              htmlFor="marked-note"
              className="mb-2 block text-sm font-medium text-ink"
            >
              Điều bạn muốn nhớ{" "}
              <span className="font-normal text-ink-muted">(tùy chọn)</span>
            </label>
            <textarea
              id="marked-note"
              rows={3}
              maxLength={1000}
              disabled={blocked}
              className={`${fieldClass} resize-none`}
              placeholder="Một góc bình yên, món ăn yêu thích hay lời hẹn quay lại…"
              aria-invalid={!!errors.note}
              aria-describedby="marked-note-count"
              {...form.register("note")}
            />
            <div className="mt-1 flex justify-between gap-3 text-xs text-ink-muted">
              <span>
                {errors.note && (
                  <span role="alert" className="text-red-600">
                    {errors.note.message}
                  </span>
                )}
              </span>
              <span id="marked-note-count" className="tabular-nums">
                {note.length}/1.000
              </span>
            </div>
          </div>
          <fieldset disabled={blocked}>
            <legend className="mb-2 text-sm font-medium text-ink">
              Ai có thể xem?
            </legend>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  {
                    value: "private",
                    title: "Chỉ mình tôi",
                    description: "Giữ riêng kỷ niệm",
                    icon: LockKeyhole,
                  },
                  {
                    value: "public",
                    title: "Công khai",
                    description: "Hiện trên hồ sơ",
                    icon: Globe2,
                  },
                ] as const
              ).map(({ value, title, description, icon: Icon }) => (
                <label
                  key={value}
                  className={cn(
                    "relative flex cursor-pointer gap-2.5 rounded-2xl border p-3.5 transition-colors focus-within:ring-2 focus-within:ring-brand-500",
                    visibility === value
                      ? "border-brand-500 bg-brand-50/70 dark:bg-brand-950/60"
                      : "border-border hover:bg-surface-muted",
                    blocked && "cursor-not-allowed opacity-60",
                  )}
                >
                  <input
                    type="radio"
                    value={value}
                    className="sr-only"
                    {...form.register("visibility")}
                  />
                  <Icon
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      visibility === value
                        ? "text-brand-600 dark:text-brand-400"
                        : "text-ink-muted",
                    )}
                  />
                  <span>
                    <span className="block text-xs font-semibold text-ink sm:text-sm">
                      {title}
                    </span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-ink-muted">
                      {description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              {visibility === "private"
                ? "Địa điểm, ngày ghé thăm và ghi chú chỉ hiển thị với bạn."
                : "Mọi người có thể xem địa điểm, ngày ghé thăm và ghi chú trên hồ sơ của bạn."}
            </p>
          </fieldset>
          {errors.root && (
            <p
              role="alert"
              className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
            >
              {errors.root.message}
            </p>
          )}
        </form>
        {mark && (
          <div className="mt-6">
            <VisitHistory
              markId={mark.id}
              viewer={viewer}
              disabled={pending}
              onChanged={sync}
              onDirty={setHistoryDirty}
              onBusy={setHistoryBusy}
            />
          </div>
        )}
        {mark && (
          <button
            type="button"
            disabled={blocked}
            className="mt-6 inline-flex min-h-11 items-center gap-2 text-xs font-medium text-red-600 transition-colors hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-40 dark:text-red-400"
            onClick={() => setRemoveOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Bỏ đánh dấu địa điểm này
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border bg-surface px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        {mark ? (
          <span className="mr-auto flex items-center gap-1.5 text-[11px] text-ink-muted">
            <LockKeyhole className="h-3.5 w-3.5" />
            Kỷ niệm thuộc về bạn
          </span>
        ) : (
          <span className="mr-auto hidden text-xs text-ink-muted sm:block">
            Thêm vào bản đồ cá nhân
          </span>
        )}
        <button
          form="visited-location-form"
          type="submit"
          disabled={blocked || (!!mark && !isDirty)}
          className={primaryClass}
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mark ? (
            <Check className="h-4 w-4" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
          {pending ? "Đang lưu…" : mark ? "Lưu thay đổi" : "Lưu dấu chân"}
        </button>
      </div>
      <TravelConfirm
        open={removeOpen}
        title="Bỏ đánh dấu địa điểm?"
        description={`Thao tác này xóa ghi chú và toàn bộ ${mark?.visit_count ?? 0} lần ghé thăm đã lưu ở đây. Wishlist, bài đăng và Journey của bạn vẫn được giữ.`}
        label="Bỏ đánh dấu"
        pending={remove.isPending}
        onCancel={() => setRemoveOpen(false)}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

// Kept separate so the close guard always observes the latest form state.
function useReportState(
  dirty: boolean,
  busy: boolean,
  onDirty: (value: boolean) => void,
  onBusy: (value: boolean) => void,
) {
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
