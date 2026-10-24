"use client";

import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/constants";
import { getMessagingContacts } from "@/lib/api/messaging";
import { ApiError, getAuthSessionVersion } from "@/lib/api/client";
import { useAuthStore } from "@/stores/authStore";
import type { MessagingContactsKind } from "@/types/messaging";

export function useMessagingContacts(
  viewer: string,
  search = "",
  {
    kind = "friends",
    enabled = true,
  }: { kind?: MessagingContactsKind; enabled?: boolean } = {},
) {
  const [term, setTerm] = useState(search.trim());
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  return useInfiniteQuery({
    queryKey: QUERY_KEYS.messaging.contacts(viewer, term, kind),
    queryFn: async ({ pageParam, signal }) => {
      const version = getAuthSessionVersion();
      const current = () =>
        useAuthStore.getState().user?.id === viewer &&
        getAuthSessionVersion() === version;
      if (!current())
        throw new ApiError(
          401,
          "AUTH_SESSION_CHANGED",
          "Phiên đăng nhập đã thay đổi.",
        );
      const result = await getMessagingContacts(pageParam, term, signal, kind);
      if (!current())
        throw new ApiError(
          401,
          "AUTH_SESSION_CHANGED",
          "Phiên đăng nhập đã thay đổi.",
        );
      return result;
    },
    initialPageParam: 1,
    enabled,
    getNextPageParam: (last) => last.next_page ?? undefined,
    // Contacts can change before there is a conversation to carry a policy event.
    refetchInterval: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    retry: 1,
  });
}
