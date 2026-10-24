import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { postAccess } from '../posts/post-access';
import { ConversationQueryDto, CreateMessageDto, MessageQueryDto, ReadConversationDto } from './dto/messaging.dto';
import { CONVERSATION_SELECT, MESSAGE_JSON } from './message-projection';
import { MessagingPolicyService } from './messaging-policy.service';
import { MessagingEventPublisher } from './messaging-events.publisher';
import { messagingAllowed, messagingUnblocked } from './messaging-access';
import { ContactsQueryDto } from './dto/contacts-query.dto';
import type { ConversationDto, CursorPage, MessageDto, MessagingUnreadCount, ReadConversationResult, SendMessageResult } from './messaging.types';

interface MemberConversation { id: string; recipient_id: string; last_read_sequence: string | null; }
interface ConversationRow { conversation: ConversationDto; cursor_time: string; }
interface StoredMessage { id: string; conversation_id: string; message_type: string; content: string | null; shared_resource_id: string | null; }

function sequence(value: string): string {
  if (!/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new BadRequestException('Sequence phải là chuỗi số nguyên dương hợp lệ.');
  }
  return value;
}

function decodeCursor(value?: string): [string, string] | null {
  if (value === undefined) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,300}$/.test(value) || Buffer.from(value, 'base64url').toString('base64url') !== value) throw new Error();
    const data: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(data) || data.length !== 2 || typeof data[0] !== 'string' || typeof data[1] !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(data[0]) || !isUUID(data[1])
      || new Date(data[0]).toISOString().slice(0, 19) !== data[0].slice(0, 19)) throw new Error();
    return [data[0], data[1].toLowerCase()];
  } catch { throw new BadRequestException('Cursor cuộc trò chuyện không hợp lệ.'); }
}

@Injectable()
export class MessagingService {
  constructor(private readonly db: DatabaseService, private readonly policy: MessagingPolicyService, private readonly events: MessagingEventPublisher) {}

  async contacts(viewer: string, query: ContactsQueryDto) {
    const relationship = query.kind === 'followers'
      ? `EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = p.id AND f.following_id = $1)
        AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = p.id)
        AND ${messagingUnblocked('$1', 'p.id')}`
      : messagingAllowed('$1', 'p.id');
    const rows = (await this.db.query<{ id: string; username: string; display_name: string; avatar_url: string | null; conversation_id: string | null }>(`
      SELECT p.id, p.username, p.display_name, p.avatar_url, c.id AS conversation_id
      FROM profiles p JOIN users u ON u.id = p.id AND u.is_active = true
      LEFT JOIN conversations c ON c.direct_user_low_id = LEAST($1::uuid, p.id)
        AND c.direct_user_high_id = GREATEST($1::uuid, p.id)
      WHERE p.id <> $1 AND ${relationship}
        AND strpos(unaccent(lower(p.display_name || ' ' || p.username)), unaccent(lower($4::text))) > 0
      ORDER BY p.username, p.id LIMIT $2 OFFSET $3`,
    [viewer, query.pageSize + 1, (query.page - 1) * query.pageSize, query.search?.trim() ?? ''])).rows;
    const hasMore = rows.length > query.pageSize;
    return { data: rows.slice(0, query.pageSize), hasMore, next_page: hasMore ? query.page + 1 : null };
  }

