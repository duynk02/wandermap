"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Footprints,
  Globe2,
  List,
  Loader2,
  LockKeyhole,
  MapPin,
  Plus,
  Route,
  Search,
  X,
} from "lucide-react";
import { getPublicVisitedLocations, getTravelMap } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { QUERY_KEYS } from "@/constants";
import { TravelMap } from "@/components/map/TravelMap";
import { JourneyCollection } from "@/components/journey/JourneyCollection";
import {
  fieldClass,
  formatTravelDate,
} from "@/components/location/visited/shared";
import type { TravelFilters, TravelMapPoint } from "@/types";

const EMPTY_POINTS: TravelMapPoint[] = [];

export function ProfileTravelMap({
  userId,
  username,
}: {
  userId: string;
  username: string;
}) {
  const { user, isLoading } = useAuth();
  const viewer = user?.id ?? "guest";
  const isOwner = user?.id === userId;
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [year, setYear] = useState("");
  const [country, setCountry] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const filters: TravelFilters = useMemo(
    () => ({
      year: year ? Number(year) : undefined,
      country: country || undefined,
      search: debounced || undefined,
    }),
    [year, country, debounced],
  );
  const map = useQuery({
    queryKey: QUERY_KEYS.travelMap.data(username, viewer, filters),
    queryFn: () => getTravelMap(username, filters),
    enabled: !isLoading,
  });
  const list = useInfiniteQuery({
    queryKey: QUERY_KEYS.visitedLocations.public(username, viewer, filters),
    queryFn: ({ pageParam }) =>
      getPublicVisitedLocations(username, {
        ...filters,
        page: pageParam,
        pageSize: 20,
      }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) =>
      last.hasMore ? pages.length + 1 : undefined,
    enabled: !isLoading,
  });
  const filtered = !!(year || country || debounced);
  const data = map.data;
  const items = list.data?.pages.flatMap((page) => page.data) ?? [];
  if (isLoading)
    return (
      <div className="h-[600px] animate-pulse rounded-3xl bg-surface-muted" />
    );
  return (
    <div>
      <section
        className="overflow-hidden rounded-3xl border border-border bg-surface"
        aria-label="My Travel Map"
      >
        <div className="relative overflow-hidden bg-gradient-to-br from-brand-950 via-brand-900 to-brand-700 px-5 py-6 text-white sm:px-7">
          <div className="pointer-events-none absolute -right-8 -top-20 h-64 w-64 rounded-full border-[35px] border-white/5" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-brand-200">
                <Footprints className="h-3.5 w-3.5" />
                My Travel Map
              </p>
              <h2 className="mt-2 text-2xl font-bold">
                {isOwner
                  ? "Mỗi dấu chân, một kỷ niệm."
                  : "Những nơi đã đi qua."}
              </h2>
              <p className="mt-2 max-w-md text-xs leading-relaxed text-brand-100/80">
                {isOwner
                  ? "Khám phá bản đồ ký ức và nối những điểm đến thành hành trình của bạn."
                  : "Khám phá những địa điểm và hành trình được chia sẻ."}
              </p>
            </div>
            {isOwner && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-brand-900 shadow-md transition hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-white"
              >
                <Plus className="h-4 w-4" />
                Tạo hành trình
              </button>
            )}
          </div>
          <div className="relative mt-6 grid grid-cols-3 gap-3 border-t border-white/15 pt-5">
            {[
              {
                label: "Địa điểm đã đến",
                value: data?.statistics.location_count,
                icon: MapPin,
              },
              {
                label: "Lần ghé thăm",
                value: data?.statistics.visit_count,
                icon: CalendarDays,
              },
              {
                label: "Hành trình · tất cả",
                value: data?.statistics.journey_count,
                icon: Route,
              },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label}>
                <div className="flex items-center gap-2">
                  <Icon className="hidden h-4 w-4 text-brand-200 sm:block" />
                  <strong className="text-2xl font-bold tabular-nums">
                    {value == null ? "—" : value.toLocaleString("vi-VN")}
                  </strong>
                </div>
                <p className="mt-1 text-[10px] text-brand-100/80 sm:text-xs">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3 border-b border-border p-4 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative flex-1">
              <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-ink-muted" />
              <input
                aria-label="Tìm trên bản đồ du lịch"
                placeholder="Tìm địa điểm, thành phố…"
                maxLength={100}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className={`${fieldClass} pl-10`}
              />
            </label>
            <div className="flex gap-2">
              <select
                aria-label="Lọc theo năm ghé thăm"
                value={year}
                onChange={(event) => setYear(event.target.value)}
                className={`${fieldClass} min-w-0 sm:w-36`}
              >
                <option value="">Tất cả năm</option>
                {data?.options.years.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <select
                aria-label="Lọc theo quốc gia"
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                className={`${fieldClass} min-w-0 sm:w-40`}
              >
                <option value="">Mọi quốc gia</option>
                {data?.options.countries.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px] text-ink-muted">
            <span className="flex items-center gap-1.5">
              {isOwner ? (
                <LockKeyhole className="h-3 w-3" />
              ) : (
                <Globe2 className="h-3 w-3" />
              )}
              {isOwner
                ? "Bạn thấy cả địa điểm riêng tư của mình"
                : "Chỉ hiển thị địa điểm công khai"}
            </span>
            {filtered && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setDebounced("");
                  setYear("");
                  setCountry("");
                }}
                className="flex shrink-0 items-center gap-1 font-medium text-brand-600"
              >
                <X className="h-3 w-3" />
                Xóa bộ lọc
              </button>
            )}
          </div>
        </div>
        {map.isError && (
          <div
            role="alert"
            className="border-b border-border bg-red-500/10 p-3 text-xs text-red-600"
          >
            Không tải được dữ liệu bản đồ.{" "}
            <button
              type="button"
              onClick={() => map.refetch()}
              className="font-semibold underline"
            >
              Thử lại
            </button>
          </div>
        )}
        <div className="relative h-[610px] md:flex md:h-[570px]">
          <div
            className={`absolute inset-x-0 bottom-0 z-10 flex flex-col overflow-hidden rounded-t-2xl border-t border-border bg-surface/95 shadow-xl backdrop-blur transition-[max-height] duration-300 md:static md:z-auto md:max-h-none md:w-[290px] md:shrink-0 md:rounded-none md:border-r md:border-t-0 md:shadow-none ${expanded ? "max-h-[65%]" : "max-h-[130px]"}`}
          >
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
              className="flex w-full shrink-0 items-center justify-between px-4 py-3 text-sm font-semibold text-ink md:pointer-events-none"
            >
              <span className="flex items-center gap-2">
                <List className="h-4 w-4 text-brand-500" />
                Điểm đến{" "}
                <span className="text-xs font-normal text-ink-muted">
                  ({list.data?.pages[0].count ?? "…"})
                </span>
              </span>
              <span className="md:hidden">
                {expanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronUp className="h-4 w-4" />
                )}
              </span>
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
              {list.isPending && (
                <p className="p-4 text-xs text-ink-muted">Đang tải địa điểm…</p>
              )}
              {list.isError && (
                <button
                  type="button"
                  onClick={() => list.refetch()}
                  className="p-4 text-xs text-red-500"
                >
                  Chưa tải được danh sách. Thử lại
                </button>
              )}
              {list.isSuccess && !items.length && (
                <div className="px-3 py-6 text-center">
                  <MapPin className="mx-auto mb-2 h-6 w-6 text-brand-500/60" />
                  <p className="text-sm font-semibold text-ink">
                    {filtered
                      ? "Chưa có điểm đến phù hợp"
                      : "Bản đồ đang chờ dấu chân mới"}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                    {filtered
                      ? "Thử đổi năm hoặc xóa bộ lọc để xem thêm."
                      : isOwner
                        ? "Mở một địa điểm và chọn Đánh dấu đã đến."
                        : "Chủ hồ sơ chưa chia sẻ địa điểm nào."}
                  </p>
                  {isOwner && !filtered && (
                    <Link
                      href="/explore"
                      className="mt-3 inline-block text-xs font-semibold text-brand-600"
                    >
                      Khám phá địa điểm →
                    </Link>
                  )}
                </div>
              )}
              {items.map((mark, index) => (
                <div
                  key={mark.id}
                  className={`mb-1 rounded-xl p-3 transition-colors ${selected === mark.location_id ? "bg-brand-500/10" : "hover:bg-surface-muted"}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(mark.location_id);
                      setExpanded(false);
                    }}
                    className="flex w-full items-start gap-3 text-left"
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-[11px] font-semibold text-brand-600">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">
                        {mark.location.name}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                        {[mark.location.city, mark.location.country]
                          .filter(Boolean)
                          .join(" · ") || "Chưa có thông tin khu vực"}
                      </p>
                      <p className="mt-1.5 text-[12px] text-ink-muted">
                        {mark.last_visited_at
                          ? `${formatTravelDate(mark.last_visited_at)} · ${mark.visit_count} lần ghé thăm`
                          : "Chưa thêm ngày ghé thăm"}
                      </p>
                    </div>
                    {isOwner && mark.visibility === "private" && (
                      <LockKeyhole className="mt-1 h-3 w-3 shrink-0 text-ink-muted" />
                    )}
                  </button>
                  <Link
                    href={`/location/${mark.location_id}`}
                    className="ml-10 mt-1 inline-block text-[10px] font-medium text-brand-600"
                  >
                    Xem địa điểm →
                  </Link>
                </div>
              ))}
              {list.hasNextPage && (
                <button
                  type="button"
                  disabled={list.isFetchingNextPage}
                  onClick={() => list.fetchNextPage()}
                  className="w-full p-3 text-xs font-semibold text-brand-600"
                >
                  {list.isFetchingNextPage ? "Đang tải…" : "Xem thêm địa điểm"}
                </button>
              )}
            </div>
          </div>
          <div className="h-[calc(100%-100px)] w-full md:h-full md:min-w-0 md:flex-1">
            <TravelMap
              points={data?.points ?? EMPTY_POINTS}
              selectedId={selected}
              onSelect={setSelected}
            />
            {map.isFetching && (
              <span
                role="status"
                className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-[10px] text-ink shadow md:left-auto md:right-16"
              >
                <Loader2 className="h-3 w-3 animate-spin" />
                Đang cập nhật…
              </span>
            )}
          </div>
        </div>
        <p className="border-t border-border px-5 py-3 text-[12px] text-ink-muted">
          {filtered
            ? "Địa điểm và lần ghé thăm tính theo bộ lọc hiện tại. "
            : "Mỗi địa điểm chỉ được đếm một lần trên bản đồ. "}
          Địa điểm chưa có ngày ghé thăm vẫn xuất hiện khi chọn tất cả năm.
        </p>
      </section>
      <JourneyCollection
        key={`${username}:${viewer}`}
        username={username}
        viewer={viewer}
        isOwner={isOwner}
        createOpen={creating}
        onCreate={() => setCreating(true)}
        onCreateClose={() => setCreating(false)}
      />
    </div>
  );
}
