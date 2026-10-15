import { apiFetch } from "./client";

export interface UploadedImage {
  /** Absolute, public URL to store on the post. */
  url: string;
  width: number;
  height: number;
  bytes: number;
}

/** Requires login. The server re-encodes to WebP (max 2048px) and strips EXIF metadata. */
export function uploadImage(file: File, signal?: AbortSignal) {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<UploadedImage>("/uploads/images", { method: "POST", body: form, signal });
}