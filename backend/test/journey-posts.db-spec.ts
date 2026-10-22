import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client, Pool, PoolClient } from 'pg';
import request from 'supertest';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { DatabaseModule } from '../src/database/database.module';
import { DatabaseService } from '../src/database/database.service';
import { PostsModule } from '../src/posts/posts.module';
import { JourneysModule } from '../src/journeys/journeys.module';
import { CommentsModule } from '../src/comments/comments.module';
import { NotificationsModule } from '../src/notifications/notifications.module';

// This suite commits to exercise real independent connections and locks. Require a disposable DB.
const databaseUrl = process.env.WANDERMAP_TEST_DATABASE_URL;
const disposable = databaseUrl && /(?:^|_)test(?:_|$)/i.test(new URL(databaseUrl).pathname.slice(1));
const describeDatabase = disposable ? describe : describe.skip;

describeDatabase('Journey posts: real HTTP, PostgreSQL/PostGIS, triggers and concurrent retries', () => {
  let app: INestApplication;
  let pool: Pool;
  const owner = randomUUID(), other = randomUUID(), inactive = randomUUID();
  const locations = [randomUUID(), randomUUID(), randomUUID()];
  const legacyPost = randomUUID();
  const schema = `journey_posts_${randomUUID().replaceAll('-', '')}`;
  const secret = 'isolated-journey-post-test-secret-at-least-32-characters';
  const jwt = new JwtService({ secret });
  const token = (id = owner) => `Bearer ${jwt.sign({ sub: id, email: `${id}@example.test` })}`;
  const image = 'https://example.test/preview.webp';
  const http = () => app.getHttpServer();
  const share = (journey: { id: string; revision: number }, extra = {}, actor = owner) => request(http())
    .post('/api/v1/posts/journey').set('Authorization', token(actor))
    .send({ journey_id: journey.id, revision: journey.revision, content: 'Kỷ niệm', preview_image_url: image, ...extra });
  const create = async (extra = {}) => (await request(http()).post('/api/v1/journeys').set('Authorization', token()).send({
    request_id: randomUUID(), title: 'Đà Lạt đến Đà Nẵng', status: 'published', visibility: 'public',
    stops: locations.map((location_id) => ({ location_id })), ...extra,
  }).expect(201)).body;
  const patch = async (journey: { id: string; revision: number }, extra = {}) => (await request(http())
    .patch(`/api/v1/journeys/${journey.id}`).set('Authorization', token()).send({ revision: journey.revision, ...extra }).expect(200)).body;

  beforeAll(async () => {
    const setup = new Client({ connectionString: databaseUrl });
    await setup.connect();
    try {
      await setup.query('BEGIN');
      await setup.query('CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public');
      await setup.query('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public');
      await setup.query(`CREATE SCHEMA "${schema}"`);
      await setup.query(`SET LOCAL search_path TO "${schema}", public`);
      const directory = path.resolve(__dirname, '../src/database/migrations');
      const files = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
      for (const file of files.filter((name) => name < '009_')) await setup.query(await readFile(path.join(directory, file), 'utf8'));
      for (const [id, name, active] of [[owner, 'share_owner', true], [other, 'share_other', true], [inactive, 'share_inactive', false]] as const) {
        await setup.query('INSERT INTO users (id, email, is_active) VALUES ($1, $2, $3)', [id, `${id}@example.test`, active]);
        await setup.query('INSERT INTO profiles (id, username, display_name) VALUES ($1, $2, $2)', [id, name]);
      }
      for (const [index, id] of locations.entries()) {
        await setup.query(`INSERT INTO locations (id, name, country, coordinates) VALUES ($1, $2, 'Việt Nam', ST_SetSRID(ST_MakePoint($3, $4), 4326))`, [id, `Điểm ${index + 1}`, 108 + index, 12 + index]);
        await setup.query('INSERT INTO user_visited_locations (user_id, location_id) VALUES ($1, $2)', [owner, id]);
      }
      await setup.query("INSERT INTO posts (id, author_id, location_id, content, rating, visited_at) VALUES ($1, $2, $3, 'Bài địa điểm trước migration', 4, '2026-01-02')", [legacyPost, owner, locations[0]]);
      for (const file of files.filter((name) => name >= '009_')) await setup.query(await readFile(path.join(directory, file), 'utf8'));
      await setup.query('COMMIT');
    } catch (cause) { await setup.query('ROLLBACK'); throw cause; }
    finally { await setup.end(); }
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 10 });
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ JWT_ACCESS_SECRET: secret })] }),
      DatabaseModule, PostsModule, JourneysModule, CommentsModule, NotificationsModule,
    ] }).overrideProvider(DatabaseService).useValue({
      query: (sql: string, values: unknown[]) => pool.query(sql, values),
      transaction: async <T>(work: (client: PoolClient) => Promise<T>) => {
        const client = await pool.connect();
        try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
        catch (cause) { await client.query('ROLLBACK'); throw cause; }
        finally { client.release(); }
      },
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('migrates existing location posts and preserves old create/location/feed contracts', async () => {
    const { body } = await request(http()).get(`/api/v1/posts/${legacyPost}`).expect(200);
    expect(body).toMatchObject({ post_type: 'location', journey_id: null, rating: 4, location_id: locations[0], content: 'Bài địa điểm trước migration' });
    const created = await request(http()).post('/api/v1/posts').set('Authorization', token()).send({ location_id: locations[0], content: 'Bài bình thường', images: [], rating: 5, visited_at: '2026-02-03' }).expect(201);
    await request(http()).get(`/api/v1/posts/by-location/${locations[0]}`).expect(200).expect(({ body: page }) => expect(page.data.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining([legacyPost, created.body.id])));
  });

  it('requires active authentication, ownership and valid preview/revision DTOs', async () => {
    const journey = await create();
    await request(http()).post('/api/v1/posts/journey').send({}).expect(401);
    await share(journey, {}, inactive).expect(401);
    await share(journey, {}, other).expect(404);
    for (const extra of [{ revision: 0 }, { content: null }, { content: 'x'.repeat(5001) }, { author_id: other }, { journey_id: 'invalid' }, { preview_image_url: 'javascript:alert(1)' }, { preview_image_url: null }]) await share(journey, extra).expect(400);
    expect((await pool.query('SELECT count(*)::int AS n FROM posts WHERE journey_id = $1', [journey.id])).rows[0].n).toBe(0);
  });

  it('blocks private and draft journeys without publishing them or creating any post', async () => {
    for (const values of [{ visibility: 'private' }, { status: 'draft' }]) {
      const journey = await create(values);
      await share(journey).expect(403);
      const current = await request(http()).get(`/api/v1/journeys/${journey.id}`).set('Authorization', token()).expect(200);
      expect(current.body).toMatchObject({ ...values, revision: journey.revision });
      expect((await pool.query('SELECT count(*)::int AS n FROM posts WHERE journey_id = $1', [journey.id])).rows[0].n).toBe(0);
    }
  });

  it('links a real journey, accepts an optional caption, and exposes it in public/profile/following feeds', async () => {
    const journey = await create();
    const { body } = await share(journey, { content: '' }).expect(201);
    expect(body).toMatchObject({ created: true, post: { post_type: 'journey', journey_id: journey.id, content: '', images: [image], location: null, rating: null, visited_at: null, journey: { id: journey.id, stop_count: 3, preview_names: ['Điểm 1', 'Điểm 2', 'Điểm 3'] } } });
    for (const url of ['/api/v1/posts/feed', '/api/v1/posts/by-author/share_owner']) await request(http()).get(url).expect(200).expect(({ body: page }) => expect(page.data.some((p: { id: string }) => p.id === body.post.id)).toBe(true));
    await pool.query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [other, owner]);
    await request(http()).get('/api/v1/posts/following').set('Authorization', token(other)).expect(200).expect(({ body: page }) => expect(page.data.some((p: { id: string }) => p.id === body.post.id)).toBe(true));
    await request(http()).get(`/api/v1/posts/journey/${journey.id}`).set('Authorization', token(other)).expect(200).expect(({ body: found }) => expect(found).toEqual({ post: null }));
  });

  it('serializes concurrent HTTP retries and increments the profile counter exactly once', async () => {
    const journey = await create();
    const before = (await pool.query('SELECT total_posts FROM profiles WHERE id = $1', [owner])).rows[0].total_posts;
    const responses = await Promise.all(Array.from({ length: 6 }, () => share(journey).expect(201)));
    expect(new Set(responses.map((r) => r.body.post.id)).size).toBe(1);
    expect(responses.filter((r) => r.body.created).length).toBe(1);
    expect((await pool.query('SELECT total_posts FROM profiles WHERE id = $1', [owner])).rows[0].total_posts).toBe(before + 1);
    const again = await share(journey, { content: 'Must not overwrite the original' }).expect(201);
    expect(again.body).toMatchObject({ created: false, post: { content: 'Kỷ niệm' } });
  });

  it('rejects a stale preview, reads updated journey data live and retains the original image revision', async () => {
    let journey = await create();
    const stale = { ...journey };
    journey = await patch(journey, { title: 'Hành trình mới' });
    await share(stale).expect(409);
    const shared = (await share(journey).expect(201)).body.post;
    journey = await patch(journey, { title: 'Hành trình đã chỉnh sửa', stops: locations.slice(0, 2).reverse().map((location_id) => ({ location_id })) });
    await request(http()).get(`/api/v1/posts/${shared.id}`).expect(200).expect(({ body }) => expect(body).toMatchObject({ preview_revision: stale.revision + 1, images: [image], journey: { revision: journey.revision, title: journey.title, stop_count: 2, preview_names: ['Điểm 2', 'Điểm 1'] } }));
    await share(stale).expect(201).expect(({ body }) => expect(body).toMatchObject({ created: false, post: { id: shared.id } }));
    await request(http()).patch(`/api/v1/posts/${shared.id}`).set('Authorization', token()).send({ rating: 4 }).expect(400);
  });

  it('reuses Like/Comment/Save and revokes every viewer entry point when the journey becomes private', async () => {
    let journey = await create();
    const post = (await share(journey).expect(201)).body.post;
    for (let n = 0; n < 2; n++) {
      await request(http()).post(`/api/v1/posts/${post.id}/like`).set('Authorization', token(other)).expect(201).expect(({ body }) => expect(body.likes_count).toBe(1));
      await request(http()).post(`/api/v1/posts/${post.id}/save`).set('Authorization', token(other)).expect(201).expect(({ body }) => expect(body.saves_count).toBe(1));
    }
    const comment = (await request(http()).post(`/api/v1/posts/${post.id}/comments`).set('Authorization', token(other)).send({ content: 'Đẹp quá!' }).expect(201)).body.comment;
    await request(http()).get(`/api/v1/posts/${post.id}`).set('Authorization', token(other)).expect(200).expect(({ body }) => expect(body).toMatchObject({ is_liked: true, is_saved: true, likes_count: 1, saves_count: 1, comments_count: 1 }));
    await request(http()).get('/api/v1/notifications').set('Authorization', token()).expect(200).expect(({ body }) => expect(body.data.some((n: { post?: { id: string } }) => n.post?.id === post.id)).toBe(true));
    journey = await patch(journey, { visibility: 'private' });
    for (const url of [`/api/v1/posts/${post.id}`, `/api/v1/posts/${post.id}/comments`, `/api/v1/comments/${comment.id}/replies`, `/api/v1/journeys/${journey.id}`]) {
      await request(http()).get(url).expect(404);
      await request(http()).get(url).set('Authorization', token(other)).expect(404);
    }
    for (const action of ['like', 'save']) {
      await request(http()).post(`/api/v1/posts/${post.id}/${action}`).set('Authorization', token(other)).expect(404);
      await request(http()).delete(`/api/v1/posts/${post.id}/${action}`).set('Authorization', token(other)).expect(404);
    }
    await request(http()).post(`/api/v1/posts/${post.id}/comments`).set('Authorization', token(other)).send({ content: 'Cannot access' }).expect(404);
    await request(http()).post(`/api/v1/comments/${comment.id}/like`).set('Authorization', token(other)).expect(404);
    await request(http()).patch(`/api/v1/comments/${comment.id}`).set('Authorization', token(other)).send({ content: 'Cannot access' }).expect(404);
    for (const url of ['/api/v1/posts/feed', '/api/v1/posts/by-author/share_owner', '/api/v1/posts/following']) {
      await request(http()).get(url).set('Authorization', token(other)).expect(200).expect(({ body }) => expect(body.data.some((p: { id: string }) => p.id === post.id)).toBe(false));
    }
    await request(http()).get(`/api/v1/posts/${post.id}`).set('Authorization', token()).expect(200);
    await share(journey).expect(403);
    journey = await patch(journey, { visibility: 'public' });
    await request(http()).get(`/api/v1/posts/${post.id}`).set('Authorization', token(other)).expect(200).expect(({ body }) => expect(body).toMatchObject({ is_liked: true, is_saved: true, comments_count: 1 }));
  });

  it('hides draft posts and inactive owners, and cascades journey deletion through posts/interactions', async () => {
    let journey = await create();
    const post = (await share(journey).expect(201)).body.post;
    await request(http()).post(`/api/v1/posts/${post.id}/like`).set('Authorization', token(other)).expect(201);
    await request(http()).post(`/api/v1/posts/${post.id}/save`).set('Authorization', token(other)).expect(201);
    await request(http()).post(`/api/v1/posts/${post.id}/comments`).set('Authorization', token(other)).send({ content: 'Kỷ niệm' }).expect(201);
    journey = await patch(journey, { status: 'draft' });
    await request(http()).get(`/api/v1/posts/${post.id}`).expect(404);
    journey = await patch(journey, { status: 'published' });
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [owner]);
    await request(http()).get(`/api/v1/posts/${post.id}`).expect(404);
    await pool.query('UPDATE users SET is_active = true WHERE id = $1', [owner]);
    const before = (await pool.query('SELECT total_posts FROM profiles WHERE id = $1', [owner])).rows[0].total_posts;
    await request(http()).delete(`/api/v1/journeys/${journey.id}`).query({ revision: journey.revision }).set('Authorization', token()).expect(200);
    await request(http()).get(`/api/v1/posts/${post.id}`).set('Authorization', token()).expect(404);
    for (const table of ['posts', 'likes', 'saves', 'comments', 'notifications']) {
      const column = table === 'posts' ? 'id' : 'post_id';
      expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [post.id])).rows[0].n).toBe(0);
    }
    expect((await pool.query('SELECT total_posts FROM profiles WHERE id = $1', [owner])).rows[0].total_posts).toBe(before - 1);
    expect((await pool.query('SELECT post_count FROM locations WHERE id = $1', [locations[0]])).rows[0].post_count).toBe(2);
  });

  it('enforces post shape and owner references in SQL as well as in the API', async () => {
    const journey = await create();
    await expect(pool.query("INSERT INTO posts (author_id, post_type, journey_id, preview_revision, content) VALUES ($1, 'journey', $2, 1, '')", [other, journey.id])).rejects.toMatchObject({ code: '23503' });
    await expect(pool.query("INSERT INTO posts (author_id, content) VALUES ($1, 'Missing location/rating/date')", [owner])).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query("INSERT INTO posts (author_id, post_type, content) VALUES ($1, 'unsupported', 'Invalid type')", [owner])).rejects.toMatchObject({ code: '23514' });
  });
});
