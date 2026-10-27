"use client";

import { useEffect, useState, useSyncExternalStore, type ImgHTMLAttributes } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthSessionVersion, subscribeAccessToken } from "@/lib/api/client";
import { getMediaBlob, managedMediaPath } from "@/lib/api/media";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import { QUERY_KEYS } from "@/constants";

type MediaImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  alt: string;
  fill?: boolean;
  unoptimized?: boolean;
  priority?: boolean;
};

/** Managed images use authorized no-store bytes, never the Next optimizer or provider URL. */
export function MediaImage({ src, alt, fill, unoptimized: _unoptimized, priority, className, ...props }: MediaImageProps) {
  const viewer = useAuthStore((state) => state.user?.id ?? null);
  const loading = useAuthStore((state) => state.isLoading);
  const session = useSyncExternalStore(subscribeAccessToken, getAuthSessionVersion, () => 0);
  const managed = !!managedMediaPath(src);
  const identity = `${viewer ?? "anonymous"}:${session}:${src}`;
  const image = useQuery({
    queryKey: QUERY_KEYS.media.image(viewer, session, src),
    queryFn: ({ signal }) => getMediaBlob(src, signal),
    enabled: managed && !loading,
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: true,
  });
  const [resolved, setResolved] = useState<{ identity: string; url: string } | null>(null);
  useEffect(() => {
    if (!managed || !image.data || image.isError) return;
    const url = URL.createObjectURL(image.data);
    setResolved({ identity, url });
    return () => URL.revokeObjectURL(url);
  }, [managed, image.data, image.isError, identity]);
  const source = managed ? (!image.isError && resolved?.identity === identity ? resolved.url : undefined) : src;
  // eslint-disable-next-line @next/next/no-img-element -- authorization requires a browser Blob URL.
  return <img {...props} alt={alt} src={source} loading={priority ? "eager" : props.loading}
    className={cn(fill && "absolute inset-0 h-full w-full", className)} />;
}
