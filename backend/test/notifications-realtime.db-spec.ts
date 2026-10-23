import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { AddressInfo } from 'node:net';
import path from 'node:path';
import { Client, Notification as PgNotification, Pool } from 'pg';
import { io, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { DatabaseModule } from '../src/database/database.module';
import { DatabaseService } from '../src/database/database.service';
import { NotificationChangedEvent } from '../src/notifications/notification-events';
import { NotificationsModule } from '../src/notifications/notifications.module';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { RealtimeIoAdapter } from '../src/realtime/realtime-io.adapter';
import { RealtimeModule } from '../src/realtime/realtime.module';

// These tests commit real writes: require an explicitly configured disposable DB.
// Never load .env or fall back to the application's DATABASE_URL in this suite.
const databaseUrl = process.env.WANDERMAP_TEST_DATABASE_URL;
const disposable = databaseUrl && /(?:^|_)test(?:_|$)/i.test(new URL(databaseUrl).pathname.slice(1));
const describeDatabase = disposable ? describe : describe.skip;
const channel = 'wandermap_notifications';

interface NotificationChange {
  notification_id: string;
  recipient_id: string;
  type: 'follow' | 'like' | 'comment';
  change: 'created' | 'read' | 'deleted';
}

describeDatabase('Realtime notifications: real PostgreSQL commit, triggers and retries', () => {
  let db: Client;
  let listener: Client;
  let schemaCreated = false;
  const schema = `notifications_test_${randomUUID().replaceAll('-', '')}`;
  const changes: NotificationChange[] = [];
  const recipients = new Set<string>();
  const actor = randomUUID();
  const owner = randomUUID();
  const locations = [randomUUID(), randomUUID()];
  let post: string;

  const receive = (notification: PgNotification) => {
    if (notification.channel !== channel || !notification.payload) return;
    const payload = JSON.parse(notification.payload) as NotificationChange;
    // LISTEN channels are database-wide; ignore other suites' notifications.
    if (recipients.has(payload.recipient_id)) changes.push(payload);
  };
  const pause = (milliseconds = 100) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  async function delivered(count: number) {
    const deadline = Date.now() + 3000;
    while (changes.length < count && Date.now() < deadline) await pause(10);
    expect(changes).toHaveLength(count);
  }
  const notificationRows = async () => (await db.query<{
    id: string; recipient_id: string; actor_id: string; type: NotificationChange['type']; read_at: Date | null;
  }>('SELECT id, recipient_id, actor_id, type, read_at FROM notifications WHERE recipient_id = $1 ORDER BY created_at, id', [owner])).rows;
  const like = () => db.query('INSERT INTO likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [actor, post]);
  const follow = () => db.query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [actor, owner]);
  async function comment(author = actor, parent: string | null = null) {
    return (await db.query<{ id: string }>(
      "INSERT INTO comments (post_id, author_id, content, parent_id) VALUES ($1, $2, 'Cảnh đẹp quá!', $3) RETURNING id",
      [post, author, parent],
    )).rows[0].id;
  }

  beforeAll(async () => {
    expect(schema).toMatch(/^notifications_test_[a-f0-9]{32}$/);
    db = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    await db.connect();
    try {
      await db.query('BEGIN');
      // Install shared extensions before search_path so schema cleanup never owns them.
      for (const extension of ['postgis', 'unaccent', 'pg_trgm']) {
        await db.query(`CREATE EXTENSION IF NOT EXISTS ${extension} WITH SCHEMA public`);
      }
      await db.query(`CREATE SCHEMA "${schema}"`);
      await db.query(`SET LOCAL search_path TO "${schema}", public`);
      const directory = path.resolve(__dirname, '../src/database/migrations');
      const files = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
      expect(files).toContain('010_notifications_realtime.sql');
      for (const file of files) await db.query(await readFile(path.join(directory, file), 'utf8'));
      for (const [id, name] of [[actor, 'notify_actor'], [owner, 'notify_owner']]) {
        recipients.add(id);
        await db.query('INSERT INTO users (id, email) VALUES ($1, $2)', [id, `${id}@example.test`]);
        await db.query('INSERT INTO profiles (id, username, display_name) VALUES ($1, $2, $2)', [id, name]);
      }
      for (const [index, id] of locations.entries()) {
        await db.query("INSERT INTO locations (id, name, coordinates) VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, 12), 4326))", [id, `Điểm ${index + 1}`, 106 + index]);
      }
      await db.query('COMMIT');
      schemaCreated = true;
    } catch (cause) {
      await db.query('ROLLBACK');
      throw cause;
    }
    await db.query(`SET search_path TO "${schema}", public`);
    listener = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    await listener.connect();
    listener.on('notification', receive);
    await listener.query(`LISTEN ${channel}`);
  });

  beforeEach(async () => {
    // Clean only internally generated fixtures, and drain their deletion events.
    await db.query('DELETE FROM posts WHERE author_id = $1', [owner]);
    await db.query('DELETE FROM journeys WHERE user_id = $1', [owner]);
    await db.query('DELETE FROM follows WHERE follower_id = $1', [actor]);
    await pause();
    changes.length = 0;
    post = (await db.query<{ id: string }>(
      "INSERT INTO posts (author_id, location_id, content, rating, visited_at) VALUES ($1, $2, 'Bài kiểm thử thông báo', 5, '2026-10-23') RETURNING id",
      [owner, locations[0]],
    )).rows[0].id;
  });

  afterAll(async () => {
    if (listener) {
      listener.off('notification', receive);
      await listener.end();
    }
    if (db) {
      try {
        await db.query('ROLLBACK');
        // No configured identifier reaches this DROP; only this suite's own schema.
        if (schemaCreated && /^notifications_test_[a-f0-9]{32}$/.test(schema)) {
          await db.query(`DROP SCHEMA "${schema}" CASCADE`);
        }
      } finally { await db.end(); }
    }
  });

  it('delivers a stable notification ID only after the business transaction commits', async () => {
    await db.query('BEGIN');
    try {
      await like();
      const [row] = await notificationRows();
      expect(row).toMatchObject({ recipient_id: owner, actor_id: actor, type: 'like', read_at: null });
      await pause();
      expect(changes).toHaveLength(0);
      await db.query('COMMIT');
      await delivered(1);
      expect(changes[0]).toEqual({ notification_id: row.id, recipient_id: owner, type: 'like', change: 'created' });
      expect((await notificationRows())[0].id).toBe(row.id);
    } finally { await db.query('ROLLBACK'); }
  });

  it('never delivers or persists a rolled-back notification', async () => {
    await db.query('BEGIN');
    await like();
    expect(await notificationRows()).toHaveLength(1);
    await db.query('ROLLBACK');
    await pause();
    expect(changes).toHaveLength(0);
    expect(await notificationRows()).toHaveLength(0);
    expect((await db.query('SELECT likes_count FROM posts WHERE id = $1', [post])).rows[0].likes_count).toBe(0);
  });

  it('keeps retrying Like/Follow idempotent and removes their notifications on undo', async () => {
    await like();
    await like();
    await follow();
    await follow();
    await delivered(2);
    const rows = await notificationRows();
    expect(rows).toHaveLength(2);
    expect(changes.map((change) => change.notification_id).sort()).toEqual(rows.map((row) => row.id).sort());
    const likeRow = rows.find((row) => row.type === 'like')!;
    await db.query("INSERT INTO notifications (recipient_id, actor_id, type, post_id) VALUES ($1, $2, 'like', $3) ON CONFLICT DO NOTHING", [owner, actor, post]);
    await pause();
    expect(changes).toHaveLength(2);
    expect((await notificationRows()).find((row) => row.type === 'like')!.id).toBe(likeRow.id);
    await db.query('DELETE FROM likes WHERE user_id = $1 AND post_id = $2', [actor, post]);
    await db.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [actor, owner]);
    await delivered(4);
    expect(changes.slice(2).every((change) => change.change === 'deleted')).toBe(true);
    expect(changes.slice(2).map((change) => change.notification_id).sort()).toEqual(rows.map((row) => row.id).sort());
    expect(await notificationRows()).toHaveLength(0);
  });

  it('notifies the post author for comments/replies while suppressing self interactions', async () => {
    const parent = await comment();
    await comment(actor, parent);
    await delivered(2);
    expect(changes.every((change) => change.type === 'comment' && change.recipient_id === owner)).toBe(true);
    await comment(owner);
    await db.query('INSERT INTO likes (user_id, post_id) VALUES ($1, $2)', [owner, post]);
    await db.query('INSERT INTO saves (user_id, post_id) VALUES ($1, $2)', [actor, post]);
    await db.query('INSERT INTO comment_likes (user_id, comment_id) VALUES ($1, $2)', [owner, parent]);
    await pause();
    expect(changes).toHaveLength(2);
    expect(await notificationRows()).toHaveLength(2);
  });

  it('creates one comment and notification for concurrent retries with one request ID', async () => {
    const requestId = randomUUID();
    const clients = Array.from({ length: 6 }, () => new Client({
      connectionString: databaseUrl, connectionTimeoutMillis: 5000,
      options: `-c search_path=${schema},public`,
    }));
    try {
      await Promise.all(clients.map((client) => client.connect()));
      const results = await Promise.all(clients.map((client) => client.query<{ id: string }>(`
        INSERT INTO comments (post_id, author_id, content, client_request_id)
        VALUES ($1, $2, 'Nội dung một lần', $3)
        ON CONFLICT (author_id, client_request_id) WHERE client_request_id IS NOT NULL
        DO NOTHING RETURNING id`, [post, actor, requestId])));
      expect(results.flatMap((result) => result.rows)).toHaveLength(1);
      await delivered(1);
      const rows = await notificationRows();
      expect(rows).toHaveLength(1);
      expect(changes[0]).toMatchObject({ notification_id: rows[0].id, type: 'comment', change: 'created' });
      expect((await db.query('SELECT comments_count FROM posts WHERE id = $1', [post])).rows[0].comments_count).toBe(1);
      expect((await db.query('SELECT count(*)::integer AS count FROM comments WHERE author_id = $1 AND client_request_id = $2', [actor, requestId])).rows[0].count).toBe(1);
    } finally { await Promise.all(clients.map((client) => client.end())); }
  });

  it('emits read changes once per real transition and permits authoritative unread queries', async () => {
    await like();
    await follow();
    await delivered(2);
    const [row] = await notificationRows();
    await db.query('UPDATE notifications SET read_at = now() WHERE id = $1 AND recipient_id = $2 AND read_at IS NULL', [row.id, owner]);
    await delivered(3);
    expect(changes[2]).toMatchObject({ notification_id: row.id, recipient_id: owner, change: 'read' });
    await db.query('UPDATE notifications SET read_at = read_at WHERE id = $1', [row.id]);
    await pause();
    expect(changes).toHaveLength(3);
    expect((await db.query('SELECT count(*)::integer AS count FROM notifications WHERE recipient_id = $1 AND read_at IS NULL', [owner])).rows[0].count).toBe(1);
    await db.query('UPDATE notifications SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL', [owner]);
    await delivered(4);
    expect((await db.query('SELECT count(*)::integer AS count FROM notifications WHERE recipient_id = $1 AND read_at IS NULL', [owner])).rows[0].count).toBe(0);
    await db.query('UPDATE notifications SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL', [owner]);
    await pause();
    expect(changes).toHaveLength(4);
  });

  it('emits deletion changes for notifications cascaded from a deleted post', async () => {
    await like();
    await comment();
    await delivered(2);
    const ids = changes.map((change) => change.notification_id).sort();
    await db.query('DELETE FROM posts WHERE id = $1', [post]);
    await delivered(4);
    expect(changes.slice(2).map((change) => change.notification_id).sort()).toEqual(ids);
    expect(changes.slice(2).every((change) => change.change === 'deleted')).toBe(true);
    expect(await notificationRows()).toHaveLength(0);
  });

  it('reuses existing Like/Comment notifications for real shared Journey posts', async () => {
    await db.query('BEGIN');
    try {
      const journey = (await db.query<{ id: string }>("INSERT INTO journeys (user_id, title, visibility) VALUES ($1, 'Hành trình kiểm thử', 'public') RETURNING id", [owner])).rows[0].id;
      for (const [index, location] of locations.entries()) {
        await db.query('INSERT INTO journey_stops (journey_id, user_id, location_id, stop_order, location_name_snapshot) VALUES ($1, $2, $3, $4, $5)', [journey, owner, location, index + 1, `Điểm ${index + 1}`]);
      }
      await db.query("UPDATE journeys SET status = 'published' WHERE id = $1", [journey]);
      post = (await db.query<{ id: string }>("INSERT INTO posts (author_id, post_type, journey_id, preview_revision, content) VALUES ($1, 'journey', $2, 1, '') RETURNING id", [owner, journey])).rows[0].id;
      await db.query('COMMIT');
    } finally { await db.query('ROLLBACK'); }
    await like();
    await comment();
    await delivered(2);
    expect(changes.map((change) => change.type).sort()).toEqual(['comment', 'like']);
    expect(changes.every((change) => change.recipient_id === owner)).toBe(true);
    expect(await notificationRows()).toHaveLength(2);
  });

  it('delivers committed changes through the real listener and gateway to every recipient tab, with transport failures isolated', async () => {
    const secret = 'isolated-notification-pipeline-test-secret-at-least-32-characters';
    const origin = 'http://localhost:3000';
    const sockets = new Set<ClientSocket>();
    const applicationDb = new Pool({
      connectionString: databaseUrl, connectionTimeoutMillis: 5000,
      options: `-c search_path=${schema},public`, max: 4,
    });
    let app: INestApplication | undefined;
    let warning: jest.SpyInstance | undefined;
    let emit: jest.SpyInstance | undefined;
    try {
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true,
            load: [() => ({ JWT_ACCESS_SECRET: secret, CORS_ORIGINS: origin })],
          }),
          DatabaseModule, NotificationsModule, RealtimeModule,
        ],
      }).overrideProvider(DatabaseService).useValue({
        query: (sql: string, values: unknown[] = []) => applicationDb.query(sql, values),
        createListener: () => new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 }),
      }).compile();
      app = module.createNestApplication({ logger: false });
      app.setGlobalPrefix('api/v1');
      app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
      app.useWebSocketAdapter(new RealtimeIoAdapter(app, app.get(ConfigService)));
      await app.listen(0, '127.0.0.1');
      const gateway = app.get(RealtimeGateway);
      const jwt = app.get(JwtService);
      const token = (user: string) => jwt.sign({ sub: user, email: `${user}@example.test` }, { expiresIn: 60 });
      const ownerToken = token(owner);
      const address = app.getHttpServer().address() as AddressInfo;
      const url = `http://127.0.0.1:${address.port}/realtime`;
      const received = [[], [], []] as NotificationChangedEvent[][];

      async function connect(userToken: string, index: number) {
        const socket = io(url, {
          autoConnect: false, reconnection: false, forceNew: true, timeout: 2000,
          transports: ['websocket'], extraHeaders: { Origin: origin }, auth: { token: userToken },
        });
        sockets.add(socket);
        socket.on('notification:changed', (event: NotificationChangedEvent) => received[index].push(event));
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Notification pipeline socket did not become ready.')), 3000);
          socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
          socket.on('notifications:status', (status: { available: boolean }) => {
            if (status.available) { clearTimeout(timer); resolve(); }
          });
          socket.connect();
        });
      }
      await Promise.all([connect(ownerToken, 0), connect(ownerToken, 1), connect(token(actor), 2)]);
      expect(gateway.server.adapter.rooms.get(`user:${owner}`)?.size).toBe(2);
      await request(app.getHttpServer()).get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${ownerToken}`).expect(200, { count: 0 });

      await db.query('BEGIN');
      await like();
      const [created] = await notificationRows();
      await pause();
      expect(received).toEqual([[], [], []]);
      await db.query('COMMIT');
      let deadline = Date.now() + 3000;
      while ((received[0].length < 1 || received[1].length < 1) && Date.now() < deadline) await pause(10);
      const createdEvent: NotificationChangedEvent = {
        notification_id: created.id, recipient_id: owner, type: 'like', change: 'created',
      };
      expect(received).toEqual([[createdEvent], [createdEvent], []]);
      await request(app.getHttpServer()).get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${ownerToken}`).expect(200, { count: 1 });

      await request(app.getHttpServer()).post('/api/v1/notifications/read')
        .set('Authorization', `Bearer ${ownerToken}`).send({ group_id: `like:${post}` })
        .expect(200, { updated: 1 });
      deadline = Date.now() + 3000;
      while ((received[0].length < 2 || received[1].length < 2) && Date.now() < deadline) await pause(10);
      const readEvent: NotificationChangedEvent = { ...createdEvent, change: 'read' };
      expect(received).toEqual([[createdEvent, readEvent], [createdEvent, readEvent], []]);
      await request(app.getHttpServer()).get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${ownerToken}`).expect(200, { count: 0 });

      // A real committed follow still persists when the downstream Socket.IO emission rejects.
      warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      emit = jest.spyOn(gateway, 'emitNotificationChange').mockRejectedValueOnce(new Error('Simulated transport failure.'));
      await expect(follow()).resolves.toMatchObject({ rowCount: 1 });
      deadline = Date.now() + 3000;
      while (warning.mock.calls.length === 0 && Date.now() < deadline) await pause(10);
      expect(emit).toHaveBeenCalledWith(expect.objectContaining({ recipient_id: owner, type: 'follow', change: 'created' }));
      expect(warning).toHaveBeenCalledWith('A committed notification could not be delivered; REST remains authoritative.');
      expect((await notificationRows()).some((row) => row.type === 'follow' && row.read_at === null)).toBe(true);
      await request(app.getHttpServer()).get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${ownerToken}`).expect(200, { count: 1 });
      expect(received).toEqual([[createdEvent, readEvent], [createdEvent, readEvent], []]);
    } finally {
      emit?.mockRestore();
      warning?.mockRestore();
      for (const socket of sockets) { socket.removeAllListeners(); socket.disconnect(); }
      // Close the actual dedicated listener and gateway before releasing the fixture connection.
      await app?.close();
      await applicationDb.end();
      await db.query('ROLLBACK');
    }
  });
});
