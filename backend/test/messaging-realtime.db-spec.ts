import { BadRequestException, INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { AddressInfo } from 'node:net';
import path from 'node:path';
import { Client, Pool, PoolClient } from 'pg';
import { io, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { DatabaseModule } from '../src/database/database.module';
import { DatabaseService } from '../src/database/database.service';
import { MessagingModule } from '../src/messaging/messaging.module';
import { MessagingEventPublisher } from '../src/messaging/messaging-events.publisher';
import type { MessagingEvent } from '../src/messaging/messaging-events';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { RealtimeIoAdapter } from '../src/realtime/realtime-io.adapter';

const databaseUrl = process.env.WANDERMAP_TEST_DATABASE_URL;
const disposable = databaseUrl && /(?:^|_)test(?:_|$)/i.test(new URL(databaseUrl).pathname.slice(1));
const describeDatabase = disposable ? describe : describe.skip;

describeDatabase('Messaging: committed REST writes, Socket.IO /realtime and multiple tabs', () => {
  const schema = `messaging_realtime_test_${randomUUID().replaceAll('-', '')}`;
  const secret = 'isolated-messaging-realtime-test-secret-at-least-32-characters';
  const origin = 'http://localhost:3000';
  const jwt = new JwtService({ secret });
  let app: INestApplication;
  let pool: Pool;
  let gateway: RealtimeGateway;
  let url: string;
  let schemaCreated = false;
  let sender: string, recipient: string, outsider: string, post: string;
  let failCommit = false;
  let beforeCommit: (() => Promise<void>) | undefined;
  const clients = new Map<ClientSocket, MessagingEvent[]>();
  const token = (user = sender) => jwt.sign({ sub: user, email: `${user}@example.test` }, { expiresIn: 300 });
  const auth = (user = sender) => `Bearer ${token(user)}`;
  const base = '/api/v1/conversations';
  const send = (conversation: string, extra: object = {}, user = sender) => request(app.getHttpServer())
    .post(`${base}/${conversation}/messages`).set('Authorization', auth(user))
    .send({ client_message_id: randomUUID(), message_type: 'text', content: 'Tin nhắn realtime tiếng Việt 🗺️', ...extra });
  const history = (conversation: string, user = recipient) => request(app.getHttpServer()).get(`${base}/${conversation}/messages`).set('Authorization', auth(user));
  const read = (conversation: string, sequence: string, user = recipient) => request(app.getHttpServer()).patch(`${base}/${conversation}/read`)
    .set('Authorization', auth(user)).send({ last_read_sequence: sequence });
  const start = () => request(app.getHttpServer()).post(`${base}/direct`).set('Authorization', auth()).send({ recipient_id: recipient });
  const pause = (milliseconds = 10) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

  async function boot(port = 0) {
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true,
        load: [() => ({ JWT_ACCESS_SECRET: secret, CORS_ORIGINS: origin })] }),
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]), DatabaseModule, MessagingModule,
    ] }).overrideProvider(DatabaseService).useValue({
      query: (sql: string, values: unknown[]) => pool.query(sql, values),
      transaction: async <T>(work: (client: PoolClient) => Promise<T>) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await work(client);
          if (beforeCommit) { const gate = beforeCommit; beforeCommit = undefined; await gate(); }
          if (failCommit) { failCommit = false; throw new BadRequestException('Simulated rollback.'); }
          await client.query('COMMIT');
          return result;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      },
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useWebSocketAdapter(new RealtimeIoAdapter(app, app.get(ConfigService)));
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(port, '127.0.0.1');
    gateway = app.get(RealtimeGateway);
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }

  beforeAll(async () => {
    const setup = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    await setup.connect();
    try {
      await setup.query('BEGIN');
      for (const extension of ['postgis', 'unaccent', 'pg_trgm']) await setup.query(`CREATE EXTENSION IF NOT EXISTS ${extension} WITH SCHEMA public`);
      await setup.query(`CREATE SCHEMA "${schema}"`);
      await setup.query(`SET LOCAL search_path TO "${schema}", public`);
      const directory = path.resolve(__dirname, '../src/database/migrations');
      const files = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
      for (const file of files) await setup.query(await readFile(path.join(directory, file), 'utf8'));
      await setup.query('COMMIT');
      schemaCreated = true;
    } catch (error) { await setup.query('ROLLBACK'); throw error; }
    finally { await setup.end(); }
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 12 });
    await boot();
  });

  beforeEach(async () => {
    failCommit = false;
    beforeCommit = undefined;
    [sender, recipient, outsider, post] = Array.from({ length: 4 }, () => randomUUID());
    for (const user of [sender, recipient, outsider]) {
      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)', [user, `${user}@example.test`]);
      await pool.query('INSERT INTO profiles (id, username, display_name) VALUES ($1, $2, $2)', [user, `socket_${user.replaceAll('-', '').slice(0, 20)}`]);
    }
    const location = (await pool.query<{ id: string }>("INSERT INTO locations (name, coordinates) VALUES ('Đà Lạt', ST_SetSRID(ST_MakePoint(108, 12), 4326)) RETURNING id")).rows[0].id;
    await pool.query(`INSERT INTO posts (id, author_id, location_id, content, images, rating, visited_at)
      VALUES ($1, $2, $3, 'Private-preview test caption', ARRAY['https://example.test/private.webp'], 5, '2026-10-23')`, [post, sender, location]);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    for (const socket of clients.keys()) { socket.removeAllListeners(); socket.disconnect(); }
    clients.clear();
    const deadline = Date.now() + 2000;
    while (gateway.server.sockets.size && Date.now() < deadline) await pause();
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (!schemaCreated) return;
    const cleanup = new Client({ connectionString: databaseUrl });
    await cleanup.connect();
    try {
      if (!/^messaging_realtime_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid generated schema');
      await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally { await cleanup.end(); }
  });

  function event<T = unknown>(socket: ClientSocket, name: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.off(name, receive); reject(new Error(`Timed out waiting for ${name}`)); }, 4000);
      const receive = (payload: T) => { clearTimeout(timer); resolve(payload); };
      socket.once(name, receive);
    });
  }

  async function tab(user: string, reconnect = false) {
    const socket = io(`${url}/realtime`, { autoConnect: false, forceNew: true, reconnection: reconnect,
      reconnectionDelay: 50, reconnectionDelayMax: 200, transports: ['websocket'], extraHeaders: { Origin: origin }, auth: { token: token(user) } });
    clients.set(socket, []);
    for (const name of ['message:new', 'message:read', 'conversation:updated'] as const) {
      socket.on(name, (payload: MessagingEvent['payload']) => clients.get(socket)?.push({ name, payload } as MessagingEvent));
    }
    const ready = event(socket, 'notifications:status'); // Sent only after server joins the authenticated user room.
    socket.connect();
    await ready;
    return socket;
  }

  async function barrier() {
    const received = [...clients.keys()].filter((socket) => socket.connected).map((socket) => event(socket, 'test:barrier'));
    gateway.server.emit('test:barrier', {});
    await Promise.all(received);
  }
  function changes(socket: ClientSocket): MessagingEvent[];
  function changes<K extends MessagingEvent['name']>(socket: ClientSocket, name: K): Extract<MessagingEvent, { name: K }>[];
  function changes(socket: ClientSocket, name?: MessagingEvent['name']): MessagingEvent[] {
    return (clients.get(socket) ?? []).filter((event) => !name || event.name === name);
  }
  const clear = async () => { await barrier(); for (const rows of clients.values()) rows.length = 0; };
  async function setupChat() {
    const tabs = await Promise.all([tab(sender), tab(sender), tab(recipient), tab(recipient), tab(outsider)]);
    const chat = (await start().expect(201)).body.conversation;
    await clear();
    return { id: chat.id as string, tabs };
  }

  it('fans out A/B messages and read receipts to all four participant tabs, excluding user C', async () => {
    const { id, tabs } = await setupChat();
    const first = (await send(id).expect(201)).body.message;
    await barrier();
    for (const socket of tabs.slice(0, 4)) {
      expect(changes(socket).map((event) => event.name)).toEqual(['message:new', 'conversation:updated']);
      expect(changes(socket, 'message:new')[0].payload).toMatchObject({ message_id: first.id, client_message_id: first.client_message_id, sender_id: sender, sequence: '1' });
    }
    expect(changes(tabs[4])).toEqual([]);
    await clear();
    const reply = (await send(id, { content: 'B trả lời A' }, recipient).expect(201)).body.message;
    await barrier();
    expect(tabs.slice(0, 4).every((socket) => changes(socket, 'message:new')[0].payload.message_id === reply.id)).toBe(true);
    await clear();
    await read(id, reply.sequence).expect(200);
    await barrier();
    for (const socket of tabs.slice(0, 4)) {
      expect(changes(socket, 'message:read')[0].payload).toMatchObject({ user_id: recipient, last_read_sequence: reply.sequence });
    }
    await request(app.getHttpServer()).get(`${base}/unread-count`).set('Authorization', auth(recipient)).expect(200, { unread_messages: 0, unread_conversations: 0 });
    expect(changes(tabs[4])).toEqual([]);
  });

  it('emits no message before commit and no event for a rolled-back mutation', async () => {
    const { id, tabs } = await setupChat();
    let release!: () => void, reached!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const inside = new Promise<void>((resolve) => { reached = resolve; });
    beforeCommit = async () => { reached(); await gate; };
    const pending = send(id).then((response) => response);
    try {
      await inside;
      await barrier();
      expect(tabs.every((socket) => changes(socket).length === 0)).toBe(true);
      expect((await pool.query('SELECT id FROM messages WHERE conversation_id = $1', [id])).rowCount).toBe(0);
    } finally { release(); }
    const committed = await pending;
    expect(committed.status).toBe(201);
    await barrier();
    expect(changes(tabs[2], 'message:new')).toHaveLength(1);
    await clear();
    failCommit = true;
    await send(id).expect(400);
    await barrier();
    expect(tabs.every((socket) => changes(socket).length === 0)).toBe(true);
    expect((await history(id).expect(200)).body.data).toHaveLength(1);
    failCommit = true;
    await read(id, '1').expect(400);
    await barrier();
    expect(changes(tabs[2])).toEqual([]);
  });

  it('publishes once across concurrent REST retries and publishes no duplicate/conflict/stale-read events', async () => {
    const { id, tabs } = await setupChat();
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 6 }, () => send(id, { client_message_id: key }).expect(201)));
    expect(results.filter((response) => response.body.created)).toHaveLength(1);
    await barrier();
    expect(changes(tabs[0], 'message:new')).toHaveLength(1);
    expect(changes(tabs[2], 'message:new')).toHaveLength(1);
    const next = (await send(id).expect(201)).body.message;
    await read(id, next.sequence).expect(200);
    await clear();
    await send(id, { client_message_id: key }).expect(201);
    await send(id, { client_message_id: key, content: 'Khác' }).expect(409);
    await read(id, next.sequence).expect(200);
    await read(id, '1').expect(200);
    await barrier();
    expect(tabs.every((socket) => changes(socket).length === 0)).toBe(true);
  });

  it('publishes conversation creation and block/unblock changes only after actual state changes', async () => {
    const a = await tab(sender), b = await tab(recipient), c = await tab(outsider);
    const chat = (await start().expect(201)).body.conversation;
    await barrier();
    expect(changes(a, 'conversation:updated')[0].payload).toMatchObject({ conversation_id: chat.id, reason: 'created' });
    expect(changes(b, 'conversation:updated')).toHaveLength(1);
    expect(changes(c)).toEqual([]);
    await clear();
    await start().expect(201);
    await barrier();
    expect(changes(a)).toEqual([]);
    for (const blocked of [true, false]) {
      await request(app.getHttpServer())[blocked ? 'put' : 'delete'](`/api/v1/users/me/message-blocks/${recipient}`).set('Authorization', auth()).expect(200);
      await barrier();
      expect(changes(a, 'conversation:updated').at(-1)!.payload).toMatchObject({ reason: 'policy' });
      const count = changes(a).length;
      await request(app.getHttpServer())[blocked ? 'put' : 'delete'](`/api/v1/users/me/message-blocks/${recipient}`).set('Authorization', auth()).expect(200);
      await barrier();
      expect(changes(a)).toHaveLength(count);
      const detail = await request(app.getHttpServer()).get(`${base}/${chat.id}`).set('Authorization', auth(recipient)).expect(200);
      expect(detail.body.can_send).toBe(!blocked);
    }
  });

  it('does not let clients send messages, join other rooms or broadcast forged server events', async () => {
    const { id, tabs } = await setupChat();
    const forged = { conversation_id: id, sender_id: sender, recipient_id: recipient, room: `user:${recipient}`, content: 'Forged payload' };
    for (const name of ['message:new', 'message:send', 'conversation:join', 'join', 'message:read', 'conversation:updated']) tabs[4].emit(name, forged);
    // A Socket.IO ack barrier proves all prior inbound packets were dispatched.
    const outsiderServer = gateway.server.sockets.get(tabs[4].id!)!;
    outsiderServer.once('test:client-barrier', (ack: () => void) => ack());
    await new Promise<void>((resolve) => tabs[4].emit('test:client-barrier', resolve));
    await barrier();
    expect(gateway.server.adapter.rooms.get(`user:${recipient}`)?.has(tabs[4].id!)).toBe(false);
    expect(tabs.every((socket) => changes(socket).length === 0)).toBe(true);
    expect((await history(id).expect(200)).body.data).toEqual([]);
  });

  it('resolves one message through REST with membership, same-conversation checks and tombstone-safe content', async () => {
    const { id } = await setupChat();
    const item = (await send(id).expect(201)).body.message;
    const path = `${base}/${id}/messages/${item.id}`;
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer()).get(path).set('Authorization', auth(outsider)).expect(404);
    const visible = await request(app.getHttpServer()).get(path).set('Authorization', auth(recipient)).expect(200);
    expect(visible.body).toEqual(item);
    expect(visible.headers['cache-control']).toBe('private, no-store');
    await request(app.getHttpServer()).get(`${base}/${randomUUID()}/messages/${item.id}`).set('Authorization', auth()).expect(404);
    await request(app.getHttpServer()).get(`${base}/${id}/messages/${randomUUID()}`).set('Authorization', auth()).expect(404);
    await pool.query('UPDATE messages SET deleted_at = now() WHERE id = $1', [item.id]);
    const hidden = await request(app.getHttpServer()).get(path).set('Authorization', auth(recipient)).expect(200);
    expect(hidden.body).toMatchObject({ id: item.id, content: null, shared_resource: null });
  });

  it('keeps events free of private previews even if a resource changes privacy between commit and publication', async () => {
    const { id, tabs } = await setupChat();
    const publisher = app.get(MessagingEventPublisher);
    const original = publisher.message.bind(publisher);
    const publish = jest.spyOn(publisher, 'message').mockImplementationOnce(async (...args) => {
      await pool.query("UPDATE posts SET visibility = 'private' WHERE id = $1", [post]);
      await original(...args);
    });
    const item = (await send(id, { message_type: 'shared_post', shared_resource_id: post, content: null }).expect(201)).body.message;
    expect(publish).toHaveBeenCalledTimes(1);
    await barrier();
    const metadata = changes(tabs[2], 'message:new')[0].payload;
    expect(metadata).toMatchObject({ message_id: item.id, message_type: 'shared_post' });
    expect(Object.keys(metadata).sort()).toEqual(['client_message_id', 'conversation_id', 'created_at', 'event_id', 'message_id', 'message_type', 'recipient_id', 'sender_id', 'sequence']);
    expect(JSON.stringify(metadata)).not.toMatch(/Private-preview|private\.webp|content|shared_resource/);
    const resolved = await request(app.getHttpServer()).get(`${base}/${id}/messages/${item.id}`).set('Authorization', auth(recipient)).expect(200);
    expect(resolved.body.shared_resource).toMatchObject({ available: false, id: null, title: null, image_url: null });
  });

  it('isolates a recipient transport failure from REST success and other participant tabs', async () => {
    const { id, tabs } = await setupChat();
    const original = gateway.emitMessagingEvent.bind(gateway);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const delivery = jest.spyOn(gateway, 'emitMessagingEvent').mockImplementation(async (user, event) => {
      if (user === recipient) throw new Error('Simulated transport outage');
      await original(user, event);
    });
    const item = (await send(id).expect(201)).body.message;
    await barrier();
    expect(changes(tabs[0], 'message:new')).toHaveLength(1);
    expect(changes(tabs[2])).toEqual([]);
    delivery.mockRestore();
    expect((await history(id).expect(200)).body.data[0].id).toBe(item.id);
    const replay = await send(id, { client_message_id: item.client_message_id }).expect(201);
    expect(replay.body).toMatchObject({ created: false, message: { id: item.id } });
  });

  it('isolates publisher enrichment outages after commit and preserves an idempotent REST result', async () => {
    const { id } = await setupChat();
    const database = app.get(DatabaseService);
    const original = database.query.bind(database);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const failure = jest.spyOn(database, 'query').mockImplementation((sql: string, values: unknown[] = []) => {
      if (sql.includes('SELECT id, sender_id, client_message_id')) return Promise.reject(new Error('Enrichment unavailable'));
      return original(sql, values);
    });
    const item = (await send(id).expect(201)).body.message;
    failure.mockRestore();
    expect((await history(id).expect(200)).body.data[0].id).toBe(item.id);
  });

  it('checks socket expiration at private delivery and keeps other valid tabs receiving', async () => {
    const { id, tabs } = await setupChat();
    gateway.server.sockets.get(tabs[2].id!)!.data.user.exp = Math.floor(Date.now() / 1000) - 1;
    const expired = event(tabs[2], 'auth:expired');
    const disconnected = event(tabs[2], 'disconnect');
    await send(id).expect(201);
    await expired;
    await disconnected;
    await barrier();
    expect(changes(tabs[2])).toEqual([]);
    expect(changes(tabs[3], 'message:new')).toHaveLength(1);
  });

  it('rechecks account activity at publication without sending new events to inactive recipients', async () => {
    const { id, tabs } = await setupChat();
    const publisher = app.get(MessagingEventPublisher);
    const original = publisher.message.bind(publisher);
    jest.spyOn(publisher, 'message').mockImplementationOnce(async (...args) => {
      await pool.query('UPDATE users SET is_active = false WHERE id = $1', [recipient]);
      await original(...args);
    });
    await send(id).expect(201);
    await barrier();
    expect(changes(tabs[0], 'message:new')).toHaveLength(1);
    expect(changes(tabs[2])).toEqual([]);
    expect(changes(tabs[3])).toEqual([]);
  });

  it('recovers offline messages through REST after reconnecting the same client Manager', async () => {
    const { id, tabs } = await setupChat();
    const manager = tabs[2].io;
    tabs[2].disconnect(); tabs[3].disconnect();
    while (gateway.server.adapter.rooms.has(`user:${recipient}`)) await pause();
    const item = (await send(id).expect(201)).body.message;
    expect(changes(tabs[2])).toEqual([]);
    const ready = event(tabs[2], 'notifications:status');
    tabs[2].connect();
    await ready;
    expect(tabs[2].io).toBe(manager);
    expect((await history(id).expect(200)).body.data[0].id).toBe(item.id);
    await request(app.getHttpServer()).get(`${base}/unread-count`).set('Authorization', auth(recipient)).expect(200, { unread_messages: 1, unread_conversations: 1 });
    // Recovery is REST-driven, not a second replay or create path in the gateway.
    expect(changes(tabs[2])).toEqual([]);
    await send(id, { content: 'Sau reconnect' }).expect(201);
    await barrier();
    expect(changes(tabs[2], 'message:new')).toHaveLength(1);
  });

  it('reconnects after a backend restart and retains history in PostgreSQL', async () => {
    const a = await tab(sender, true), b = await tab(recipient, true);
    const id = (await start().expect(201)).body.conversation.id;
    const first = (await send(id).expect(201)).body.message;
    await clear();
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const disconnected = [event(a, 'disconnect'), event(b, 'disconnect')];
    const reconnected = [event(a, 'notifications:status'), event(b, 'notifications:status')];
    // Drop the underlying transport as a process restart would, before graceful shutdown.
    for (const socket of gateway.server.sockets.values()) socket.conn.close();
    await app.close();
    await Promise.all(disconnected);
    await boot(port);
    await Promise.all(reconnected);
    expect((await history(id).expect(200)).body.data[0].id).toBe(first.id);
    const next = (await send(id, { content: 'Sau restart' }).expect(201)).body.message;
    await barrier();
    expect(changes(a, 'message:new')).toHaveLength(1);
    expect(changes(b, 'message:new')[0].payload).toMatchObject({ message_id: next.id });
  });
});
