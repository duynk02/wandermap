"use client";

import { useEffect, useRef, useCallback } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

interface UseInfiniteScrollOptions<T> {
  queryKey: readonly unknown[];
  queryFn: (page: number) => Promise<{ data: T[]; hasMore: boolean }>;
  enabled?: boolean;
}

export function useInfiniteScroll<T>({
  queryKey,
  queryFn,
  enabled = true,
}: UseInfiniteScrollOptions<T>) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError } =
    useInfiniteQuery({
      queryKey,
      queryFn: ({ pageParam = 1 }) => queryFn(pageParam as number),
      getNextPageParam: (lastPage, pages) =>
        lastPage.hasMore ? pages.length + 1 : undefined,
      initialPageParam: 1,
      enabled,
    });

  const items = data?.pages.flatMap((p) => p.data) ?? [];

  // IntersectionObserver to trigger next page fetch
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage]
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(handleObserver, { threshold: 0.1 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleObserver]);

  return { items, sentinelRef, isLoading, isError, isFetchingNextPage, hasNextPage };
}
