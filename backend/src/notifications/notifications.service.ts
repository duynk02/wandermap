import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { postAccess } from '../posts/post-access';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { parseNotificationChange } from './notification-events';

export type NotificationType = 'follow' | 'like' | 'comment' | 'comment_like' | 'reply';

export interface NotificationActor {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

/** One line in the notification list: all likes (or comments) on one post are a single item. */
export interface NotificationItem {
  /** Stable notification UUID, or "type:postId" for grouped post likes/comments. */
  id: string;
  type: NotificationType;
  /** The most recent distinct actors (at most 2), newest first. */
  actors: NotificationActor[];
  /** Total number of distinct people in this group. */
  actor_count: number;
  post: { id: string; excerpt: string; image: string | null } | null;
  /** True while at least one interaction in the group has not been read yet. */
  is_unread: boolean;
  /** Time of the latest interaction in the group. */
  created_at: string;
}

export interface NotificationPage {
  data: NotificationItem[];
  count: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// Only post likes/comments are grouped. Comment interactions keep their own stable ID.
const GROUP_KEY = `CASE WHEN n.type IN ('like', 'comment') THEN n.type || ':' || n.post_id::text ELSE n.id::text END`;
const EVENT_ACCESS = `(n.post_id IS NULL OR EXISTS (SELECT 1 FROM posts p WHERE p.id = n.post_id AND ${postAccess()}))`;

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DatabaseService, private readonly realtime: RealtimeGateway) {}

  /** Called only by the post-commit database listener; it never creates notifications. */
  async publishDatabaseChange(payload: string): Promise<void> {
    const event = parseNotificationChange(payload);
    if (event) await this.realtime.emitNotificationChange(event);
  }

  async list(userId: string, query: NotificationQueryDto): Promise<NotificationPage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [rows, total] = await Promise.all([
      this.db.query<NotificationItem>(
        `WITH events AS (
           SELECT n.actor_id, n.type, n.post_id, n.read_at, n.created_at, ${GROUP_KEY} AS group_key
           FROM notifications n WHERE n.recipient_id = $1 AND ${EVENT_ACCESS}
         ), groups AS (
           SELECT group_key, type, post_id,
                  COUNT(DISTINCT actor_id)::int AS actor_count,
                  bool_or(read_at IS NULL) AS is_unread,
                  MAX(created_at) AS created_at
           FROM events GROUP BY group_key, type, post_id
           ORDER BY MAX(created_at) DESC, group_key
           LIMIT $2 OFFSET $3
         )
         SELECT g.group_key AS id, g.type, g.actor_count, g.is_unread, g.created_at,
                (SELECT COALESCE(json_agg(json_build_object(
                          'id', a.id, 'username', a.username, 'display_name', a.display_name, 'avatar_url', a.avatar_url
                        ) ORDER BY a.last_at DESC), '[]'::json)
                 FROM (SELECT p.id, p.username, p.display_name, p.avatar_url, MAX(e.created_at) AS last_at
                       FROM events e JOIN profiles p ON p.id = e.actor_id
                       WHERE e.group_key = g.group_key
                       GROUP BY p.id ORDER BY MAX(e.created_at) DESC LIMIT 2) a) AS actors,
                CASE WHEN po.id IS NULL THEN NULL
                     ELSE json_build_object('id', po.id, 'excerpt', left(po.content, 80), 'image', po.images[1]) END AS post
         FROM groups g LEFT JOIN posts po ON po.id = g.post_id
         ORDER BY g.created_at DESC, g.group_key`,
        [userId, pageSize, (page - 1) * pageSize],
      ),
      this.db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM (SELECT 1 FROM notifications n WHERE n.recipient_id = $1 AND ${EVENT_ACCESS} GROUP BY ${GROUP_KEY}) t`,
        [userId],
      ),
    ]);

    const count = Number(total.rows[0]?.count ?? 0);
    return { data: rows.rows, count, page, pageSize, hasMore: (page - 1) * pageSize + rows.rows.length < count };
  }

  /** Authoritative number of unread interactions, including comment likes and replies. */
  async unreadCount(userId: string): Promise<{ count: number }> {
    const result = await this.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM notifications n WHERE n.recipient_id = $1 AND n.read_at IS NULL AND ${EVENT_ACCESS}`,
      [userId],
    );
    return { count: result.rows[0]?.count ?? 0 };
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.db.query('UPDATE notifications SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL', [userId]);
    return { updated: result.rowCount ?? 0 };
  }

  /** A list item groups likes/comments on a post; mark its actual unread rows atomically. */
  async markRead(userId: string, groupId: string): Promise<{ updated: number }> {
    const parts = groupId.split(':');
    const result = parts.length === 1
      ? await this.db.query(
        `UPDATE notifications n SET read_at = now()
         WHERE n.recipient_id = $1 AND n.id = $2::uuid AND n.type IN ('follow', 'comment_like', 'reply') AND n.read_at IS NULL AND ${EVENT_ACCESS}`,
        [userId, parts[0]],
      )
      : await this.db.query(
        `UPDATE notifications n SET read_at = now()
         WHERE n.recipient_id = $1 AND n.type = $2 AND n.post_id = $3::uuid AND n.read_at IS NULL AND ${EVENT_ACCESS}`,
        [userId, parts[0].toLowerCase(), parts[1]],
      );
    return { updated: result.rowCount ?? 0 };
  }
}
