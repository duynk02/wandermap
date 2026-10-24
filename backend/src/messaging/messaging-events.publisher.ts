import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { MessageType } from './dto/messaging.dto';
import type { MessagingEvent } from './messaging-events';

/** Called only after DatabaseService.transaction resolves (COMMIT succeeded). */
@Injectable()
export class MessagingEventPublisher {
  private readonly logger = new Logger(MessagingEventPublisher.name);
  constructor(private readonly db: DatabaseService, private readonly realtime: RealtimeGateway) {}

  private async safely(work: () => Promise<void>): Promise<void> {
    try { await work(); }
    catch { this.logger.warn('Committed messaging state could not be delivered; REST reconciliation remains available.'); }
  }

  private async fanout(conversation: string, event: (recipient: string) => MessagingEvent[]): Promise<void> {
    const members = await this.db.query<{ user_id: string }>(`SELECT cp.user_id FROM conversation_participants cp
      JOIN users u ON u.id = cp.user_id AND u.is_active = true WHERE cp.conversation_id = $1`, [conversation]);
    const deliveries = await Promise.allSettled(members.rows.map(async ({ user_id }) => {
      for (const change of event(user_id)) await this.realtime.emitMessagingEvent(user_id, change);
    }));
    if (deliveries.some((result) => result.status === 'rejected')) {
      this.logger.warn('A messaging recipient could not be reached; REST remains authoritative.');
    }
  }

  async message(conversation: string, message: string): Promise<void> {
    await this.safely(async () => {
      const row = (await this.db.query<{
        id: string; sender_id: string; client_message_id: string; message_type: MessageType; sequence: string; created_at: Date;
      }>(`SELECT id, sender_id, client_message_id, message_type, sequence, created_at FROM messages
        WHERE conversation_id = $1 AND id = $2 AND deleted_at IS NULL`, [conversation, message])).rows[0];
      if (!row) return;
      await this.fanout(conversation, (recipient_id) => {
        const base = { event_id: row.id, conversation_id: conversation, recipient_id };
        return [
          { name: 'message:new', payload: { ...base, message_id: row.id, sender_id: row.sender_id,
            client_message_id: row.client_message_id, message_type: row.message_type, sequence: row.sequence, created_at: row.created_at.toISOString() } },
          { name: 'conversation:updated', payload: { ...base, reason: 'message', message_id: row.id } },
        ];
      });
    });
  }

  async read(conversation: string, reader: string): Promise<void> {
    await this.safely(async () => {
      const state = (await this.db.query<{ last_read_sequence: string | null; last_read_at: Date | null }>(
        'SELECT last_read_sequence, last_read_at FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2', [conversation, reader],
      )).rows[0];
      if (!state?.last_read_sequence || !state.last_read_at) return;
      const event_id = randomUUID();
      await this.fanout(conversation, (recipient_id) => {
        const base = { event_id, conversation_id: conversation, recipient_id };
        return [
          { name: 'message:read', payload: { ...base, user_id: reader, last_read_sequence: state.last_read_sequence!, last_read_at: state.last_read_at!.toISOString() } },
          { name: 'conversation:updated', payload: { ...base, reason: 'read', message_id: null } },
        ];
      });
    });
  }

  async conversation(conversation: string, reason: 'created' | 'policy'): Promise<void> {
    await this.safely(async () => {
      const event_id = randomUUID();
      await this.fanout(conversation, (recipient_id) => [{ name: 'conversation:updated', payload: {
        event_id, conversation_id: conversation, recipient_id, reason, message_id: null,
      } }]);
    });
  }

  async policy(first: string, second: string): Promise<void> {
    await this.safely(async () => {
      const row = (await this.db.query<{ id: string }>(`SELECT id FROM conversations
        WHERE direct_user_low_id = LEAST($1::uuid, $2::uuid) AND direct_user_high_id = GREATEST($1::uuid, $2::uuid)`, [first, second])).rows[0];
      if (row) await this.conversation(row.id, 'policy');
    });
  }
}
