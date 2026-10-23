import type { QueryClient } from "@tanstack/react-query";
import type { NotificationType } from "@/types";

export interface NotificationChangedEvent {
  notification_id: string;
  recipient_id: string;
  type: NotificationType;
  change: "created" | "read" | "deleted";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseNotificationChanged(value: unknown): NotificationChangedEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (typeof event.notification_id !== "string" || !UUID.test(event.notification_id)
    || typeof event.recipient_id !== "string" || !UUID.test(event.recipient_id)
    || typeof event.type !== "string" || !["follow", "like", "comment", "comment_like", "reply"].includes(event.type)
    || typeof event.change !== "string" || !["created", "read", "deleted"].includes(event.change)) return null;
  return {
    notification_id: event.notification_id,
    recipient_id: event.recipient_id,
    type: event.type as NotificationChangedEvent["type"],
    change: event.change as NotificationChangedEvent["change"],
  };
}

/** Cancel even an initial fetch: invalidating alone can reuse its pre-event snapshot. */
export async function refreshNotificationQueries(
  client: Pick<QueryClient, "cancelQueries" | "invalidateQueries">,
  keys: readonly (readonly unknown[])[],
  isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent()) return;
  await Promise.all(keys.map((queryKey) => client.cancelQueries({ queryKey, exact: true })));
  if (!isCurrent()) return;
  await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey, exact: true })));
}

/** Events are hints; only REST responses populate notification lists and counters. */
export function createNotificationSync({ getUserId, invalidate }: {
  getUserId: () => string | null;
  invalidate: (userId: string) => void;
}) {
  const seen = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    seen.clear();
  };
  const refresh = (userId: string) => {
    if (disposed || getUserId() !== userId || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      if (!disposed && getUserId() === userId) invalidate(userId);
    }, 100);
  };

  return {
    refresh,
    receive(userId: string, payload: unknown): boolean {
      const event = parseNotificationChanged(payload);
      if (disposed || !event || event.recipient_id !== userId || getUserId() !== userId) return false;
      const now = Date.now();
      for (const [key, expiresAt] of seen) if (expiresAt <= now) seen.delete(key);
      const key = `${userId}:${event.notification_id}:${event.change}`;
      if (seen.has(key)) return false;
      seen.set(key, now + 60_000);
      if (seen.size > 256) seen.delete(seen.keys().next().value!);
      refresh(userId);
      return true;
    },
    clear,
    dispose() {
      disposed = true;
      clear();
    },
  };
}

