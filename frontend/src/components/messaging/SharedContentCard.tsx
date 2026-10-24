"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ImageOff,
  Loader2,
  MapPin,
  Route,
  FileText,
  LockKeyhole,
} from "lucide-react";
import { LOCATION_CATEGORIES, ROUTES } from "@/constants";
import { getLocationById } from "@/lib/api/locations";
import type { SharedContentType } from "@/lib/messaging/share";
import { safeMessageHref } from "@/lib/messaging/model";
import { cn } from "@/lib/utils";
import { useMapStore } from "@/stores/mapStore";
import type { SharedMessageResource } from "@/types/messaging";

export function SharedContentCard({
  type,
  resource,
  own = false,
  preview = false,
  refreshing = false,
  failed = false,
}: {
  type: SharedContentType;
  resource: SharedMessageResource | null;
  own?: boolean;
  preview?: boolean;
  refreshing?: boolean;
  failed?: boolean;
}) {
  const router = useRouter();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [opening, setOpening] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [brokenImage, setBrokenImage] = useState<string | null>(null);
  const image = resource?.image_url && safeMessageHref(resource.image_url);
  const shell = cn(
    "my-1 w-full min-w-0 max-w-sm overflow-hidden rounded-xl border",
    own
      ? "border-white/25 bg-brand-700 text-white"
      : "border-border bg-surface",
  );
  if (refreshing || failed)
    return (
      <div data-testid="shared-content-card" className={shell} role="status">
        {resource?.image_url && (
          <div className="aspect-[16/9] animate-pulse bg-surface-muted" />
        )}
        <p className="flex items-center gap-2 p-4 text-xs">
          <Loader2
            className={cn("h-4 w-4", refreshing && "animate-spin")}
            aria-hidden
          />
          {refreshing
            ? "Đang cập nhật nội dung chia sẻ…"
            : "Chưa xác minh được nội dung chia sẻ. Hãy thử tải lại tin nhắn."}
        </p>
      </div>
    );
  if (missing || !resource?.available || !resource.id)
    return (
      <div
        data-testid="shared-content-unavailable"
        className={cn(shell, "flex items-start gap-2 p-3 text-xs")}
      >
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>Nội dung được chia sẻ đã bị xóa hoặc bạn không còn quyền xem.</p>
      </div>
    );
  const Icon =
    type === "shared_post"
      ? FileText
      : type === "shared_location"
        ? MapPin
        : Route;
  const label =
    type === "shared_post"
      ? "Bài viết"
      : type === "shared_location"
        ? "Địa điểm"
        : "Hành trình";
  const href =
    type === "shared_post"
      ? ROUTES.post(resource.id)
      : type === "shared_location"
        ? ROUTES.location(resource.id)
        : ROUTES.journey(resource.id);
  const content = (
    <>
      {image && brokenImage !== image && (
        <div className="aspect-[16/9] overflow-hidden bg-surface-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt=""
            width={360}
            height={203}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setBrokenImage(image)}
            className="h-full w-full object-cover"
          />
        </div>
      )}
      {image && brokenImage === image && (
        <div className="flex aspect-[16/9] items-center justify-center bg-surface-muted text-ink-muted">
          <ImageOff className="h-7 w-7" aria-hidden />
        </div>
      )}
      <div className="space-y-2 p-3">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-80">
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {label}
        </p>
        {resource.author && (
          <p className="truncate text-xs font-semibold">
            {resource.author.display_name}
          </p>
        )}
        <p className="line-clamp-3 text-sm font-medium leading-5 [overflow-wrap:anywhere]">
          {resource.title || `Xem ${label.toLocaleLowerCase("vi")}`}
        </p>
        {type === "shared_post" && resource.location && (
          <p className="flex items-start gap-1 text-xs opacity-80">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            {resource.location.name}
          </p>
        )}
        {resource.address && (
          <p className="line-clamp-2 break-words text-xs opacity-80">
            {resource.address}
          </p>
        )}
        {resource.category && (
          <p className="text-xs opacity-80">
            {LOCATION_CATEGORIES.find(
              (category) => category.value === resource.category,
            )?.label ?? resource.category}
          </p>
        )}
        {!preview && (
          <p className="flex items-center gap-1 text-xs font-semibold">
            {type === "shared_post"
              ? "Xem bài viết"
              : type === "shared_location"
                ? "Xem địa điểm"
                : "Xem hành trình"}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </p>
        )}
      </div>
    </>
  );
  return (
    <div
      data-testid="shared-content-card"
      data-shared-type={type}
      className={shell}
    >
      {preview ? (
        content
      ) : (
        <Link
          href={href}
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {content}
        </Link>
      )}
      {!preview && type === "shared_location" && (
        <div
          className={cn(
            "border-t px-3 pb-2 pt-1",
            own ? "border-white/20" : "border-border",
          )}
        >
          <button
            type="button"
            disabled={opening}
            className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold underline underline-offset-2 disabled:opacity-60"
            onClick={async () => {
              setOpening(true);
              setMapError(null);
              try {
                // Resolve authoritative coordinates only when opening; chat messages hold a reference.
                const location = await getLocationById(resource.id!);
                if (!alive.current) return;
                if (!location) {
                  setMissing(true);
                  return;
                }
                const store = useMapStore.getState();
                store.setViewport({
                  ...store.viewport,
                  latitude: location.coordinates.lat,
                  longitude: location.coordinates.lng,
                  zoom: 14,
                });
                store.setSelectedLocation(location.id);
                store.setFlyToTarget({
                  latitude: location.coordinates.lat,
                  longitude: location.coordinates.lng,
                  zoom: 14,
                });
                router.push(ROUTES.explore);
              } catch {
                setMapError("Chưa mở được bản đồ. Hãy thử lại.");
              } finally {
                setOpening(false);
              }
            }}
          >
            {opening ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MapPin className="h-3.5 w-3.5" />
            )}
            Xem trên bản đồ
          </button>
          {mapError && (
            <p role="alert" className="pb-2 text-xs">
              {mapError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
