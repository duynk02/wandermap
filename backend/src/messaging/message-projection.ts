import { postAccess } from '../posts/post-access';

const PROFILE = `jsonb_build_object('id', a.id, 'username', a.username, 'display_name', a.display_name, 'avatar_url', a.avatar_url)`;
const UNAVAILABLE = `jsonb_build_object('available', false, 'id', NULL, 'title', NULL, 'image_url', NULL,
  'author', NULL, 'location', NULL, 'address', NULL, 'category', NULL)`;

/** Alias m is a message; $1 is always the authenticated viewer. No cached previews. */
export const MESSAGE_JSON = `jsonb_build_object(
  'id', m.id, 'conversation_id', m.conversation_id, 'sender_id', m.sender_id,
  'sequence', m.sequence::text, 'client_message_id', m.client_message_id, 'message_type', m.message_type,
  'content', CASE WHEN m.deleted_at IS NULL THEN m.content END,
  'created_at', m.created_at, 'updated_at', m.updated_at, 'deleted_at', m.deleted_at,
  'shared_resource', CASE WHEN m.deleted_at IS NOT NULL OR m.message_type = 'text' THEN NULL ELSE COALESCE(
    CASE m.message_type
      WHEN 'shared_post' THEN (SELECT jsonb_build_object('available', true, 'id', p.id,
        'title', left(p.content, 180), 'image_url', p.images[1], 'author', ${PROFILE},
        'location', CASE WHEN l.id IS NOT NULL THEN jsonb_build_object('id', l.id, 'name', l.name) END,
        'address', NULL, 'category', NULL)
        FROM posts p JOIN profiles a ON a.id = p.author_id LEFT JOIN locations l ON l.id = p.location_id
        WHERE p.id = m.shared_post_id AND ${postAccess('$1')})
      WHEN 'shared_location' THEN (SELECT jsonb_build_object('available', true, 'id', l.id,
        'title', l.name, 'image_url', NULL, 'author', NULL, 'location', jsonb_build_object('id', l.id, 'name', l.name),
        'address', l.address, 'category', l.category) FROM locations l WHERE l.id = m.shared_location_id)
      WHEN 'shared_journey' THEN (SELECT jsonb_build_object('available', true, 'id', j.id,
        'title', j.title, 'image_url', j.cover_image_url, 'author', ${PROFILE}, 'location', NULL,
        'address', NULL, 'category', NULL)
        FROM journeys j JOIN profiles a ON a.id = j.user_id JOIN users u ON u.id = j.user_id
        WHERE j.id = m.shared_journey_id AND u.is_active = true
          AND (j.user_id = $1 OR (j.visibility = 'public' AND j.status = 'published')))
    END, ${UNAVAILABLE}) END)`;

/** Membership is part of every conversation projection, including paginated lists. */
export const CONVERSATION_SELECT = `SELECT jsonb_build_object(
  'id', c.id, 'type', c.type, 'created_at', c.created_at, 'updated_at', c.updated_at, 'last_message_at', c.last_message_at,
  'recipient', jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'is_active', u.is_active),
  'blocked_by_me', EXISTS (SELECT 1 FROM messaging_blocks b WHERE b.blocker_id = $1 AND b.blocked_id = p.id),
  'can_send', u.is_active AND NOT EXISTS (SELECT 1 FROM messaging_blocks b
    WHERE (b.blocker_id = $1 AND b.blocked_id = p.id) OR (b.blocker_id = p.id AND b.blocked_id = $1)),
  'read_state', jsonb_build_object('last_read_sequence', cp.last_read_sequence::text, 'last_read_at', cp.last_read_at),
  'recipient_read_state', jsonb_build_object('last_read_sequence', op.last_read_sequence::text, 'last_read_at', op.last_read_at),
  'unread_count', (SELECT count(*)::integer FROM messages unread WHERE unread.conversation_id = c.id
    AND unread.sequence > COALESCE(cp.last_read_sequence, 0) AND unread.sender_id <> $1 AND unread.deleted_at IS NULL),
  'last_message', CASE WHEN m.id IS NOT NULL THEN ${MESSAGE_JSON} END
  ) AS conversation,
  to_char(COALESCE(c.last_message_at, c.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
  FROM conversations c JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = $1
  JOIN conversation_participants op ON op.conversation_id = c.id AND op.user_id <> $1
  JOIN profiles p ON p.id = op.user_id JOIN users u ON u.id = p.id
  LEFT JOIN messages m ON m.conversation_id = c.id AND m.id = c.last_message_id`;
