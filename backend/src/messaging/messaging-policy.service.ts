import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { MessagingEventPublisher } from './messaging-events.publisher';
import { mutualFollow } from './messaging-access';

@Injectable()
export class MessagingPolicyService {
  constructor(private readonly db: DatabaseService, private readonly events: MessagingEventPublisher) {}

  /** Always acquire pair -> account -> conversation locks, including block/unblock. */
  async lockPair(client: PoolClient, first: string, second: string): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended(
      LEAST($1::uuid, $2::uuid)::text || ':' || GREATEST($1::uuid, $2::uuid)::text, 719202614))`, [first, second]);
  }

  async lockAccounts(client: PoolClient, viewer: string, recipient: string): Promise<boolean> {
    const accounts = await client.query<{ id: string; is_active: boolean }>(
      'SELECT id, is_active FROM users WHERE id IN ($1, $2) ORDER BY id FOR SHARE', [viewer, recipient],
    );
    if (!accounts.rows.find((user) => user.id === viewer)?.is_active) throw new UnauthorizedException('Phiên đăng nhập không còn hợp lệ.');
    return accounts.rows.find((user) => user.id === recipient)?.is_active ?? false;
  }

  async assertCanSend(client: PoolClient, viewer: string, recipient: string, recipientActive: boolean): Promise<void> {
    if (!recipientActive) throw new ForbiddenException({ code: 'RECIPIENT_UNAVAILABLE', message: 'Hiện không thể gửi tin nhắn cho tài khoản này.' });
    const blocked = await client.query(`SELECT 1 FROM messaging_blocks
      WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1`, [viewer, recipient]);
    if (blocked.rowCount) throw new ForbiddenException({ code: 'MESSAGING_NOT_ALLOWED', message: 'Hiện không thể gửi tin nhắn trong cuộc trò chuyện này.' });
    const mutual = await client.query(`SELECT 1 WHERE ${mutualFollow('$1::uuid', '$2::uuid')}`, [viewer, recipient]);
    if (!mutual.rowCount) throw new ForbiddenException({ code: 'MUTUAL_FOLLOW_REQUIRED', message: 'Hai bạn cần theo dõi nhau để nhắn tin.' });
  }

  async setBlock(viewer: string, target: string, blocked: boolean): Promise<{ user_id: string; blocked: boolean }> {
    if (viewer === target) throw new BadRequestException('Bạn không thể chặn chính mình.');
    const changed = await this.db.transaction(async (client) => {
      await this.lockPair(client, viewer, target);
      await this.lockAccounts(client, viewer, target);
      if (!(await client.query('SELECT id FROM profiles WHERE id = $1', [target])).rowCount) throw new NotFoundException('Không tìm thấy người dùng.');
      const mutation = blocked
        ? await client.query('INSERT INTO messaging_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [viewer, target])
        : await client.query('DELETE FROM messaging_blocks WHERE blocker_id = $1 AND blocked_id = $2', [viewer, target]);
      return !!mutation.rowCount;
    });
    if (changed) await this.events.policy(viewer, target);
    return { user_id: target, blocked };
  }
}
