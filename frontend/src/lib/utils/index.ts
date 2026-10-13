import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow, format } from "date-fns";
import { vi } from "date-fns/locale";

// ── Tailwind class merging ───────────────────────────────────────────────────
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── Date formatting ──────────────────────────────────────────────────────────
export function timeAgo(date: string | Date): string {
  return formatDistanceToNow(new Date(date), {
    addSuffix: true,
    locale: vi,
  });
}

export function formatDate(date: string | Date, fmt = "dd/MM/yyyy"): string {
  return format(new Date(date), fmt, { locale: vi });
}

// ── Image URLs ───────────────────────────────────────────────────────────────
export function getAvatarUrl(avatarPath: string | null, fallbackSeed?: string): string {
  if (!avatarPath) {
    const seed = fallbackSeed ?? "default";
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;
  }
  // The API only accepts absolute http(s) URLs for avatars; anything else falls back.
  if (avatarPath.startsWith("http")) return avatarPath;
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${fallbackSeed ?? "default"}`;
}

// The API stores absolute image URLs (object storage/CDN is a separate backend task).
export function getPostImageUrl(imagePath: string): string {
  return imagePath;
}

// ── Number formatting ────────────────────────────────────────────────────────
export function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return count.toString();
}

// ── URL helpers ──────────────────────────────────────────────────────────────
export function getProfileUrl(username: string): string {
  return `/profile/${username}`;
}

export function getLocationUrl(locationId: string): string {
  return `/location/${locationId}`;
}

export function getPostUrl(postId: string): string {
  return `/post/${postId}`;
}
