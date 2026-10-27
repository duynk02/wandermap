"use client";

import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CalendarDays,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  addLocationVisit,
  getLocationVisits,
  removeLocationVisit,
  updateLocationVisit,
} from "@/lib/api";
import {
  locationVisitSchema,
  type LocationVisitInput,
} from "@/lib/validations";
import { QUERY_KEYS } from "@/constants";
import type { LocationVisit } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { VisitPostPicker } from "./VisitPostPicker";
import {
  assertTravelSession,
  fieldClass,
  formatTravelDate,
  primaryClass,
  secondaryClass,
  TravelConfirm,
  travelError,
} from "./shared";

type Action =
  | { kind: "create"; values: LocationVisitInput }
  | { kind: "update"; visitId: string; values: LocationVisitInput }
  | { kind: "delete"; visitId: string };

export function VisitHistory({
  markId,
  locationId,
  viewer,
  disabled,
  onChanged,
  onDirty,
  onBusy,
}: {
  markId: string;
  locationId: string;
  viewer: string;
  disabled: boolean;
  onChanged: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [editing, setEditing] = useState<LocationVisit | "new" | null>(null);
  const [deleting, setDeleting] = useState<LocationVisit | null>(null);
  const history = useInfiniteQuery({
    queryKey: QUERY_KEYS.visitedLocations.visits(viewer, markId),
    queryFn: ({ pageParam }) => getLocationVisits(markId, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    retry: 1,
  });
  const mutation = useMutation({
    mutationFn: async (action: Action): Promise<unknown> => {
      assertTravelSession(viewer);
      if (action.kind === "delete")
        return removeLocationVisit(markId, action.visitId);
      const body = {
        visited_at: action.values.visited_at,
        note: action.values.note || null,
      };
      return action.kind === "create"
        ? addLocationVisit(markId, body)
        : updateLocationVisit(markId, action.visitId, body);
    },
    onSuccess: async (_result, action) => {
      if (useAuthStore.getState().user?.id !== viewer) return;
      setEditing(null);
      setDeleting(null);
      onDirty(false);
      await onChanged();
      toast.success(
        action.kind === "delete"
          ? "Đã xóa lần ghé thăm. Địa điểm vẫn được giữ trong bản đồ của bạn."
          : "Đã lưu lần ghé thăm",
        { id: "visited-locations-feedback", duration: 2500 },
      );
    },
    onError: (error) => {
      toast.error(travelError(error), { id: "visited-locations-feedback" });
    },
  });
  useEffect(() => {
    onBusy(mutation.isPending);
  }, [mutation.isPending, onBusy]);
  const blocked = disabled || mutation.isPending;
  const visits = history.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <section
      aria-labelledby="visit-history-title"
      className="border-t border-border pt-6"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3
            id="visit-history-title"
            className="flex items-center gap-2 text-sm font-semibold text-ink"
          >
            <RotateCcw className="h-4 w-4 text-brand-600" />
            Những lần ghé thăm
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            Mỗi ngày là một kỷ niệm mới.
          </p>
        </div>
        <button
          type="button"
          disabled={
            blocked || !!editing || history.isPending || history.isError
          }
          onClick={() => setEditing("new")}
          className={`${secondaryClass} !min-h-10 !px-3 !text-xs`}
        >
          <Plus className="h-4 w-4" />
          Thêm lần đến
        </button>
      </div>
      {history.isPending ? (
        <div
          className="mt-4 h-20 animate-pulse rounded-2xl bg-surface-muted"
          role="status"
          aria-label="Đang tải lịch sử ghé thăm"
        />
      ) : history.isError ? (
        <div className="mt-4 rounded-2xl bg-surface-muted p-4 text-sm">
          <p role="alert">Không thể tải lịch sử ghé thăm.</p>
          <button
            type="button"
            className="mt-2 font-medium text-brand-700 dark:text-brand-400"
            onClick={() => void history.refetch()}
          >
            Thử lại
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {editing === "new" && (
            <VisitForm
              key="new"
              locationId={locationId}
              viewer={viewer}
              pending={blocked}
              onDirty={onDirty}
              onCancel={() => {
                setEditing(null);
                onDirty(false);
              }}
              onSave={async (values) => {
                await mutation.mutateAsync({ kind: "create", values });
              }}
            />
          )}
          {!visits.length && editing !== "new" && (
            <div className="rounded-2xl border border-dashed border-border bg-surface-muted/50 p-5 text-center">
              <CalendarDays className="mx-auto h-6 w-6 text-ink-subtle" />
              <p className="mt-2 text-sm text-ink-muted">
                Chưa có ngày ghé thăm.
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Không nhớ ngày cũng không sao, địa điểm đã được lưu.
              </p>
            </div>
          )}
          {visits.map((visit) =>
            editing !== "new" && editing?.id === visit.id ? (
              <VisitForm
                key={visit.id}
                locationId={locationId}
                viewer={viewer}
                visit={visit}
                pending={blocked}
                onDirty={onDirty}
                onCancel={() => {
                  setEditing(null);
                  onDirty(false);
                }}
                onSave={async (values) => {
                  await mutation.mutateAsync({
                    kind: "update",
                    visitId: visit.id,
                    values,
                  });
                }}
              />
            ) : (
              <div
                key={visit.id}
                className="flex gap-3 rounded-2xl border border-border bg-surface p-3.5"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-400">
                  <CalendarDays className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold tabular-nums text-ink">
                    {formatTravelDate(visit.visited_at)}
                  </p>
                  {visit.note && (
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-muted">
                      {visit.note}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  <button
                    type="button"
                    disabled={blocked || !!editing}
                    aria-label={`Sửa lần ghé thăm ${formatTravelDate(visit.visited_at)}`}
                    className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40"
                    onClick={() => setEditing(visit)}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={blocked || !!editing}
                    aria-label={`Xóa lần ghé thăm ${formatTravelDate(visit.visited_at)}`}
                    className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-950 disabled:opacity-40"
                    onClick={() => setDeleting(visit)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ),
          )}
          {history.hasNextPage && (
            <button
              type="button"
              className={`${secondaryClass} w-full`}
              disabled={blocked || history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {history.isFetchingNextPage && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Xem thêm kỷ niệm
            </button>
          )}
        </div>
      )}
      <TravelConfirm
        open={!!deleting}
        title="Xóa lần ghé thăm này?"
        description="Chỉ ngày và ghi chú của lần này bị xóa. Địa điểm và các lần ghé thăm khác vẫn được giữ."
        label="Xóa lần ghé thăm"
        pending={mutation.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting)
            mutation.mutate({ kind: "delete", visitId: deleting.id });
        }}
      />
    </section>
  );
}

function VisitForm({
  visit,
  locationId,
  viewer,
  pending,
  onDirty,
  onCancel,
  onSave,
}: {
  visit?: LocationVisit;
  locationId: string;
  viewer: string;
  pending: boolean;
  onDirty: (dirty: boolean) => void;
  onCancel: () => void;
  onSave: (values: LocationVisitInput) => Promise<void>;
}) {
  const [discard, setDiscard] = useState(false);
  const form = useForm<LocationVisitInput>({
    resolver: zodResolver(locationVisitSchema),
    defaultValues: {
      visited_at: visit?.visited_at ?? "",
      note: visit?.note ?? "",
    },
    mode: "onBlur",
  });
  const { isDirty, isSubmitting, errors } = form.formState;
  useEffect(() => {
    onDirty(isDirty);
  }, [isDirty, onDirty]);
  const busy = pending || isSubmitting;
  return (
    <>
      <form
        className="space-y-3 rounded-2xl border border-brand-200 bg-brand-50/40 p-4 dark:border-brand-900 dark:bg-brand-950/30"
        onSubmit={form.handleSubmit(async (values) => {
          try {
            await onSave(values);
          } catch (error) {
            form.setError("root", { message: travelError(error) });
          }
        })}
      >
        <p className="text-sm font-semibold text-ink">
          {visit ? "Chỉnh sửa kỷ niệm" : "Thêm một lần ghé thăm"}
        </p>
        <VisitPostPicker locationId={locationId} viewer={viewer} disabled={busy} onApply={(values) => {
          form.setValue("visited_at", values.visited_at, { shouldDirty: true, shouldValidate: true });
          form.setValue("note", values.note, { shouldDirty: true, shouldValidate: true });
          form.clearErrors("root");
        }} />
        <div>
          <label
            className="mb-1.5 block text-xs font-medium text-ink"
            htmlFor="visit-date"
          >
            Ngày ghé thăm
          </label>
          <input
            id="visit-date"
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            className={fieldClass}
            disabled={busy}
            aria-invalid={!!errors.visited_at}
            aria-describedby={
              errors.visited_at ? "visit-date-error" : undefined
            }
            {...form.register("visited_at")}
            autoFocus
          />
          {errors.visited_at && (
            <p
              id="visit-date-error"
              className="mt-1 text-xs text-red-600"
              role="alert"
            >
              {errors.visited_at.message}
            </p>
          )}
        </div>
        <div>
          <label
            className="mb-1.5 block text-xs font-medium text-ink"
            htmlFor="visit-note"
          >
            Ghi chú cho lần này
          </label>
          <textarea
            id="visit-note"
            rows={2}
            maxLength={1000}
            placeholder="Đi cùng ai, điều gì khiến bạn nhớ mãi…"
            className={`${fieldClass} resize-none`}
            disabled={busy}
            aria-invalid={!!errors.note}
            {...form.register("note")}
          />
          {errors.note && (
            <p className="text-xs text-red-600" role="alert">
              {errors.note.message}
            </p>
          )}
        </div>
        {errors.root && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {errors.root.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={secondaryClass}
            disabled={busy}
            onClick={() => (isDirty ? setDiscard(true) : onCancel())}
          >
            Hủy
          </button>
          <button
            type="submit"
            className={primaryClass}
            disabled={busy || (!!visit && !isDirty)}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}Lưu lần ghé
            thăm
          </button>
        </div>
      </form>
      <TravelConfirm
        open={discard}
        title="Bỏ thay đổi của lần ghé thăm?"
        description="Thông tin bạn vừa nhập chưa được lưu."
        label="Bỏ thay đổi"
        onCancel={() => setDiscard(false)}
        onConfirm={onCancel}
      />
    </>
  );
}
