import { isUUID } from 'class-validator';
import type { NotificationType } from './notifications.service';

/** An invalidation signal, not a second representation of the grouped REST list. */
export interface NotificationChangedEvent {
  notification_id: string;
  recipient_id: string;
  type: NotificationType;
  change: 'created' | 'read' | 'deleted';
}

export function parseNotificationChange(payload: string): NotificationChangedEvent | null {
  if (payload.length > 1024) return null;
  let value: unknown;
  try { value = JSON.parse(payload); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.notification_id !== 'string' || !isUUID(item.notification_id)
    || typeof item.recipient_id !== 'string' || !isUUID(item.recipient_id)
    || typeof item.type !== 'string' || !['follow', 'like', 'comment'].includes(item.type)
    || typeof item.change !== 'string' || !['created', 'read', 'deleted'].includes(item.change)) return null;
  // Construct an allowlisted payload; never forward unknown DB payload fields.
  return {
    notification_id: item.notification_id, recipient_id: item.recipient_id,
    type: item.type as NotificationType, change: item.change as NotificationChangedEvent['change'],
  };
}
