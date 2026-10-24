"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MapPin, Star, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getLocationById, getPostsByLocation } from "@/lib/api";
import { useMapStore } from "@/stores/mapStore";
import { QUERY_KEYS, ROUTES } from "@/constants";
import { PostCard } from "@/components/post/PostCard";
import { cn } from "@/lib/utils";
import { MarkVisitedButton } from "./MarkVisitedButton";
import { ShareContentButton } from "@/components/messaging/ShareContentButton";
import { locationShareTarget } from "@/lib/messaging/share";

async function fetchLocationPreview(id: string) {
  const [location, posts] = await Promise.all([getLocationById(id), getPostsByLocation(id, 1)]);
  if (!location) throw new Error("Location not found");
  return { location, posts };
}

export function LocationDrawer() {
  const { selectedLocationId, isDrawerOpen, setDrawerOpen } = useMapStore();

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEYS.locations.byId(selectedLocationId ?? ""),
    queryFn: () => fetchLocationPreview(selectedLocationId!),
    enabled: !!selectedLocationId,
  });

  // Close on Escape key
  useEffect(() => {
    // Nested Radix dialogs handle Escape first; keep the underlying drawer open.
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector('[role="dialog"][data-state="open"]')) setDrawerOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setDrawerOpen]);

  return (
    <AnimatePresence>
      {isDrawerOpen && (
        <>
          {/* Backdrop — mobile only */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/20 backdrop-blur-sm sm:hidden"
          />

          {/* Drawer panel */}
          <motion.aside
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={cn(
              "absolute right-0 top-0 bottom-0 z-40",
              "w-full sm:w-[420px]",
              "bg-white dark:bg-surface shadow-2xl overflow-y-auto"
            )}
          >
            {/* Close button */}
            <button
              onClick={() => setDrawerOpen(false)}
              className="absolute right-4 top-4 z-10 rounded-full bg-surface-muted p-2 hover:bg-surface-elevated transition-colors"
              aria-label="Đóng"
            >
              <X className="h-4 w-4" />
            </button>

            {isLoading ? (
              <DrawerSkeleton />
            ) : data ? (
              <DrawerContent data={data} />
            ) : null}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function DrawerContent({ data }: { data: Awaited<ReturnType<typeof fetchLocationPreview>> }) {
  const { location, posts } = data;

  return (
    <div className="pb-8">
      {/* Location header */}
      <div className="p-6 pb-4">
        <div className="mb-1 flex items-center gap-1.5 text-xs text-ink-muted">
          <MapPin className="h-3.5 w-3.5" />
          <span>{[location.city, location.country].filter(Boolean).join(", ")}</span>
        </div>
        <h2 className="text-2xl font-bold text-ink">{location.name}</h2>

        <div className="mt-3 flex items-center gap-4 text-sm text-ink-muted">
          {location.avg_rating && (
            <span className="flex items-center gap-1">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              <strong className="text-ink">{location.avg_rating.toFixed(1)}</strong>
            </span>
          )}
          <span>{location.post_count} bài đăng</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3"><MarkVisitedButton location={location} /><ShareContentButton target={locationShareTarget(location)} /></div>
      </div>

      {/* Preview posts */}
      <div className="space-y-4 px-6">
        {posts.data?.slice(0, 3).map((post) => (
          <PostCard key={post.id} post={post} compact />
        ))}
      </div>

      {/* See all CTA */}
      <div className="mt-6 px-6">
        <Link href={ROUTES.location(location.id)}>
          <button className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 py-3.5 font-semibold text-white hover:bg-brand-600 transition-colors">
            Xem tất cả {location.post_count} bài đăng
            <ArrowRight className="h-4 w-4" />
          </button>
        </Link>
      </div>
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="animate-pulse p-6 space-y-4">
      <div className="h-3 w-1/3 rounded bg-surface-muted" />
      <div className="h-7 w-2/3 rounded bg-surface-muted" />
      <div className="h-4 w-1/4 rounded bg-surface-muted" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-32 rounded-2xl bg-surface-muted" />
      ))}
    </div>
  );
}
