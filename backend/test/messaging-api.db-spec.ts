import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client, Pool, PoolClient } from 'pg';
import request from 'supertest';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { DatabaseModule } from '../src/database/database.module';
import { DatabaseService } from '../src/database/database.service';
import { MessagingModule } from '../src/messaging/messaging.module';
import { MessagingPolicyService } from '../src/messaging/messaging-policy.service';
import type { ConversationDto, MessageDto } from '../src/messaging/messaging.types';

// Real HTTP/guards/validation and committed independent PostgreSQL transactions.
// Never load .env or fall back to the application's DATABASE_URL.
const databaseUrl = process.env.WANDERMAP_TEST_DATABASE_URL;
const disposable = databaseUrl && /(?:^|_)test(?:_|$)/i.test(new URL(databaseUrl).pathname.slice(1));
const describeDatabase = disposable ? describe : describe.skip;

describeDatabase('Messaging REST API on PostgreSQL/PostGIS', () => {
  const schema = `messaging_api_test_${randomUUID().replaceAll('-', '')}`;
  const secret = 'messaging-api-isolated-test-key-minimum-32-characters';
  const jwt = new JwtService({ secret });
  let app: INestApplication;
  let pool: Pool;
  let schemaCreated = false;
  let failCommit = false;
  let owner: string, recipient: string, outsider: string, fourth: string, inactive: string;
  let location: string, otherLocation: string, post: string;
  const base = '/api/v1/conversations';
  const token = (user = owner) => `Bearer ${jwt.sign({ sub: user, email: `${user}@example.test` }, { expiresIn: 300 })}`;
  const http = () => app.getHttpServer();
  const start = (target = recipient, actor = owner) => request(http()).post(`${base}/direct`).set('Authorization', token(actor)).send({ recipient_id: target });
  const detail = (id: string, actor = owner) => request(http()).get(`${base}/${id}`).set('Authorization', token(actor));
  const history = (id: string, actor = owner) => request(http()).get(`${base}/${id}/messages`).set('Authorization', token(actor));
  const send = (id: string, extra: object = {}, actor = owner) => request(http()).post(`${base}/${id}/messages`).set('Authorization', token(actor))
    .send({ client_message_id: randomUUID(), message_type: 'text', content: 'Xin chào Việt Nam 🗺️', ...extra });
  const read = (id: string, sequence: string, actor = recipient) => request(http()).patch(`${base}/${id}/read`).set('Authorization', token(actor)).send({ last_read_sequence: sequence });
  const block = (target = recipient, actor = owner, blocked = true) => request(http())[blocked ? 'put' : 'delete'](`/api/v1/users/me/message-blocks/${target}`).set('Authorization', token(actor));
  const counts = (actor = recipient) => request(http()).get(`${base}/unread-count`).set('Authorization', token(actor));
  const conversation = async (target = recipient, actor = owner): Promise<ConversationDto> => (await start(target, actor).expect(201)).body.conversation;
  const createMessage = async (id: string, extra: object = {}, actor = owner): Promise<MessageDto> => (await send(id, extra, actor).expect(201)).body.message;

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
      expect(files).toContain('014_messaging_blocks.sql');
      for (const file of files) await setup.query(await readFile(path.join(directory, file), 'utf8'));
      await setup.query('COMMIT');
      schemaCreated = true;
    } catch (error) { await setup.query('ROLLBACK'); throw error; }
    finally { await setup.end(); }
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 12 });
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true, load: [() => ({ JWT_ACCESS_SECRET: secret })] }),
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]), DatabaseModule, MessagingModule,
    ] }).overrideProvider(DatabaseService).useValue({
      query: (sql: string, values: unknown[]) => pool.query(sql, values),
      transaction: async <T>(work: (client: PoolClient) => Promise<T>) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await work(client);
          if (failCommit) { failCommit = false; throw new BadRequestException('Simulated transaction failure.'); }
          await client.query('COMMIT');
          return result;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      },
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    // The shared gateway also owns the HTTP server. Keep it listening throughout
    // the suite instead of having concurrent Supertest requests reopen/close it.
    await app.listen(0, '127.0.0.1');
  });

  beforeEach(async () => {
    failCommit = false;
    [owner, recipient, outsider, fourth, inactive] = Array.from({ length: 5 }, () => randomUUID());
    [location, otherLocation, post] = Array.from({ length: 3 }, () => randomUUID());
    for (const user of [owner, recipient, outsider, fourth, inactive]) {
      await pool.query('INSERT INTO users (id, email, is_active) VALUES ($1, $2, $3)', [user, `${user}@example.test`, user !== inactive]);
      await pool.query('INSERT INTO profiles (id, username, display_name) VALUES ($1, $2, $3)', [user, `msg_${user.replaceAll('-', '').slice(0, 20)}`, 'Người dùng thử nghiệm']);
    }
    for (const id of [location, otherLocation]) {
      await pool.query("INSERT INTO locations (id, name, address, coordinates) VALUES ($1, 'Đà Lạt', 'Lâm Đồng', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326))", [id]);
    }
    await pool.query(`INSERT INTO posts (id, author_id, location_id, content, images, rating, visited_at)
      VALUES ($1, $2, $3, 'Bài viết du lịch', ARRAY['https://example.test/post.webp'], 5, '2026-10-23')`, [post, owner, location]);
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (!schemaCreated) return;
    const cleanup = new Client({ connectionString: databaseUrl });
    await cleanup.connect();
    try {
      if (!/^messaging_api_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid generated schema');
      await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally { await cleanup.end(); }
  });

  it('requires valid active JWTs on every endpoint, including blocks', async () => {
    const chat = await conversation();
    for (const operation of [
      () => request(http()).get(base), () => request(http()).post(`${base}/direct`).send({ recipient_id: recipient }),
      () => request(http()).get(`${base}/${chat.id}`), () => request(http()).get(`${base}/${chat.id}/messages`),
      () => request(http()).post(`${base}/${chat.id}/messages`).send({}), () => request(http()).patch(`${base}/${chat.id}/read`).send({ last_read_sequence: '1' }),
      () => request(http()).get(`${base}/unread-count`), () => request(http()).put(`/api/v1/users/me/message-blocks/${recipient}`),
      () => request(http()).delete(`/api/v1/users/me/message-blocks/${recipient}`),
    ]) await operation().expect(401);
    for (const invalid of ['Bearer invalid', token(inactive), token(randomUUID()),
      `Bearer ${jwt.sign({ sub: owner, email: 'test@example.test' }, { expiresIn: -1 })}`,
      `Bearer ${jwt.sign({ sub: owner, email: 'test@example.test' })}`]) {
      await request(http()).get(base).set('Authorization', invalid).expect(401);
    }
  });

  it('creates a direct chat, retrieves the same A-B/B-A pair and exposes only safe profile data', async () => {
    const created = await start().expect(201);
    expect(created.body.created).toBe(true);
    const id = created.body.conversation.id;
    const reversed = await start(owner, recipient).expect(201);
    expect(reversed.body).toMatchObject({ created: false, conversation: { id } });
    const result = await detail(id).expect(200);
    expect(result.headers['cache-control']).toBe('private, no-store');
    expect(result.body).toMatchObject({ id, recipient: { id: recipient, is_active: true }, can_send: true, last_message: null, unread_count: 0 });
    expect(Object.keys(result.body.recipient).sort()).toEqual(['avatar_url', 'display_name', 'id', 'is_active', 'username']);
    expect(JSON.stringify(result.body)).not.toMatch(/password_hash|email|token|direct_user/);
  });

  it('rejects self chats, missing/inactive recipients and participant injection', async () => {
    await start(owner).expect(400);
    await start(inactive).expect(404);
    await start(randomUUID()).expect(404);
    for (const body of [{ recipient_id: 'bad' }, { recipient_id: null }, { recipient_id: recipient, participants: [outsider] }, { recipient_id: recipient, user_id: outsider }]) {
      await request(http()).post(`${base}/direct`).set('Authorization', token()).send(body).expect(400);
    }
  });

  it('does not expose an outsider conversation through detail, history, send, read or list', async () => {
    const chat = await conversation();
    const item = await createMessage(chat.id);
    await detail(chat.id, outsider).expect(404);
    await history(chat.id, outsider).expect(404);
    await send(chat.id, {}, outsider).expect(404);
    await read(chat.id, item.sequence, outsider).expect(404);
    const list = await request(http()).get(base).set('Authorization', token(outsider)).expect(200);
    expect(list.body.data).toEqual([]);
    expect((await detail(chat.id).expect(200)).body.recipient_read_state.last_read_sequence).toBeNull();
    for (const missing of [randomUUID(), 'bad-id']) await detail(missing).expect(missing === 'bad-id' ? 400 : 404);
  });

  it('persists Unicode messages, derives sender from JWT and keeps history after subsequent REST requests', async () => {
    const chat = await conversation();
    const first = await createMessage(chat.id);
    const second = await createMessage(chat.id, { content: '  Tin nhắn từ người nhận\nDòng hai  ' }, recipient);
    expect(second.content).toBe('Tin nhắn từ người nhận\nDòng hai');
    expect(first.sender_id).toBe(owner);
    expect(second.sender_id).toBe(recipient);
    expect(first.sequence).toBe('1');
    expect(second.sequence).toBe('2');
    const refreshed = await history(chat.id, recipient).expect(200);
    expect(refreshed.body.data.map((item: MessageDto) => item.id)).toEqual([second.id, first.id]);
    expect((await detail(chat.id).expect(200)).body.last_message.id).toBe(second.id);
    expect((await pool.query('SELECT content FROM messages WHERE id = $1', [first.id])).rows[0].content).toBe(first.content);
  });

  it('validates message shapes/size and rejects forged sender, sequence, metadata and participant fields', async () => {
    const chat = await conversation();
    for (const invalid of [
      { content: '' }, { content: '\t\n\u00a0\u2003' }, { content: null }, { content: 'a'.repeat(4001) },
      { client_message_id: null }, { client_message_id: 'bad' }, { message_type: 'image' },
      { sender_id: outsider }, { sequence: '123' }, { metadata: { title: 'Fake title' } }, { participants: [outsider] },
      { message_type: 'shared_post' }, { shared_resource_id: post }, { shared_resource_id: null }, { content: {} },
    ]) await send(chat.id, invalid).expect(400);
    await createMessage(chat.id, { content: '🗺'.repeat(4000) });
    expect((await pool.query('SELECT count(*)::integer AS count FROM messages WHERE conversation_id = $1', [chat.id])).rows[0].count).toBe(1);
  });

  it('replays the original message, normalizes content and rejects changed content/type/resource/conversation', async () => {
    const chat = await conversation();
    const key = randomUUID();
    const first = await send(chat.id, { client_message_id: key, content: '  Xin chào  ' }).expect(201);
    const retry = await send(chat.id, { client_message_id: key, content: 'Xin chào' }).expect(201);
    expect(retry.body).toMatchObject({ created: false, message: { id: first.body.message.id, sequence: first.body.message.sequence } });
    const changed = await send(chat.id, { client_message_id: key, content: 'Khác' }).expect(409);
    expect(changed.body.code).toBe('IDEMPOTENCY_CONFLICT');
    await send(chat.id, { client_message_id: key, message_type: 'shared_post', shared_resource_id: post }).expect(409);
    const other = await conversation(outsider);
    await send(other.id, { client_message_id: key, content: 'Xin chào' }).expect(409);
    const sameKeyOtherSender = await createMessage(chat.id, { client_message_id: key, content: 'Xin chào' }, recipient);
    expect(sameKeyOtherSender.id).not.toBe(first.body.message.id);
    const shareKey = randomUUID();
    await createMessage(chat.id, { client_message_id: shareKey, message_type: 'shared_location', shared_resource_id: location, content: null });
    await send(chat.id, { client_message_id: shareKey, message_type: 'shared_location', shared_resource_id: otherLocation, content: null }).expect(409);
    expect((await pool.query('SELECT message_sequence FROM conversations WHERE id = $1', [chat.id])).rows[0].message_sequence).toBe('3');
  });

  it('creates one conversation and one message across concurrent HTTP retries', async () => {
    const chats = await Promise.all(Array.from({ length: 8 }, (_, index) => start(index % 2 ? owner : recipient, index % 2 ? recipient : owner).expect(201)));
    const ids = new Set(chats.map((response) => response.body.conversation.id));
    expect(ids.size).toBe(1);
    expect(chats.filter((response) => response.body.created)).toHaveLength(1);
    const id = chats[0].body.conversation.id;
    const key = randomUUID();
    const sent = await Promise.all(Array.from({ length: 8 }, () => send(id, { client_message_id: key }).expect(201)));
    expect(new Set(sent.map((response) => response.body.message.id)).size).toBe(1);
    expect(sent.filter((response) => response.body.created)).toHaveLength(1);
    expect((await history(id, recipient).expect(200)).body.data).toHaveLength(1);
    expect((await detail(id).expect(200)).body.last_message.id).toBe(sent[0].body.message.id);
  });

  it('returns one winner and one explicit conflict for concurrent same-key/different-payload requests', async () => {
    const chat = await conversation();
    const key = randomUUID();
    const responses = await Promise.all([send(chat.id, { client_message_id: key, content: 'Một' }), send(chat.id, { client_message_id: key, content: 'Hai' })]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.status === 409)!.body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await history(chat.id).expect(200)).body.data).toHaveLength(1);
  });

  it('enforces sender-scoped idempotency across two concurrently written conversations', async () => {
    const first = await conversation();
    const second = await conversation(outsider);
    const key = randomUUID();
    const responses = await Promise.all([send(first.id, { client_message_id: key }), send(second.id, { client_message_id: key })]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect((await pool.query('SELECT count(*)::integer AS count FROM messages WHERE sender_id = $1 AND client_message_id = $2', [owner, key])).rows[0].count).toBe(1);
  });

  it('paginates message history without duplicates while newer messages arrive and preserves bigint precision', async () => {
    const chat = await conversation();
    await pool.query("UPDATE conversations SET message_sequence = '9007199254740992' WHERE id = $1", [chat.id]);
    const messages = [];
    for (let index = 0; index < 7; index++) messages.push(await createMessage(chat.id));
    const first = await history(chat.id).query({ limit: 2 }).expect(200);
    expect(first.body.data[0].sequence).toBe('9007199254740999');
    expect(first.body.next_cursor).toBe('9007199254740998');
    await createMessage(chat.id);
    const found = [...first.body.data];
    let cursor = first.body.next_cursor;
    while (cursor) {
      const page = await history(chat.id).query({ limit: 2, before_sequence: cursor }).expect(200);
      found.push(...page.body.data);
      cursor = page.body.next_cursor;
    }
    expect(found.map((item: MessageDto) => item.id)).toEqual(messages.map((item) => item.id).reverse());
    expect(new Set(found.map((item: MessageDto) => item.id)).size).toBe(7);
  });

  it('paginates conversation activity with microsecond precision and UUID tie-breakers', async () => {
    const chats = [await conversation(), await conversation(outsider), await conversation(fourth)];
    for (const chat of chats) await createMessage(chat.id);
    for (const [index, chat] of chats.entries()) {
      await pool.query('UPDATE conversations SET last_message_at = $2 WHERE id = $1', [chat.id, `2026-10-23T12:34:56.${index === 0 ? '123457' : '123456'}Z`]);
    }
    const expected = [chats[0].id, ...chats.slice(1).map((chat) => chat.id).sort().reverse()];
    const found: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await request(http()).get(base).set('Authorization', token()).query({ limit: 1, ...(cursor ? { cursor } : {}) }).expect(200);
      found.push(...page.body.data.map((chat: ConversationDto) => chat.id));
      cursor = page.body.next_cursor ?? undefined;
    } while (cursor);
    expect(found).toEqual(expected);
    expect((await request(http()).get(base).set('Authorization', token(recipient)).expect(200)).body.data).toHaveLength(1);
  });

  it('rejects malformed cursors, out-of-range sequences, excessive page sizes and unknown query fields', async () => {
    const chat = await conversation();
    for (const query of [{ limit: 0 }, { limit: 51 }, { cursor: '' }, { cursor: 'not-json' }, { cursor: Buffer.from(JSON.stringify(['2026-02-30T12:00:00.000000Z', chat.id])).toString('base64url') }, { page: 1 }]) {
      await request(http()).get(base).set('Authorization', token()).query(query).expect(400);
    }
    for (const before_sequence of ['0', '-1', '01', '1.5', '1e3', '9223372036854775808', "1'; SELECT 1"])
      await history(chat.id).query({ before_sequence }).expect(400);
    for (const query of [{ limit: 101 }, { limit: 0 }, { page: 1 }]) await history(chat.id).query(query).expect(400);
  });

  it('keeps read state per participant, idempotent and monotonic; GET does not mark background messages read', async () => {
    const chat = await conversation();
    const first = await createMessage(chat.id);
    await createMessage(chat.id, {}, recipient);
    const latest = await createMessage(chat.id);
    await counts().expect(200, { unread_messages: 2, unread_conversations: 1 });
    await history(chat.id, recipient).expect(200);
    await counts().expect(200, { unread_messages: 2, unread_conversations: 1 });
    const advanced = await read(chat.id, latest.sequence).expect(200);
    expect(advanced.body).toMatchObject({ conversation_id: chat.id, last_read_sequence: latest.sequence, unread_count: 0 });
    expect((await read(chat.id, first.sequence).expect(200)).body).toEqual(advanced.body);
    expect((await read(chat.id, latest.sequence).expect(200)).body).toEqual(advanced.body);
    expect((await detail(chat.id).expect(200)).body.read_state.last_read_sequence).toBeNull();
    await counts(owner).expect(200, { unread_messages: 1, unread_conversations: 1 });
    await createMessage(chat.id);
    await counts().expect(200, { unread_messages: 1, unread_conversations: 1 });
  });

  it('rejects nonexistent/cross-conversation read cursors and attempts to mark another participant read', async () => {
    const chat = await conversation();
    await createMessage(chat.id);
    const other = await conversation(outsider);
    await createMessage(other.id);
    const onlyOther = await createMessage(other.id);
    const invalid = await read(chat.id, onlyOther.sequence).expect(400);
    expect(invalid.body.code).toBe('INVALID_READ_CURSOR');
    for (const last_read_sequence of [null, 1, '0', '-1', '9223372036854775808']) {
      await request(http()).patch(`${base}/${chat.id}/read`).set('Authorization', token(recipient)).send({ last_read_sequence }).expect(400);
    }
    await request(http()).patch(`${base}/${chat.id}/read`).set('Authorization', token(recipient)).send({ last_read_sequence: '1', user_id: owner }).expect(400);
    expect((await detail(chat.id).expect(200)).body.recipient_read_state.last_read_sequence).toBeNull();
  });

  it('keeps concurrent device reads monotonic and counts a later send as unread', async () => {
    const chat = await conversation();
    const items = [];
    for (let index = 0; index < 3; index++) items.push(await createMessage(chat.id));
    await Promise.all([read(chat.id, items[2].sequence).expect(200), read(chat.id, items[0].sequence).expect(200)]);
    expect((await detail(chat.id).expect(200)).body.recipient_read_state.last_read_sequence).toBe(items[2].sequence);
    await createMessage(chat.id);
    await counts().expect(200, { unread_messages: 1, unread_conversations: 1 });
  });

  it('aggregates unread across conversations and excludes own/soft-deleted messages', async () => {
    const first = await conversation();
    await createMessage(first.id);
    const deleted = await createMessage(first.id);
    await pool.query('UPDATE messages SET deleted_at = now() WHERE id = $1', [deleted.id]);
    await createMessage(first.id, {}, recipient);
    const second = await conversation(recipient, outsider);
    await createMessage(second.id, {}, outsider);
    await counts().expect(200, { unread_messages: 2, unread_conversations: 2 });
    const result = await history(first.id, recipient).expect(200);
    const tombstone = result.body.data.find((item: MessageDto) => item.id === deleted.id);
    expect(tombstone.content).toBeNull();
    expect(tombstone.shared_resource).toBeNull();
  });

  it('preserves history after a recipient becomes inactive and prevents new sends', async () => {
    const chat = await conversation();
    const key = randomUUID();
    const first = await createMessage(chat.id, { client_message_id: key });
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [recipient]);
    expect((await detail(chat.id).expect(200)).body).toMatchObject({ can_send: false, recipient: { is_active: false } });
    const denied = await send(chat.id).expect(403);
    expect(denied.body.code).toBe('RECIPIENT_UNAVAILABLE');
    expect((await send(chat.id, { client_message_id: key }).expect(201)).body).toMatchObject({ created: false, message: { id: first.id } });
    await history(chat.id).expect(200);
    await history(chat.id, recipient).expect(401);
  });

  it('blocks start/send in both directions, retains member history and makes block/unblock idempotent', async () => {
    const chat = await conversation();
    const key = randomUUID();
    const existing = await createMessage(chat.id, { client_message_id: key });
    await block().expect(200, { user_id: recipient, blocked: true });
    await block().expect(200);
    await start().expect(403);
    await start(owner, recipient).expect(403);
    await send(chat.id).expect(403);
    await send(chat.id, {}, recipient).expect(403);
    const blockedDetail = await detail(chat.id).expect(200);
    expect(blockedDetail.body).toMatchObject({ can_send: false, blocked_by_me: true });
    await history(chat.id, recipient).expect(200);
    await read(chat.id, existing.sequence).expect(200);
    expect((await send(chat.id, { client_message_id: key }).expect(201)).body.created).toBe(false);
    await block(owner, recipient, false).expect(200); // Does not remove the owner's block.
    await send(chat.id, {}, recipient).expect(403);
    await block(recipient, owner, false).expect(200);
    await block(recipient, owner, false).expect(200);
    await send(chat.id).expect(201);
    await block(owner).expect(400);
    await block(randomUUID()).expect(404);
  });

  it('applies a block before any conversation exists and validates block FKs', async () => {
    await block().expect(200);
    await start().expect(403);
    expect((await pool.query('SELECT count(*)::integer AS count FROM conversations WHERE direct_user_low_id = $1 OR direct_user_high_id = $1', [owner])).rows[0].count).toBe(0);
    await expect(pool.query('INSERT INTO messaging_blocks (blocker_id, blocked_id) VALUES ($1, $1)', [owner])).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query('INSERT INTO messaging_blocks (blocker_id, blocked_id) VALUES ($1, $2)', [owner, randomUUID()])).rejects.toMatchObject({ code: '23503' });
  });

  it('rolls back the message, preview, cursor allocation and retry key when the transaction fails', async () => {
    failCommit = true;
    await start().expect(400);
    expect((await pool.query('SELECT count(*)::integer AS count FROM conversations WHERE direct_user_low_id = $1 OR direct_user_high_id = $1', [owner])).rows[0].count).toBe(0);
    const chat = await conversation();
    const key = randomUUID();
    failCommit = true;
    await send(chat.id, { client_message_id: key }).expect(400);
    expect((await history(chat.id).expect(200)).body.data).toEqual([]);
    expect((await detail(chat.id).expect(200)).body.last_message).toBeNull();
    const retry = await send(chat.id, { client_message_id: key }).expect(201);
    expect(retry.body).toMatchObject({ created: true, message: { sequence: '1' } });
    failCommit = true;
    await read(chat.id, '1').expect(400);
    expect((await detail(chat.id).expect(200)).body.recipient_read_state.last_read_sequence).toBeNull();
  });

  it('rate limits the authenticated sender across conversations without blocking a different sender', async () => {
    const first = await conversation();
    const second = await conversation(outsider);
    const key = randomUUID();
    for (let count = 0; count < 30; count++) await send(first.id, { client_message_id: key }).expect(201);
    const limited = await send(second.id).expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    await send(first.id, {}, recipient).expect(201);
  });

  it('shares public posts/locations and filters previews again when visibility changes', async () => {
    const chat = await conversation();
    const shared = await createMessage(chat.id, { message_type: 'shared_post', shared_resource_id: post, content: null });
    expect(shared.shared_resource).toMatchObject({ available: true, id: post, title: 'Bài viết du lịch', author: { id: owner }, location: { id: location } });
    const place = await createMessage(chat.id, { message_type: 'shared_location', shared_resource_id: location, content: ' \t ' });
    expect(place.content).toBeNull();
    expect(place.shared_resource).toMatchObject({ available: true, id: location, title: 'Đà Lạt', address: 'Lâm Đồng' });
    await pool.query("UPDATE posts SET visibility = 'private' WHERE id = $1", [post]);
    const recipientView = await history(chat.id, recipient).expect(200);
    const hidden = recipientView.body.data.find((item: MessageDto) => item.id === shared.id);
    expect(hidden.shared_resource).toMatchObject({ available: false, id: null, title: null, image_url: null, author: null });
    expect(JSON.stringify(hidden)).not.toContain('Bài viết du lịch');
    expect((await history(chat.id).expect(200)).body.data.find((item: MessageDto) => item.id === shared.id).shared_resource.available).toBe(true);
    await send(chat.id, { message_type: 'shared_post', shared_resource_id: post, content: null }).expect(404);
  });

  it('rejects forged shared previews and allows only server-resolved resource metadata', async () => {
    const chat = await conversation();
    for (const extra of [{ shared_resource: { available: true, title: 'Forged title', image_url: 'https://example.test/forged.webp' } },
      { title: 'Forged title' }, { coordinates: { lat: 1, lng: 2 } }]) {
      await send(chat.id, { message_type: 'shared_location', shared_resource_id: location, content: null, ...extra }).expect(400);
    }
    expect((await history(chat.id).expect(200)).body.data).toHaveLength(0);
    const message = await createMessage(chat.id, { message_type: 'shared_location', shared_resource_id: location, content: null });
    expect(message.shared_resource).toMatchObject({ available: true, id: location, title: 'Đà Lạt', address: 'Lâm Đồng' });
  });

  it('validates Unicode share captions against database code-point limits before INSERT', async () => {
    const chat = await conversation();
    for (const character of ['🗺️', '☀︎']) {
      const valid = await createMessage(chat.id, { message_type: 'shared_location', shared_resource_id: location, content: character.repeat(2000) });
      expect(valid.content).toBe(character.repeat(2000));
      await send(chat.id, { message_type: 'shared_location', shared_resource_id: location, content: character.repeat(2001) }).expect(400);
    }
    await createMessage(chat.id, { message_type: 'shared_post', shared_resource_id: post, content: '🌿'.repeat(4000) });
    await send(chat.id, { message_type: 'shared_post', shared_resource_id: post, content: '🌿'.repeat(4001) }).expect(400);
  });

  it('rechecks the sending viewer after access is revoked and never reveals cached post metadata', async () => {
    await pool.query("UPDATE posts SET visibility = 'followers', author_id = $2 WHERE id = $1", [post, outsider]);
    await pool.query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $3), ($2, $3)', [owner, recipient, outsider]);
    const chat = await conversation();
    const key = randomUUID();
    const message = await createMessage(chat.id, { message_type: 'shared_post', shared_resource_id: post, content: null, client_message_id: key });
    await pool.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [owner, outsider]);
    const hidden = (await history(chat.id).expect(200)).body.data.find((row: MessageDto) => row.id === message.id);
    expect(hidden.shared_resource).toMatchObject({ available: false, id: null, title: null, image_url: null, author: null, location: null });
    const retry = await send(chat.id, { message_type: 'shared_post', shared_resource_id: post, content: null, client_message_id: key }).expect(201);
    expect(retry.body).toMatchObject({ created: false, message: { id: message.id, shared_resource: { available: false } } });
    await send(chat.id, { message_type: 'shared_post', shared_resource_id: post, content: null }).expect(404);
    expect((await history(chat.id, recipient).expect(200)).body.data.find((row: MessageDto) => row.id === message.id).shared_resource.available).toBe(true);
  });

  it('requires visibility for both sender and recipient, including followers-only posts', async () => {
    const chat = await conversation();
    await pool.query("UPDATE posts SET visibility = 'followers' WHERE id = $1", [post]);
    await send(chat.id, { message_type: 'shared_post', shared_resource_id: post, content: null }).expect(404);
    await pool.query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)', [recipient, owner]);
    await createMessage(chat.id, { message_type: 'shared_post', shared_resource_id: post, content: null });
    await pool.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [recipient, owner]);
    expect((await detail(chat.id, recipient).expect(200)).body.last_message.shared_resource).toMatchObject({ available: false, title: null });
    await pool.query("UPDATE posts SET visibility = 'private', author_id = $2 WHERE id = $1", [post, outsider]);
    await send(chat.id, { message_type: 'shared_post', shared_resource_id: post, content: null }).expect(404);
    for (const message_type of ['shared_post', 'shared_location', 'shared_journey']) {
      await send(chat.id, { message_type, shared_resource_id: randomUUID(), content: null }).expect(404);
    }
  });

  it('keeps resource-deleted messages available as tombstones and replays the same key after deletion', async () => {
    const chat = await conversation();
    const key = randomUUID();
    const item = await createMessage(chat.id, { client_message_id: key, message_type: 'shared_post', shared_resource_id: post, content: null });
    await pool.query('DELETE FROM posts WHERE id = $1', [post]);
    const retry = await send(chat.id, { client_message_id: key, message_type: 'shared_post', shared_resource_id: post, content: null }).expect(201);
    expect(retry.body).toMatchObject({ created: false, message: { id: item.id, shared_resource: { available: false, id: null } } });
    expect((await detail(chat.id, recipient).expect(200)).body.last_message.shared_resource.available).toBe(false);
    await send(chat.id, { message_type: 'shared_post', shared_resource_id: post, content: null }).expect(404);
  });

  async function createJourney(visibility = 'public', status = 'published') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const id = (await client.query<{ id: string }>('INSERT INTO journeys (user_id, title, visibility, status) VALUES ($1, $2, $3, $4) RETURNING id', [owner, 'Hành trình chia sẻ', visibility, status])).rows[0].id;
      for (const [index, place] of [location, otherLocation].entries()) {
        await client.query('INSERT INTO journey_stops (journey_id, user_id, location_id, stop_order, location_name_snapshot) VALUES ($1, $2, $3, $4, $5)', [id, owner, place, index + 1, 'Đà Lạt']);
      }
      await client.query('COMMIT');
      return id;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  it('shares only accessible published journeys and hides previews after privacy/deletion', async () => {
    const chat = await conversation();
    const journey = await createJourney();
    const shared = await createMessage(chat.id, { message_type: 'shared_journey', shared_resource_id: journey, content: null });
    expect(shared.shared_resource).toMatchObject({ available: true, id: journey, title: 'Hành trình chia sẻ' });
    await pool.query("UPDATE journeys SET visibility = 'private' WHERE id = $1", [journey]);
    await send(chat.id, { message_type: 'shared_journey', shared_resource_id: journey, content: null }).expect(404);
    expect((await detail(chat.id, recipient).expect(200)).body.last_message.shared_resource).toMatchObject({ available: false, title: null });
    const draft = await createJourney('public', 'draft');
    await send(chat.id, { message_type: 'shared_journey', shared_resource_id: draft, content: null }).expect(404);
    await pool.query('DELETE FROM journeys WHERE id = $1', [journey]);
    expect((await detail(chat.id).expect(200)).body.last_message.shared_resource.available).toBe(false);
  });

  it('applies live journey/author policy when sharing a journey-backed post', async () => {
    const chat = await conversation();
    const journey = await createJourney();
    const journeyPost = (await pool.query<{ id: string }>(`INSERT INTO posts
      (author_id, post_type, journey_id, preview_revision, content, images)
      VALUES ($1, 'journey', $2, 1, 'Hành trình trên Feed', ARRAY['https://example.test/journey.webp']) RETURNING id`, [owner, journey])).rows[0].id;
    const shared = await createMessage(chat.id, { message_type: 'shared_post', shared_resource_id: journeyPost, content: null });
    expect(shared.shared_resource?.available).toBe(true);
    await pool.query("UPDATE journeys SET status = 'draft' WHERE id = $1", [journey]);
    const hidden = (await detail(chat.id, recipient).expect(200)).body.last_message;
    expect(hidden.shared_resource).toMatchObject({ available: false, title: null, image_url: null });
    await send(chat.id, { message_type: 'shared_post', shared_resource_id: journeyPost, content: null }).expect(404);
    await pool.query("UPDATE journeys SET status = 'published' WHERE id = $1", [journey]);
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [owner]);
    expect((await detail(chat.id, recipient).expect(200)).body.last_message.shared_resource.available).toBe(false);
  });

  it.each(['block', 'send'])('serializes a simultaneous block/send decision (first: %s)', async (firstOperation) => {
    const chat = await conversation();
    const policy = app.get(MessagingPolicyService);
    const original = policy.lockPair.bind(policy);
    let release!: () => void, reached!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<void>((resolve) => { reached = resolve; });
    let first = true;
    const spy = jest.spyOn(policy, 'lockPair').mockImplementation(async (...args) => {
      await original(...args);
      if (first) { first = false; reached(); await gate; }
    });
    let firstRequest: Promise<request.Response> | undefined, secondRequest: Promise<request.Response> | undefined;
    try {
      firstRequest = (firstOperation === 'block' ? block() : send(chat.id)).then((response) => response);
      await locked;
      secondRequest = (firstOperation === 'block' ? send(chat.id) : block()).then((response) => response);
      const deadline = Date.now() + 3000;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        waiting = (await pool.query<{ waiting: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE pid <> pg_backend_pid() AND cardinality(pg_blocking_pids(pid)) > 0
            AND query LIKE '%pg_advisory_xact_lock%' AND query NOT LIKE '%pg_stat_activity%') AS waiting`)).rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      release();
      const [one, two] = await Promise.all([firstRequest, secondRequest]);
      expect(one.status).toBe(firstOperation === 'block' ? 200 : 201);
      expect(two.status).toBe(firstOperation === 'block' ? 403 : 200);
      expect((await history(chat.id).expect(200)).body.data).toHaveLength(firstOperation === 'block' ? 0 : 1);
      await send(chat.id).expect(403);
    } finally {
      release();
      await Promise.allSettled([firstRequest, secondRequest]);
      spy.mockRestore();
    }
  });

  it('returns the existing API error envelope without message content or SQL details', async () => {
    const chat = await conversation();
    const response = await send(chat.id, { sender_id: outsider }).set('X-Request-Id', 'messaging-error-test').expect(400);
    expect(response.body).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST', path: `${base}/${chat.id}/messages`, requestId: 'messaging-error-test' });
    expect(typeof response.body.timestamp).toBe('string');
    expect(JSON.stringify(response.body)).not.toMatch(/SELECT|INSERT|password|Xin chào/);
  });
});
