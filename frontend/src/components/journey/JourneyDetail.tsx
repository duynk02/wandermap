"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarDays,
  Globe2,
  LockKeyhole,
  Pencil,
  Route,
} from "lucide-react";
import { getJourney } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { QUERY_KEYS, ROUTES } from "@/constants";
import { TravelMap } from "@/components/map/TravelMap";
import {
  formatTravelDate,
  secondaryClass,
} from "@/components/location/visited/shared";
import { JourneyEditor } from "./JourneyCollection";

export function JourneyDetail({ id }: { id: string }) {
  const { user, isLoading } = useAuth();
  const viewer = user?.id ?? "guest";
  const [editing, setEditing] = useState(false);
  const query = useQuery({
    queryKey: QUERY_KEYS.journeys.byId(id, viewer),
    queryFn: () => getJourney(id),
    enabled: !isLoading,
    retry: 1,
  });
  const journey = query.data;
  const points = useMemo(
    () =>
      (journey?.stops ?? []).map((stop) => ({
        id: stop.id,
        location_id: stop.location_id,
        name: stop.location_name_snapshot,
        city: stop.location.city,
        country: stop.location.country,
        coordinates: stop.location.coordinates,
        last_visited_at: stop.visited_at_snapshot,
        visit_count: 0,
      })),
    [journey],
  );
  if (isLoading || query.isPending)
    return (
      <div className="mx-auto my-8 h-[650px] max-w-6xl animate-pulse rounded-3xl bg-surface-muted" />
    );
  if (!journey)
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <Route className="mx-auto h-10 w-10 text-brand-500" />
        <h1 className="mt-4 text-xl font-bold text-ink">
          Chưa thể xem hành trình
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          Hành trình có thể đang riêng tư, đã bị xóa hoặc kết nối đang gián
          đoạn.
        </p>
        <button
          type="button"
          onClick={() => query.refetch()}
          className={`${secondaryClass} mt-5`}
        >
          Thử lại
        </button>
        <Link href="/feed" className="ml-3 text-sm text-brand-600">
          Về bảng tin
        </Link>
      </div>
    );
  const owner = user?.id === journey.user_id;
  return (
    <article className="mx-auto max-w-6xl px-4 py-6 md:py-10">
      <Link
        href={ROUTES.profile(journey.author.username)}
        className="inline-flex items-center gap-2 text-xs font-medium text-ink-muted hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" />
        Bản đồ của {journey.author.display_name}
      </Link>
      <div className="mt-5 overflow-hidden rounded-3xl border border-border bg-surface">
        <header className="relative overflow-hidden bg-gradient-to-br from-brand-950 to-brand-700 p-6 text-white md:p-8">
          {journey.cover_image_url && (
            <>
              <Image
                src={journey.cover_image_url}
                alt=""
                fill
                unoptimized
                priority
                sizes="100vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-black/60" />
            </>
          )}
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em]">
                <Route className="h-4 w-4" />
                WanderMap Journey
              </p>
              {owner && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold backdrop-blur hover:bg-white/25"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Chỉnh sửa
                </button>
              )}
            </div>
            <h1 className="mt-5 break-words text-3xl font-bold md:text-4xl">
              {journey.title}
            </h1>
            {journey.description && (
              <p className="mt-3 max-w-2xl whitespace-pre-wrap break-words text-sm leading-relaxed text-white/85">
                {journey.description}
              </p>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-white/75">
              <span>{journey.stops.length} điểm đến</span>
              <span>·</span>
              <Link
                href={ROUTES.profile(journey.author.username)}
                className="hover:text-white"
              >
                {journey.author.display_name}
              </Link>
              {owner && (
                <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1">
                  {journey.visibility === "public" &&
                  journey.status === "published" ? (
                    <Globe2 className="h-3 w-3" />
                  ) : (
                    <LockKeyhole className="h-3 w-3" />
                  )}
                  {journey.status === "draft"
                    ? "Bản nháp"
                    : journey.visibility === "private"
                      ? "Chỉ mình tôi"
                      : "Công khai"}
                </span>
              )}
            </div>
          </div>
        </header>
        <div className="h-[440px] md:h-[550px]">
          <TravelMap points={points} journey style={journey.style_config} />
        </div>
        <ol className="grid gap-3 border-t border-border p-5 md:grid-cols-2 md:p-7">
          {journey.stops.map((stop, index) => (
            <li
              key={stop.id}
              className="flex items-start gap-3 rounded-2xl bg-surface-muted/50 p-4"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-sm font-bold text-brand-600">
                {index + 1}
              </span>
              <div className="min-w-0">
                <Link
                  href={ROUTES.location(stop.location_id)}
                  className="break-words text-sm font-semibold text-ink hover:text-brand-600"
                >
                  {stop.location_name_snapshot}
                </Link>
                <p className="mt-1 text-xs text-ink-muted">
                  {[stop.location.city, stop.location.country]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {stop.visited_at_snapshot && (
                  <p className="mt-2 flex items-center gap-1 text-[11px] text-ink-muted">
                    <CalendarDays className="h-3 w-3" />
                    {formatTravelDate(stop.visited_at_snapshot)}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
      {editing && owner && (
        <JourneyEditor
          id={id}
          viewer={viewer}
          onClose={() => setEditing(false)}
        />
      )}
    </article>
  );
}