  async list(viewer: string, query: ConversationQueryDto): Promise<CursorPage<ConversationDto>> {
    const cursor = decodeCursor(query.cursor);
    const rows = (await this.db.query<ConversationRow>(`${CONVERSATION_SELECT}
      WHERE ($2::timestamptz IS NULL OR (COALESCE(c.last_message_at, c.created_at), c.id) < ($2::timestamptz, $3::uuid))
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC LIMIT $4`,
    [viewer, cursor?.[0] ?? null, cursor?.[1] ?? null, query.limit + 1])).rows;
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => row.conversation), hasMore,
      next_cursor: hasMore && last ? Buffer.from(JSON.stringify([last.cursor_time, last.conversation.id])).toString('base64url') : null,
    };
  }

  async unreadCount(viewer: string): Promise<MessagingUnreadCount> {
    return (await this.db.query<MessagingUnreadCount>(`SELECT count(*)::integer AS unread_messages,
      count(DISTINCT m.conversation_id)::integer AS unread_conversations
      FROM conversation_participants cp JOIN messages m ON m.conversation_id = cp.conversation_id
      WHERE cp.user_id = $1 AND m.sequence > COALESCE(cp.last_read_sequence, 0)
        AND m.sender_id <> $1 AND m.deleted_at IS NULL`, [viewer])).rows[0];
  }

  async get(viewer: string, conversation: string, client?: PoolClient): Promise<ConversationDto> {
    const sql = `${CONVERSATION_SELECT} WHERE c.id = $2`;
    const row = client
      ? (await client.query<ConversationRow>(sql, [viewer, conversation])).rows[0]
      : (await this.db.query<ConversationRow>(sql, [viewer, conversation])).rows[0];
    if (!row) throw new NotFoundException('Không tìm thấy cuộc trò chuyện.');
    return row.conversation;
  }

  async direct(viewer: string, recipientId: string): Promise<{ conversation: ConversationDto; created: boolean }> {
    const recipient = recipientId.toLowerCase();
    if (viewer === recipient) throw new BadRequestException('Bạn không thể nhắn tin cho chính mình.');
    const result = await this.db.transaction(async (client) => {
      await this.policy.lockPair(client, viewer, recipient);
      const active = await this.policy.lockAccounts(client, viewer, recipient);
      if (!active || !(await client.query('SELECT id FROM profiles WHERE id = $1', [recipient])).rowCount) {
        throw new NotFoundException('Không tìm thấy người dùng.');
      }
      await this.policy.assertCanSend(client, viewer, recipient, active);
      const inserted = await client.query<{ id: string }>(`INSERT INTO conversations (direct_user_low_id, direct_user_high_id)
        VALUES ($1, $2) ON CONFLICT ON CONSTRAINT conversations_direct_pair_unique DO NOTHING RETURNING id`, [viewer, recipient]);
      // New statement/snapshot after a possible concurrent ON CONFLICT wait.
      const id = inserted.rows[0]?.id ?? (await client.query<{ id: string }>(`SELECT id FROM conversations
        WHERE direct_user_low_id = LEAST($1::uuid, $2::uuid) AND direct_user_high_id = GREATEST($1::uuid, $2::uuid)`, [viewer, recipient])).rows[0]?.id;
      if (!id) throw new NotFoundException('Không tìm thấy cuộc trò chuyện.');
      return { conversation: await this.get(viewer, id, client), created: !!inserted.rowCount };
    });
    if (result.created) await this.events.conversation(result.conversation.id, 'created');
    return result;
  }

  private async member(viewer: string, conversation: string, client?: PoolClient, lock = false): Promise<MemberConversation> {
    const sql = `SELECT c.id, cp.last_read_sequence, CASE WHEN c.direct_user_low_id = $1 THEN c.direct_user_high_id ELSE c.direct_user_low_id END AS recipient_id
      FROM conversations c JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = $1
      WHERE c.id = $2 ${lock ? 'FOR UPDATE OF c' : ''}`;
    const result = client
      ? await client.query<MemberConversation>(sql, [viewer, conversation])
      : await this.db.query<MemberConversation>(sql, [viewer, conversation]);
    if (!result.rows[0]) throw new NotFoundException('Không tìm thấy cuộc trò chuyện.');
    return result.rows[0];
  }

  async messages(viewer: string, conversation: string, query: MessageQueryDto): Promise<CursorPage<MessageDto>> {
    const before = query.before_sequence === undefined ? null : sequence(query.before_sequence);
    await this.member(viewer, conversation);
    const rows = (await this.db.query<{ message: MessageDto }>(`SELECT ${MESSAGE_JSON} AS message FROM messages m
      WHERE m.conversation_id = $2 AND ($3::bigint IS NULL OR m.sequence < $3)
        AND EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = m.conversation_id AND cp.user_id = $1)
      ORDER BY m.sequence DESC LIMIT $4`, [viewer, conversation, before, query.limit + 1])).rows;
    const hasMore = rows.length > query.limit;
    const data = rows.slice(0, query.limit).map((row) => row.message);
    return { data, hasMore, next_cursor: hasMore ? data.at(-1)!.sequence : null };
  }

  private async projectMessage(client: PoolClient, viewer: string, conversation: string, id: string): Promise<MessageDto> {
    const result = await client.query<{ message: MessageDto }>(`SELECT ${MESSAGE_JSON} AS message FROM messages m
      JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
      WHERE m.conversation_id = $2 AND m.id = $3`, [viewer, conversation, id]);
    if (!result.rows[0]) throw new NotFoundException('Không tìm thấy tin nhắn.');
    return result.rows[0].message;
  }

  async message(viewer: string, conversation: string, id: string): Promise<MessageDto> {
    await this.member(viewer, conversation);
    const row = (await this.db.query<{ message: MessageDto }>(`SELECT ${MESSAGE_JSON} AS message FROM messages m
      JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
      WHERE m.conversation_id = $2 AND m.id = $3`, [viewer, conversation, id])).rows[0];
    if (!row) throw new NotFoundException('Không tìm thấy tin nhắn.');
    return row.message;
  }

  private samePayload(existing: StoredMessage, conversation: string, dto: CreateMessageDto, content: string | null): void {
    if (existing.conversation_id !== conversation || existing.message_type !== dto.message_type
      || existing.content !== content || existing.shared_resource_id !== (dto.shared_resource_id?.toLowerCase() ?? null)) {
      throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: 'Mã gửi tin này đã được dùng cho nội dung hoặc cuộc trò chuyện khác.' });
    }
  }

  private async validateResource(client: PoolClient, viewer: string, recipient: string, dto: CreateMessageDto): Promise<void> {
    const values = [viewer, recipient, dto.shared_resource_id];
    let allowed = false;
    if (dto.message_type === 'shared_post') {
      const post = (await client.query<{ journey_id: string | null }>(`SELECT p.journey_id FROM posts p JOIN users u ON u.id = p.author_id
        WHERE p.id = $3 AND ${postAccess('$1')} AND ${postAccess('$2')} FOR SHARE OF p, u`, values)).rows[0];
      allowed = !!post;
      if (post?.journey_id) {
        allowed = !!(await client.query(`SELECT id FROM journeys WHERE id = $1 AND visibility = 'public' AND status = 'published' FOR SHARE`, [post.journey_id])).rowCount;
      }
    } else if (dto.message_type === 'shared_location') {
      allowed = !!(await client.query('SELECT id FROM locations WHERE id = $1 FOR SHARE', [dto.shared_resource_id])).rowCount;
    } else if (dto.message_type === 'shared_journey') {
      allowed = !!(await client.query(`SELECT j.id FROM journeys j JOIN users u ON u.id = j.user_id
        WHERE j.id = $3 AND u.is_active = true
          AND (j.user_id = $1 OR (j.visibility = 'public' AND j.status = 'published'))
          AND (j.user_id = $2 OR (j.visibility = 'public' AND j.status = 'published')) FOR SHARE OF j, u`, values)).rowCount;
    }
    if (!allowed) throw new NotFoundException('Nội dung chia sẻ không khả dụng cho những người trong cuộc trò chuyện.');
  }

  async send(viewer: string, conversation: string, dto: CreateMessageDto): Promise<SendMessageResult> {
    const content = dto.content?.trim() || null;
    if ((dto.message_type === 'text' && (!content || dto.shared_resource_id !== undefined))
      || (dto.message_type !== 'text' && !dto.shared_resource_id)) throw new BadRequestException('Nội dung hoặc tham chiếu tin nhắn không hợp lệ.');
    const result = await this.db.transaction(async (client) => {
      const initial = await this.member(viewer, conversation, client);
      await this.policy.lockPair(client, viewer, initial.recipient_id);
      const active = await this.policy.lockAccounts(client, viewer, initial.recipient_id);
      const current = await this.member(viewer, conversation, client, true);
      const previous = (await client.query<StoredMessage>(`SELECT id, conversation_id, message_type, content, shared_resource_id
        FROM messages WHERE sender_id = $1 AND client_message_id = $2`, [viewer, dto.client_message_id])).rows[0];
      if (previous) {
        this.samePayload(previous, current.id, dto, content);
        return { message: await this.projectMessage(client, viewer, current.id, previous.id), created: false };
      }
      await this.policy.assertCanSend(client, viewer, current.recipient_id, active);
      if (dto.message_type !== 'text') await this.validateResource(client, viewer, current.recipient_id, dto);
      const inserted = await client.query<StoredMessage>(`INSERT INTO messages
        (conversation_id, sender_id, client_message_id, message_type, content, shared_resource_id)
        VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT ON CONSTRAINT messages_sender_client_unique DO NOTHING
        RETURNING id, conversation_id, message_type, content, shared_resource_id`,
      [current.id, viewer, dto.client_message_id, dto.message_type, content, dto.shared_resource_id ?? null]);
      const stored = inserted.rows[0] ?? (await client.query<StoredMessage>(`SELECT id, conversation_id, message_type, content, shared_resource_id
        FROM messages WHERE sender_id = $1 AND client_message_id = $2`, [viewer, dto.client_message_id])).rows[0];
      if (!stored) throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: 'Trạng thái gửi tin vừa thay đổi. Vui lòng thử lại với cùng mã gửi tin.' });
      this.samePayload(stored, current.id, dto, content);
      return { message: await this.projectMessage(client, viewer, current.id, stored.id), created: !!inserted.rowCount };
    });
    if (result.created) await this.events.message(result.message.conversation_id, result.message.id);
    return result;
  }

  async markRead(viewer: string, conversation: string, dto: ReadConversationDto): Promise<ReadConversationResult> {
    const target = sequence(dto.last_read_sequence);
    const { result, changed } = await this.db.transaction(async (client) => {
      await this.policy.lockAccounts(client, viewer, viewer);
      const before = await this.member(viewer, conversation, client, true);
      if (!(await client.query('SELECT id FROM messages WHERE conversation_id = $1 AND sequence = $2', [conversation, target])).rowCount) {
        throw new BadRequestException({ code: 'INVALID_READ_CURSOR', message: 'Không tìm thấy tin nhắn tại vị trí đọc trong cuộc trò chuyện này.' });
      }
      await client.query('UPDATE conversation_participants SET last_read_sequence = $3 WHERE conversation_id = $1 AND user_id = $2', [conversation, viewer, target]);
      const current = await this.get(viewer, conversation, client);
      return { result: { conversation_id: current.id, ...current.read_state, unread_count: current.unread_count },
        changed: current.read_state.last_read_sequence !== before.last_read_sequence };
    });
    if (changed) await this.events.read(result.conversation_id, viewer);
    return result;
  }
}
