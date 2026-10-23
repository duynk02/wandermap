import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

// Committed, concurrent connections require an explicitly selected disposable DB.
// Never load .env or fall back to the application's DATABASE_URL.
const databaseUrl = process.env.WANDERMAP_TEST_DATABASE_URL;
const disposable = databaseUrl && /(?:^|_)test(?:_|$)/i.test(new URL(databaseUrl).pathname.slice(1));
const describeDatabase = disposable ? describe : describe.skip;

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  sequence: string;
  client_message_id: string;
  message_type: string;
  content: string | null;
  shared_resource_id: string | null;
  shared_post_id: string | null;
  shared_location_id: string | null;
  shared_journey_id: string | null;
  created_at: Date;
}

describeDatabase('Phase 4 Feature 1: conversations/messages on real PostgreSQL', () => {
  const schema = `messaging_test_${randomUUID().replaceAll('-', '')}`;
  const users = [randomUUID(), randomUUID(), randomUUID()];
  const [sender, recipient, outsider] = users;
  const location = randomUUID();
  const post = randomUUID();
  const journey = randomUUID();
  let db: Client;
  let schemaCreated = false;
  let inTransaction = false;
  let legacySnapshot: unknown;

  const snapshot = async () => (await db.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM posts p) AS posts,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM profiles p) AS profiles,
    (SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM notifications n) AS notifications,
    (SELECT ST_AsEWKT(coordinates) FROM locations WHERE id = $1) AS geometry`, [location])).rows[0];

  beforeAll(async () => {
    db = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    await db.connect();
    await db.query('BEGIN');
    try {
      for (const extension of ['postgis', 'unaccent', 'pg_trgm']) {
        await db.query(`CREATE EXTENSION IF NOT EXISTS ${extension} WITH SCHEMA public`);
      }
      await db.query(`CREATE SCHEMA "${schema}"`);
      await db.query(`SET LOCAL search_path TO "${schema}", public`);
      const directory = path.resolve(__dirname, '../src/database/migrations');
      const files = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
      const migration = '013_conversations_messages.sql';
      expect(files).toContain(migration);
      for (const file of files.filter((name) => name < migration)) {
        await db.query(await readFile(path.join(directory, file), 'utf8'));
      }
      for (const [index, user] of users.entries()) {
        await db.query('INSERT INTO users (id, email) VALUES ($1, $2)', [user, `${user}@example.test`]);
        await db.query('INSERT INTO profiles (id, username, display_name) VALUES ($1, $2, $2)', [user, `messaging_user_${index}`]);
      }
      await db.query("INSERT INTO locations (id, name, coordinates) VALUES ($1, 'Đà Lạt', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326))", [location]);
      await db.query("INSERT INTO posts (id, author_id, location_id, content, rating, visited_at) VALUES ($1, $2, $3, 'Bài viết có sẵn', 5, '2026-10-23')", [post, sender, location]);
      await db.query("INSERT INTO journeys (id, user_id, title) VALUES ($1, $2, 'Hành trình có sẵn')", [journey, sender]);
      await db.query('INSERT INTO likes (user_id, post_id) VALUES ($1, $2)', [recipient, post]);
      legacySnapshot = await snapshot();
      await db.query(await readFile(path.join(directory, migration), 'utf8'));
      await db.query('COMMIT');
      schemaCreated = true;
      await db.query(`SET search_path TO "${schema}", public`);
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  });

  beforeEach(async () => { await db.query('BEGIN'); inTransaction = true; });
  afterEach(async () => { if (inTransaction) await db.query('ROLLBACK'); inTransaction = false; });
  afterAll(async () => {
    if (!db) return;
    try {
      if (inTransaction) await db.query('ROLLBACK');
      // Only this suite's generated schema in an explicitly disposable database.
      if (schemaCreated && /^messaging_test_[a-f0-9]{32}$/.test(schema)) {
        await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally { await db.end(); }
  });

  async function rejected(action: () => Promise<unknown>, code: string, constraint?: string) {
    await db.query('SAVEPOINT rejected_write');
    try {
      await expect((async () => { await action(); await db.query('SET CONSTRAINTS ALL IMMEDIATE'); })())
        .rejects.toMatchObject({ code, ...(constraint ? { constraint } : {}) });
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT rejected_write');
      await db.query('RELEASE SAVEPOINT rejected_write');
    }
  }

  // Reference SQL protocols for Feature 2, not a second production write path.
  // The fallback SELECT must be a new statement: a single CTE snapshot can miss
  // the winner after ON CONFLICT waits for a concurrently committed insertion.
  async function direct(a = sender, b = recipient, connection = db): Promise<string> {
    const inserted = await connection.query<{ id: string }>(`INSERT INTO conversations (direct_user_low_id, direct_user_high_id)
      VALUES ($1, $2) ON CONFLICT ON CONSTRAINT conversations_direct_pair_unique DO NOTHING RETURNING id`, [a, b]);
    if (inserted.rows[0]) return inserted.rows[0].id;
    return (await connection.query<{ id: string }>(`SELECT id FROM conversations
      WHERE direct_user_low_id = LEAST($1::uuid, $2::uuid) AND direct_user_high_id = GREATEST($1::uuid, $2::uuid)`, [a, b])).rows[0].id;
  }

  async function message(conversation: string, options: {
    sender?: string; key?: string; content?: string | null; type?: string; resource?: string | null;
  } = {}, connection = db): Promise<Message> {
    const author = options.sender ?? sender;
    const key = options.key ?? randomUUID();
    const type = options.type ?? 'text';
    const content = options.content === undefined ? 'Xin chào Việt Nam 🗺️' : options.content;
    const resource = options.resource ?? null;
    const inserted = await connection.query<Message>(`INSERT INTO messages
      (conversation_id, sender_id, client_message_id, message_type, content, shared_resource_id)
      VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT ON CONSTRAINT messages_sender_client_unique DO NOTHING RETURNING *`,
    [conversation, author, key, type, content, resource]);
    if (inserted.rows[0]) return inserted.rows[0];
    const existing = (await connection.query<Message>('SELECT * FROM messages WHERE sender_id = $1 AND client_message_id = $2', [author, key])).rows[0];
    if (existing.conversation_id !== conversation || existing.message_type !== type || existing.content !== content || existing.shared_resource_id !== resource) {
      throw new Error('Idempotency payload conflict'); // Feature 2 maps this to HTTP 409.
    }
    return existing;
  }

  const unread = async (conversation: string, viewer = recipient, connection = db) => (await connection.query<{ count: number }>(`SELECT count(*)::integer AS count
    FROM messages m JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $2
    WHERE m.conversation_id = $1 AND m.sequence > COALESCE(cp.last_read_sequence, 0)
      AND m.sender_id <> cp.user_id AND m.deleted_at IS NULL`, [conversation, viewer])).rows[0].count;
  const read = async (conversation: string, sequence: string | null, connection = db) => (await connection.query<{
    last_read_sequence: string | null; last_read_at: Date | null;
  }>(`UPDATE conversation_participants SET last_read_sequence = $3, last_read_at = '2099-01-01'
    WHERE conversation_id = $1 AND user_id = $2 RETURNING last_read_sequence, last_read_at`, [conversation, recipient, sequence])).rows[0];

  it('upgrades populated migration 012 without changing posts, profiles, notifications or geometry', async () => {
    expect(await snapshot()).toEqual(legacySnapshot);
    expect((await db.query('SELECT count(*)::integer AS count FROM conversations')).rows[0].count).toBe(0);
  });

  it('canonicalizes A-B/B-A and creates exactly two unique participants atomically', async () => {
    const conversation = await direct();
    expect(await direct(recipient, sender)).toBe(conversation);
    const pair = [...users.slice(0, 2)].sort();
    expect((await db.query('SELECT direct_user_low_id, direct_user_high_id FROM conversations WHERE id = $1', [conversation])).rows[0])
      .toEqual({ direct_user_low_id: pair[0], direct_user_high_id: pair[1] });
    expect((await db.query('SELECT user_id FROM conversation_participants WHERE conversation_id = $1 ORDER BY user_id', [conversation])).rows)
      .toEqual(pair.map((user_id) => ({ user_id })));
    await rejected(() => db.query('INSERT INTO conversations (direct_user_low_id, direct_user_high_id) VALUES ($1, $2)', [recipient, sender]), '23505', 'conversations_direct_pair_unique');
    await rejected(() => db.query('INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2)', [conversation, sender]), '23505');
  });

  it('rejects self chats, missing users and unsupported group conversations', async () => {
    await rejected(() => direct(sender, sender), '23514', 'conversations_direct_pair_order');
    await rejected(() => direct(sender, randomUUID()), '23503');
    await rejected(() => db.query("INSERT INTO conversations (type, direct_user_low_id, direct_user_high_id) VALUES ('group', $1, $2)", [sender, recipient]), '23514');
  });

  it('rejects adding, removing or changing direct participants and the canonical pair', async () => {
    const conversation = await direct();
    await rejected(() => db.query('INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2)', [conversation, outsider]), '23514', 'conversation_participants_direct_pair');
    await rejected(() => db.query('DELETE FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2', [conversation, sender]), '23514', 'conversation_participants_immutable');
    await rejected(() => db.query('UPDATE conversation_participants SET user_id = $3 WHERE conversation_id = $1 AND user_id = $2', [conversation, sender, outsider]), '23514', 'conversation_participants_immutable');
    await rejected(() => db.query('UPDATE conversations SET direct_user_low_id = $2 WHERE id = $1', [conversation, outsider]), '23514', 'conversations_identity_immutable');
  });

  it('enforces sender membership and rejects missing conversations', async () => {
    const conversation = await direct();
    await rejected(() => message(conversation, { sender: outsider }), '23503', 'messages_sender_participant_fk');
    await rejected(() => message(randomUUID()), '23503');
    expect((await db.query('SELECT message_sequence, last_message_id FROM conversations WHERE id = $1', [conversation])).rows[0])
      .toEqual({ message_sequence: '0', last_message_id: null });
  });

  it('supports Unicode text and all three existing resource domains without copied metadata', async () => {
    const conversation = await direct();
    expect((await message(conversation)).content).toBe('Xin chào Việt Nam 🗺️');
    for (const [type, resource, field] of [
      ['shared_post', post, 'shared_post_id'], ['shared_location', location, 'shared_location_id'], ['shared_journey', journey, 'shared_journey_id'],
    ] as const) {
      const shared = await message(conversation, { type, resource, content: null });
      expect(shared[field]).toBe(resource);
      expect(shared.shared_resource_id).toBe(resource);
    }
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  });

  it.each(['', '   ', '\t\r\n', '\u00a0\u2003\u202f\ufeff', 'a'.repeat(4001)])('rejects blank/oversized text (%#)', async (content) => {
    const conversation = await direct();
    await rejected(() => message(conversation, { content }), '23514', 'messages_content_valid');
  });

  it('rejects null text, unsupported types, missing share references and mixed text/share payloads', async () => {
    const conversation = await direct();
    for (const payload of [{ content: null }, { type: 'image' }, { type: 'shared_post', content: null }, { resource: post }]) {
      await rejected(() => message(conversation, payload), '23514');
    }
    expect((await message(conversation, { content: 'a'.repeat(4000) })).content).toHaveLength(4000);
  });

  it.each(['shared_post', 'shared_location', 'shared_journey'])('requires a real resource FK for %s', async (type) => {
    const conversation = await direct();
    await rejected(() => message(conversation, { type, resource: randomUUID(), content: null }), '23503');
  });

  it('assigns server order/timestamps and maintains last-message metadata in the same transaction', async () => {
    const conversation = await direct();
    const first = await message(conversation);
    const next = (await db.query<Message>(`INSERT INTO messages
      (conversation_id, sender_id, client_message_id, message_type, content, sequence, created_at)
      VALUES ($1, $2, $3, 'text', 'Thứ tự từ server', 9999, '2099-01-01') RETURNING *`, [conversation, recipient, randomUUID()])).rows[0];
    expect([first.sequence, next.sequence]).toEqual(['1', '2']);
    expect(next.created_at.getTime()).toBeLessThan(Date.now() + 5000);
    expect((await db.query('SELECT last_message_id, last_message_at, updated_at FROM conversations WHERE id = $1', [conversation])).rows[0])
      .toEqual({ last_message_id: next.id, last_message_at: next.created_at, updated_at: next.created_at });
    const other = await direct(sender, outsider);
    await rejected(() => db.query('UPDATE conversations SET last_message_id = $2, last_message_at = now() WHERE id = $1', [other, next.id]), '23503', 'conversations_last_message_fk');
  });

  it('paginates older/newer messages by sequence with no gaps or duplicates, retaining bigint precision', async () => {
    const conversation = await direct();
    // Sequence is deliberately beyond Number.MAX_SAFE_INTEGER; pg returns strings.
    await db.query("UPDATE conversations SET message_sequence = '9007199254740992' WHERE id = $1", [conversation]);
    const inserted = [];
    for (let i = 0; i < 7; i++) inserted.push(await message(conversation));
    const found: string[] = [];
    let cursor: string | null = null;
    while (true) {
      const rows: Message[] = (await db.query<Message>(`SELECT * FROM messages WHERE conversation_id = $1
        AND ($2::bigint IS NULL OR sequence < $2) ORDER BY sequence DESC LIMIT 2`, [conversation, cursor])).rows;
      if (!rows.length) break;
      found.push(...rows.map((row) => row.id));
      cursor = rows.at(-1)!.sequence;
    }
    expect(found).toEqual(inserted.map((row) => row.id).reverse());
    expect(new Set(found).size).toBe(7);
    expect(inserted[0].sequence).toBe('9007199254740993');
    expect((await db.query('SELECT id FROM messages WHERE conversation_id = $1 AND sequence > $2 ORDER BY sequence', [conversation, inserted[3].sequence])).rows)
      .toEqual(inserted.slice(4).map(({ id }) => ({ id })));
  });

  it('deduplicates sender-scoped keys, replays the original and detects changed payloads', async () => {
    const conversation = await direct();
    const key = randomUUID();
    const first = await message(conversation, { key });
    expect((await message(conversation, { key })).id).toBe(first.id);
    await expect(message(conversation, { key, content: 'Nội dung khác' })).rejects.toThrow('Idempotency payload conflict');
    const other = await direct(sender, outsider);
    await expect(message(other, { key })).rejects.toThrow('Idempotency payload conflict');
    await expect(message(conversation, { key, type: 'shared_post', resource: post })).rejects.toThrow('Idempotency payload conflict');
    const independent = await message(conversation, { key, sender: recipient });
    expect(independent.id).not.toBe(first.id);
    expect((await db.query('SELECT count(*)::integer AS count FROM messages WHERE sender_id = $1 AND client_message_id = $2', [sender, key])).rows[0].count).toBe(1);
    await rejected(() => db.query(`INSERT INTO messages (conversation_id, sender_id, client_message_id, message_type, content)
      VALUES ($1, $2, $3, 'text', 'Duplicate')`, [conversation, sender, key]), '23505', 'messages_sender_client_unique');
  });

  it('tracks each participant separately, excludes own messages and clamps stale read cursors', async () => {
    const conversation = await direct();
    const first = await message(conversation);
    const own = await message(conversation, { sender: recipient });
    const latest = await message(conversation);
    expect(await unread(conversation)).toBe(2);
    expect(await unread(conversation, sender)).toBe(1);
    const state = await read(conversation, latest.sequence);
    expect(state.last_read_at!.getTime()).toBeLessThan(Date.now() + 5000);
    expect(await read(conversation, first.sequence)).toEqual(state);
    expect(await read(conversation, null)).toEqual(state);
    expect(await read(conversation, latest.sequence)).toEqual(state);
    expect(await unread(conversation)).toBe(0);
    expect(await unread(conversation, sender)).toBe(1);
    expect(own.sequence).toBe('2');
    await message(conversation);
    expect(await unread(conversation)).toBe(1);
  });

  it('rejects read targets that do not exist in this conversation', async () => {
    const conversation = await direct();
    await message(conversation);
    const other = await direct(sender, outsider);
    await message(other);
    const onlyInOther = await message(other);
    await rejected(() => read(conversation, onlyInOther.sequence), '23503', 'conversation_participants_read_message_fk');
    await rejected(() => read(conversation, '999'), '23503');
  });

  it('keeps soft-deleted tombstones, retry keys and read cursors while excluding them from unread', async () => {
    const conversation = await direct();
    const key = randomUUID();
    const item = await message(conversation, { key });
    await read(conversation, item.sequence);
    await db.query('UPDATE messages SET deleted_at = now() WHERE id = $1', [item.id]);
    expect(await unread(conversation)).toBe(0);
    expect((await message(conversation, { key })).id).toBe(item.id);
    expect((await read(conversation, item.sequence)).last_read_sequence).toBe(item.sequence);
    await rejected(() => db.query('DELETE FROM messages WHERE id = $1', [item.id]), '23514', 'messages_no_hard_delete');
    await rejected(() => db.query('UPDATE messages SET deleted_at = NULL WHERE id = $1', [item.id]), '23514', 'messages_deletion_monotonic');
    await rejected(() => db.query("UPDATE messages SET content = 'Sửa payload' WHERE id = $1", [item.id]), '23514', 'messages_payload_immutable');
    const unreadItem = await message(conversation);
    expect(await unread(conversation)).toBe(1);
    await db.query('UPDATE messages SET deleted_at = now() WHERE id = $1', [unreadItem.id]);
    expect(await unread(conversation)).toBe(0);
  });

  it.each([
    ['shared_post', 'posts', post, 'shared_post_id'],
    ['shared_location', 'locations', location, 'shared_location_id'],
    ['shared_journey', 'journeys', journey, 'shared_journey_id'],
  ])('preserves %s messages and retry identity when the resource is deleted', async (type, table, resource, field) => {
    const conversation = await direct();
    const key = randomUUID();
    const item = await message(conversation, { type, resource, key, content: null });
    await rejected(() => db.query(`UPDATE messages SET ${field} = NULL WHERE id = $1`, [item.id]), '23514', 'messages_resource_immutable');
    if (table === 'locations') await db.query('DELETE FROM posts WHERE id = $1', [post]);
    await db.query(`DELETE FROM ${table} WHERE id = $1`, [resource]); // table/column from the fixed test cases above.
    const tombstone = (await db.query<Message>('SELECT * FROM messages WHERE id = $1', [item.id])).rows[0];
    expect(tombstone).toMatchObject({ [field]: null, shared_resource_id: resource, sequence: item.sequence });
    expect((await message(conversation, { type, resource, key, content: null })).id).toBe(item.id);
    await rejected(() => message(conversation, { type, resource, content: null }), '23503');
  });

  it('cascades a whole conversation and account deletion without orphaned participants/messages', async () => {
    const conversation = await direct();
    const item = await message(conversation);
    await read(conversation, item.sequence);
    await db.query('DELETE FROM conversations WHERE id = $1', [conversation]);
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    expect((await db.query('SELECT id FROM messages WHERE id = $1', [item.id])).rowCount).toBe(0);
    expect((await db.query('SELECT user_id FROM conversation_participants WHERE conversation_id = $1', [conversation])).rowCount).toBe(0);
    // Restore the schema's normal deferred mode before the next aggregate write.
    // Profile -> conversation -> participants/messages is a circular FK cascade.
    await db.query('SET CONSTRAINTS ALL DEFERRED');
    const recreated = await direct();
    await message(recreated);
    await db.query('DELETE FROM users WHERE id = $1', [recipient]);
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    expect((await db.query('SELECT id FROM conversations WHERE id = $1', [recreated])).rowCount).toBe(0);
  });

  it('rolls back conversation creation, messages, last-message metadata, cursor and key allocation together', async () => {
    const conversation = await direct();
    const first = await message(conversation);
    await db.query('SAVEPOINT business_write');
    const key = randomUUID();
    const aborted = await message(conversation, { key });
    await read(conversation, aborted.sequence);
    const abortedConversation = await direct(sender, outsider);
    await db.query('ROLLBACK TO SAVEPOINT business_write');
    expect((await db.query('SELECT last_message_id, message_sequence FROM conversations WHERE id = $1', [conversation])).rows[0])
      .toEqual({ last_message_id: first.id, message_sequence: first.sequence });
    expect((await db.query('SELECT last_read_sequence FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2', [conversation, recipient])).rows[0].last_read_sequence).toBeNull();
    expect((await db.query('SELECT id FROM messages WHERE id = $1', [aborted.id])).rowCount).toBe(0);
    expect((await db.query('SELECT user_id FROM conversation_participants WHERE conversation_id = $1', [abortedConversation])).rowCount).toBe(0);
    expect((await message(conversation, { key })).sequence).toBe(aborted.sequence);
  });

  async function peers(): Promise<[Client, Client]> {
    const clients = [new Client({ connectionString: databaseUrl }), new Client({ connectionString: databaseUrl })] as [Client, Client];
    for (const connection of clients) {
      await connection.connect();
      await connection.query(`SET search_path TO "${schema}", public`);
      await connection.query("SET statement_timeout TO '6s'");
      await connection.query('BEGIN');
    }
    return clients;
  }

  async function waiting(connection: Client) {
    const pid = (await connection.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    return async () => {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if ((await db.query<{ blocked: boolean }>('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid])).rows[0].blocked) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('Expected a concurrent database write to wait for the row/unique lock');
    };
  }

  async function commitSetup() { await db.query('COMMIT'); inTransaction = false; }
  async function closePeers(clients: Client[], pending?: Promise<unknown>) {
    // Releasing the blocker also lets pending work settle before ending clients.
    await clients[0].query('ROLLBACK');
    if (pending) await Promise.allSettled([pending]);
    await clients[1].query('ROLLBACK');
    await Promise.all(clients.map((connection) => connection.end()));
  }

  it.each([false, true])('resolves concurrent A-B/B-A creation (first transaction rollback: %s)', async (rollback) => {
    const pair = [randomUUID(), randomUUID()];
    for (const user of pair) {
      await db.query('INSERT INTO users (id, email) VALUES ($1, $2)', [user, `${user}@example.test`]);
      await db.query('INSERT INTO profiles (id, username, display_name) VALUES ($1, $2, $2)', [user, `chat_${user.replaceAll('-', '').slice(0, 20)}`]);
    }
    await commitSetup();
    const clients = await peers();
    let pending: Promise<string> | undefined;
    try {
      const isWaiting = await waiting(clients[1]);
      const first = await direct(pair[0], pair[1], clients[0]);
      pending = direct(pair[1], pair[0], clients[1]);
      await isWaiting();
      await clients[0].query(rollback ? 'ROLLBACK' : 'COMMIT');
      const winner = await pending;
      if (rollback) expect(winner).not.toBe(first);
      else expect(winner).toBe(first);
      await clients[1].query('COMMIT');
      expect((await db.query('SELECT count(*)::integer AS count FROM conversation_participants WHERE conversation_id = $1', [winner])).rows[0].count).toBe(2);
    } finally { await closePeers(clients, pending); }
  });

  it('serializes concurrent sends before commit so an observed read cursor cannot skip a late message', async () => {
    const conversation = await direct();
    const unrelated = await direct(sender, outsider);
    await commitSetup();
    const clients = await peers();
    let pending: Promise<Message> | undefined;
    try {
      const isWaiting = await waiting(clients[1]);
      const first = await message(conversation, {}, clients[0]);
      pending = message(conversation, {}, clients[1]);
      await isWaiting();
      // A different conversation is not blocked by this conversation's row lock.
      expect((await message(unrelated)).sequence).toBe('1');
      await clients[0].query('COMMIT');
      const second = await pending;
      expect(BigInt(second.sequence)).toBe(BigInt(first.sequence) + 1n);
      await read(conversation, first.sequence);
      expect(await unread(conversation)).toBe(0);
      await clients[1].query('COMMIT');
      expect(await unread(conversation)).toBe(1);
      expect((await db.query('SELECT last_message_id FROM conversations WHERE id = $1', [conversation])).rows[0].last_message_id).toBe(second.id);
    } finally { await closePeers(clients, pending); }
  });

  it.each([false, true])('handles concurrent retry keys (changed payload: %s)', async (changed) => {
    const conversation = await direct();
    await commitSetup();
    const clients = await peers();
    const key = randomUUID();
    let pending: Promise<Message> | undefined;
    try {
      const isWaiting = await waiting(clients[1]);
      const first = await message(conversation, { key }, clients[0]);
      pending = message(conversation, { key, ...(changed ? { content: 'Payload khác' } : {}) }, clients[1]);
      // Attach the rejection handler before the first transaction can unblock it.
      const result = pending.then((value) => ({ value }), (error: unknown) => ({ error }));
      await isWaiting();
      await clients[0].query('COMMIT');
      if (changed) expect(await result).toMatchObject({ error: new Error('Idempotency payload conflict') });
      else expect(await result).toMatchObject({ value: { id: first.id } });
      await clients[1].query(changed ? 'ROLLBACK' : 'COMMIT');
      expect((await db.query('SELECT count(*)::integer AS count FROM messages WHERE sender_id = $1 AND client_message_id = $2', [sender, key])).rows[0].count).toBe(1);
    } finally { await closePeers(clients, pending); }
  });

  it('allows the waiting sender to create the message when the first same-key transaction rolls back', async () => {
    const conversation = await direct();
    await commitSetup();
    const clients = await peers();
    const key = randomUUID();
    let pending: Promise<Message> | undefined;
    try {
      const isWaiting = await waiting(clients[1]);
      const aborted = await message(conversation, { key }, clients[0]);
      pending = message(conversation, { key }, clients[1]);
      await isWaiting();
      await clients[0].query('ROLLBACK');
      const winner = await pending;
      expect(winner.id).not.toBe(aborted.id);
      expect(winner.sequence).toBe(aborted.sequence);
      await clients[1].query('COMMIT');
      expect((await db.query('SELECT id FROM messages WHERE sender_id = $1 AND client_message_id = $2', [sender, key])).rows).toEqual([{ id: winner.id }]);
    } finally { await closePeers(clients, pending); }
  });

  it('keeps read state monotonic when two devices update the same participant concurrently', async () => {
    const conversation = await direct();
    const first = await message(conversation);
    const latest = await message(conversation);
    await commitSetup();
    const clients = await peers();
    let pending: ReturnType<typeof read> | undefined;
    try {
      const isWaiting = await waiting(clients[1]);
      const newer = await read(conversation, latest.sequence, clients[0]);
      pending = read(conversation, first.sequence, clients[1]);
      await isWaiting();
      await clients[0].query('COMMIT');
      expect(await pending).toEqual(newer);
      await clients[1].query('COMMIT');
      expect(await unread(conversation)).toBe(0);
    } finally { await closePeers(clients, pending); }
  });
});
