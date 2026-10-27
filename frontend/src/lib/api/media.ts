import { apiFetch } from "./client";

/** Extract only our fixed media route; never fetch an arbitrary URL with credentials. */
export function managedMediaPath(source: string): string | null {
  try {
    const url = new URL(source, "https://wandermap.invalid");
    return /^\/api\/v1\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(url.pathname)
      && !url.search && !url.hash ? url.pathname.slice("/api/v1".length) : null;
  } catch { return null; }
}
export function getMediaBlob(source: string, signal: AbortSignal) {
  const path = managedMediaPath(source);
  if (!path) throw new Error("Đường dẫn ảnh không hợp lệ.");
  return apiFetch<Blob>(path, { responseType: "blob", signal });
}
