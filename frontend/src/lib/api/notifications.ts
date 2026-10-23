import type { NotificationItem, PaginatedResponse } from "@/types";
import { apiFetch } from "./client";

/** Requires login. Likes/comments on the same post come back as one item; newest first. */
export const getNotifications = (page = 1, signal?: AbortSignal) =>
  apiFetch<PaginatedResponse<NotificationItem>>("/notifications", { query: { page, pageSize: 20 }, signal });

/** Requires login. Unread interactions: every new like, comment or follow adds one. */
export const getUnreadNotificationCount = (signal?: AbortSignal) =>
  apiFetch<{ count: number }>("/notifications/unread-count", { signal });

/** Requires login. */
export const markAllNotificationsRead = () =>
  apiFetch<{ updated: number }>("/notifications/read-all", { method: "POST" });

/** Mark one displayed group (a follow UUID or a like/comment post group) as read. */
export const markNotificationRead = (groupId: string) =>
  apiFetch<{ updated: number }>("/notifications/read", { method: "POST", body: { group_id: groupId } });
