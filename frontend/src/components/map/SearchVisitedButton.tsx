"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Footprints, Loader2 } from "lucide-react";
import { MarkVisitedButton } from "@/components/location/MarkVisitedButton";
import {
  assertTravelSession,
  secondaryClass,
  travelError,
} from "@/components/location/visited/shared";
import { useAuth } from "@/hooks/useAuth";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { createLocationFromPlace, type PlaceSuggestion } from "@/lib/api";
import type { PickedLocation } from "@/lib/post-location";
import { useAuthStore } from "@/stores/authStore";
import { QUERY_KEYS } from "@/constants";
import type { Location } from "@/types";

export function SearchVisitedButton({
  selection,
}: {
  selection: PickedLocation;
}) {
  const { user, isLoading } = useAuth();
  if (selection.kind === "existing")
    return (
      <MarkVisitedButton
        key={selection.location.id}
        location={selection.location}
      />
    );
  return (
    <ExternalVisitedButton
      key={`${selection.place.key}:${user?.id ?? "guest"}`}
      place={selection.place}
      viewer={user?.id ?? null}
      authLoading={isLoading}
    />
  );
}

function ExternalVisitedButton({
  place,
  viewer,
  authLoading,
}: {
  place: PlaceSuggestion;
  viewer: string | null;
  authLoading: boolean;
}) {
  const requireAuth = useRequireAuth();
  const cache = useQueryClient();
  const [resolved, setResolved] = useState<Location | null>(null);
  const resolve = useMutation({
    mutationFn: () => {
      assertTravelSession(viewer ?? "guest");
      return createLocationFromPlace(place);
    },
    onSuccess: (location) => {
      if (useAuthStore.getState().user?.id !== viewer) return;
      setResolved(location);
      void cache.invalidateQueries({ queryKey: QUERY_KEYS.locations.all });
      void cache.invalidateQueries({ queryKey: ["place-search"] });
    },
  });
  if (resolved) return <MarkVisitedButton location={resolved} openOnMount />;
  return (
    <div>
      <button
        type="button"
        disabled={authLoading || resolve.isPending}
        className={`${secondaryClass} w-full`}
        aria-haspopup="dialog"
        onClick={() => {
          if (requireAuth("Đăng nhập để lưu những địa điểm bạn đã ghé thăm"))
            resolve.mutate();
        }}
      >
        {resolve.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Footprints className="h-4 w-4" aria-hidden />
        )}
        {resolve.isPending
          ? "Đang chuẩn bị địa điểm…"
          : resolve.isError
            ? "Thử đánh dấu lại"
            : "Đánh dấu đã đến"}
      </button>
      {resolve.isError && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {travelError(resolve.error)}
        </p>
      )}
    </div>
  );
}
