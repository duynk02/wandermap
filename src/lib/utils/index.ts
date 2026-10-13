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
  // If already a full URL (Google OAuth), return as-is
  if (avatarPath.startsWith("http")) return avatarPath;
  // Otherwise it's a Supabase Storage path
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${avatarPath}`;
}

export function getPostImageUrl(imagePath: string): string {
  if (imagePath.startsWith("http")) return imagePath;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/post-images/${imagePath}`;
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
