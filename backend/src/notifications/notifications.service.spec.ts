import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DatabaseService } from '../database/database.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ReadNotificationDto } from './dto/read-notification.dto';
import { NotificationChangedEvent, parseNotificationChange } from './notification-events';
import { NotificationsService } from './notifications.service';

const USER = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';
const change: NotificationChangedEvent = { notification_id: ID, recipient_id: USER, type: 'like', change: 'created' };

function setup() {
  const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const emitNotificationChange = jest.fn().mockResolvedValue(undefined);
  const service = new NotificationsService({ query } as unknown as DatabaseService, { emitNotificationChange } as unknown as RealtimeGateway);
  return { service, query, emitNotificationChange };
}

describe('Notification database event contract', () => {
  it.each(['follow', 'like', 'comment'])('accepts supported %s changes and strips unknown fields', (type) => {
    for (const operation of ['created', 'read', 'deleted']) {
      const expected = { ...change, type, change: operation };
      expect(parseNotificationChange(JSON.stringify({ ...expected, accessToken: 'private', content: 'not an event field' }))).toEqual(expected);
    }
  });

  it.each([
    '', 'invalid json', 'null', '[]', '1', '{}',
    JSON.stringify({ ...change, notification_id: 'not-a-uuid' }),
    JSON.stringify({ ...change, recipient_id: 'not-a-uuid' }),
    JSON.stringify({ ...change, type: 'message' }),
    JSON.stringify({ ...change, change: 'updated' }),
    JSON.stringify({ ...change, type: ['like'] }),
    JSON.stringify({ ...change, change: ['created'] }),
    JSON.stringify({ ...change, type: { toString: 'invalid', valueOf: 'invalid' } }),
    JSON.stringify({ ...change, change: { toString: 'invalid', valueOf: 'invalid' } }),
    JSON.stringify({ ...change, notification_id: null }),
    JSON.stringify({ ...change, recipient_id: 5 }),
    JSON.stringify({ ...change, unused: 'x'.repeat(1024) }),
  ])('rejects malformed payload safely: %s', (payload) => {
    expect(parseNotificationChange(payload)).toBeNull();
  });

  it('publishes valid allowlisted signals without creating or querying persistent notifications', async () => {
    const { service, query, emitNotificationChange } = setup();
    await service.publishDatabaseChange(JSON.stringify({ ...change, unknown: 'do not forward' }));
    expect(emitNotificationChange).toHaveBeenCalledWith(change);
    expect(query).not.toHaveBeenCalled();
  });

  it('ignores malformed messages and allows the listener to handle delivery rejection', async () => {
    const { service, emitNotificationChange } = setup();
    await service.publishDatabaseChange('invalid');
    expect(emitNotificationChange).not.toHaveBeenCalled();
    emitNotificationChange.mockRejectedValueOnce(new Error('Transport unavailable.'));
    await expect(service.publishDatabaseChange(JSON.stringify(change))).rejects.toThrow('Transport unavailable.');
  });
});

describe('NotificationsService REST ownership and unread state', () => {
  it('uses recipient ownership and the shared post/journey visibility policy for list and count', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce({ rows: [{ id: `like:${POST}` }, { id: ID }] }).mockResolvedValueOnce({ rows: [{ count: '5' }] });
    const result = await service.list(USER, { page: 2, pageSize: 3 });
    expect(result).toMatchObject({ count: 5, page: 2, pageSize: 3, hasMore: false });
    expect(query.mock.calls[0][1]).toEqual([USER, 3, 3]);
    expect(query.mock.calls[1][1]).toEqual([USER]);
    for (const [sql] of query.mock.calls) {
      expect(sql).toContain('n.recipient_id = $1');
      expect(sql).toContain('pu.is_active = true');
      expect(sql).toContain("pj.visibility = 'public' AND pj.status = 'published'");
      expect(sql).toContain('p.author_id = $1');
      expect(sql).not.toContain(USER);
    }
  });

  it('returns an authoritative raw unread count and defaults missing results to zero', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce({ rows: [{ count: 7 }] });
    expect(await service.unreadCount(USER)).toEqual({ count: 7 });
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('COUNT(*)::int');
    expect(sql).toContain('n.read_at IS NULL');
    expect(sql).toContain('n.recipient_id = $1');
    expect(sql).toContain('pu.is_active = true');
    expect(values).toEqual([USER]);
    expect(await service.unreadCount(USER)).toEqual({ count: 0 });
  });

  it('marks only an unread follow belonging to the viewer, with visibility enforced in SQL', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce({ rowCount: 1 });
    expect(await service.markRead(USER, ID)).toEqual({ updated: 1 });
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('n.recipient_id = $1');
    expect(sql).toContain("n.type = 'follow'");
    expect(sql).toContain('n.id = $2::uuid');
    expect(sql).toContain('n.read_at IS NULL');
    expect(sql).toContain('pu.is_active = true');
    expect(values).toEqual([USER, ID]);
  });

  it.each(['like', 'comment', 'LIKE'])('marks the entire %s group only within the viewer and visible post', async (type) => {
    const { service, query } = setup();
    query.mockResolvedValueOnce({ rowCount: 2 });
    expect(await service.markRead(USER, `${type}:${POST}`)).toEqual({ updated: 2 });
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('n.recipient_id = $1');
    expect(sql).toContain('n.type = $2');
    expect(sql).toContain('n.post_id = $3::uuid');
    expect(sql).toContain('n.read_at IS NULL');
    expect(sql).toContain('p.author_id = $1');
    expect(values).toEqual([USER, type.toLowerCase(), POST]);
  });

  it('repeated mark-all is idempotent and leaves event production to database triggers', async () => {
    const { service, query, emitNotificationChange } = setup();
    query.mockResolvedValueOnce({ rowCount: 4 }).mockResolvedValueOnce({ rowCount: 0 });
    expect(await service.markAllRead(USER)).toEqual({ updated: 4 });
    expect(await service.markAllRead(USER)).toEqual({ updated: 0 });
    expect(query).toHaveBeenCalledWith('UPDATE notifications SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL', [USER]);
    expect(emitNotificationChange).not.toHaveBeenCalled();
  });
});

describe('ReadNotificationDto grouped identifiers', () => {
  it.each([ID, `like:${POST}`, `comment:${POST}`, `LIKE:${POST}`])('accepts an existing grouped identifier: %s', async (group_id) => {
    expect(await validate(plainToInstance(ReadNotificationDto, { group_id }))).toHaveLength(0);
  });

  it.each(['', 'invalid', `follow:${ID}`, `message:${POST}`, `like:${POST}:extra`, `${POST} OR 1=1`, 4, null])('rejects malformed group identifiers: %s', async (group_id) => {
    expect(await validate(plainToInstance(ReadNotificationDto, { group_id }))).not.toHaveLength(0);
  });
});
