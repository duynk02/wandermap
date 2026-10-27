import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, Pool, PoolClient } from 'pg';
import request from 'supertest';
import sharp from 'sharp';
import { DatabaseModule } from '../src/database/database.module';
import { DatabaseService } from '../src/database/database.service';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { UploadsModule } from '../src/uploads/uploads.module';
import { PostsModule } from '../src/posts/posts.module';

// No dotenv and no fallback to application DATABASE_URL. Only an explicitly named test DB.
const databaseUrl = process.env.WANDERMAP_TEST_DATABASE_URL;
const disposable = databaseUrl && /(?:^|_)test(?:_|$)/i.test(new URL(databaseUrl).pathname.slice(1));
const describeDatabase = disposable ? describe : describe.skip;

describeDatabase('managed media: real HTTP, PostGIS, ownership and visibility', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let directory: string;
  let input: Buffer;
  const schema = `media_security_${randomUUID().replaceAll('-', '')}`;
  const owner = randomUUID(), follower = randomUUID(), outsider = randomUUID();
  const locations = [randomUUID(), randomUUID()];
  const secret = 'isolated-media-test-secret-at-least-32-characters';
  const jwt = new JwtService({ secret });
  const token = (viewer: string = owner) => `Bearer ${jwt.sign({ sub: viewer, email: `${viewer}@example.test` }, { expiresIn: 300 })}`;
  const http = () => app.getHttpServer();
  const upload = async (viewer = owner) => (await request(http()).post('/api/v1/uploads/images').set('Authorization', token(viewer)).attach('file', input, 'photo.jpg').expect(201)).body as { url: string; bytes: number };
  const mediaPath = (url: string) => new URL(url).pathname;
  const read = (url: string, viewer?: string) => {
    const operation = request(http()).get(mediaPath(url));
    return viewer ? operation.set('Authorization', token(viewer)) : operation;
  };
  const post = async (url: string, visibility = 'private', viewer = owner) => (await request(http()).post('/api/v1/posts').set('Authorization', token(viewer))
    .send({ location_id: locations[0], content: 'Ảnh hành trình riêng tư', images: [url], rating: 5, visited_at: '2026-01-01', visibility })).body;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'wandermap-private-media-'));
    input = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#22c55e' } }).jpeg().toBuffer();
    const setup = new Client({ connectionString: databaseUrl });
    await setup.connect();
    try {
      await setup.query('BEGIN');
      await setup.query('CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public');
      await setup.query('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public');
      await setup.query(`CREATE SCHEMA "${schema}"`);
      await setup.query(`SET LOCAL search_path TO "${schema}", public`);
      const migrations = path.resolve(__dirname, '../src/database/migrations');
      for (const file of (await readdir(migrations)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort()) await setup.query(await readFile(path.join(migrations, file), 'utf8'));
      for (const [index, id] of [owner, follower, outsider].entries()) {
        await setup.query('INSERT INTO users (id, email) VALUES ($1, $2)', [id, `${id}@example.test`]);
        await setup.query('INSERT INTO profiles (id, username, display_name) VALUES ($1, $2, $2)', [id, `media_user_${index}`]);
      }
      await setup.query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)', [follower, owner]);
      for (const [index, id] of locations.entries()) await setup.query(`INSERT INTO locations (id, name, coordinates) VALUES ($1, $2, ST_SetSRID(ST_MakePoint(108, $3),4326))`, [id, `Media ${index}`, 12 + index]);
      await setup.query('COMMIT');
    } catch (error) { await setup.query('ROLLBACK'); throw error; }
    finally { await setup.end(); }
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 5 });
    const db = {
      query: (sql: string, values: unknown[]) => pool.query(sql, values),
      transaction: async <T>(work: (client: PoolClient) => Promise<T>) => {
        const client = await pool.connect();
        try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      },
    };
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({
      isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true,
      load: [() => ({ JWT_ACCESS_SECRET: secret, STORAGE_PROVIDER: 'local', UPLOAD_DIR: directory, PUBLIC_API_URL: 'https://api.example.test/api/v1' })],
    }), DatabaseModule, UploadsModule, PostsModule] }).overrideProvider(DatabaseService).useValue(db).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    // The only legacy route retained in development must not expose managed files.
    app.useStaticAssets(directory, { prefix: '/uploads', dotfiles: 'deny', index: false });
    await app.init();
  });
  afterAll(async () => {
    await app?.close(); await pool?.end();
    if (directory?.startsWith(path.join(tmpdir(), 'wandermap-private-media-'))) await rm(directory, { recursive: true, force: true });
  });

  it('requires upload auth and permits only the owner to preview an unattached asset', async () => {
    await request(http()).post('/api/v1/uploads/images').attach('file', input, 'photo.jpg').expect(401);
    const asset = await upload();
    expect(Object.keys(asset).sort()).toEqual(['bytes', 'height', 'url', 'width']);
    await read(asset.url).expect(404).expect('Cache-Control', /no-store/);
    await read(asset.url, outsider).expect(404);
    const response = await read(asset.url, owner).expect(200).expect('Content-Type', /image\/webp/).expect('Cache-Control', /no-store/);
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.length).toBe(asset.bytes);
    expect(response.headers.etag).toBeUndefined();
    const id = asset.url.split('/').at(-1);
    await request(http()).get(`/uploads/.private/${id}.webp`).expect(404);
  });

  it('enforces private/public/followers and revokes URL access immediately after visibility changes', async () => {
    const asset = await upload();
    const created = await post(asset.url);
    expect(created.id).toBeDefined();
    await read(asset.url, owner).expect(200);
    await read(asset.url, follower).expect(404);
    await read(asset.url).expect(404);
    await request(http()).patch(`/api/v1/posts/${created.id}`).set('Authorization', token()).send({ visibility: 'public' }).expect(200);
    await read(asset.url).expect(200).expect('CDN-Cache-Control', 'no-store');
    await request(http()).patch(`/api/v1/posts/${created.id}`).set('Authorization', token()).send({ visibility: 'followers' }).expect(200);
    await read(asset.url).expect(404);
    await read(asset.url, outsider).expect(404);
    await read(asset.url, follower).expect(200);
    await request(http()).patch(`/api/v1/posts/${created.id}`).set('Authorization', token()).send({ visibility: 'private' }).expect(200);
    await read(asset.url, follower).expect(404);
  });

  it('prevents another owner from publishing a stolen managed URL through a Post, avatar or Journey', async () => {
    const asset = await upload();
    await request(http()).post('/api/v1/posts').set('Authorization', token(outsider)).send({ location_id: locations[0], content: 'Stolen URL', images: [asset.url], rating: 4, visited_at: '2026-01-01' }).expect(400);
    await expect(pool.query('UPDATE profiles SET avatar_url = $1 WHERE id = $2', [asset.url, outsider])).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query('INSERT INTO journeys (user_id, title, cover_image_url) VALUES ($1, $2, $3)', [outsider, 'Stolen cover', asset.url])).rejects.toMatchObject({ code: '23514' });
    await read(asset.url).expect(404);
  });

  it('authorizes Journey cover bytes by current publication and visibility, independent of knowing the URL', async () => {
    const asset = await upload();
    const journey = (await pool.query('INSERT INTO journeys (user_id, title, cover_image_url) VALUES ($1,$2,$3) RETURNING id', [owner, 'Hành trình riêng', asset.url])).rows[0];
    await read(asset.url).expect(404);
    await read(asset.url, outsider).expect(404);
    await read(asset.url, owner).expect(200);
    for (const [index, location] of locations.entries()) await pool.query('INSERT INTO journey_stops (journey_id,user_id,location_id,stop_order,location_name_snapshot) VALUES ($1,$2,$3,$4,$5)', [journey.id, owner, location, index + 1, `Điểm ${index}`]);
    await pool.query("UPDATE journeys SET visibility='public', status='published' WHERE id=$1", [journey.id]);
    await read(asset.url).expect(200);
    await pool.query("UPDATE journeys SET visibility='private' WHERE id=$1", [journey.id]);
    await read(asset.url).expect(404).expect('Vercel-CDN-Cache-Control', 'no-store');
    await pool.query('UPDATE profiles SET avatar_url=$1 WHERE id=$2', [asset.url, owner]);
    await read(asset.url).expect(200);
    await pool.query('UPDATE profiles SET avatar_url=NULL WHERE id=$1', [owner]);
    await read(asset.url).expect(404);
  });

  it('rejects SVG and oversize multipart uploads, and never discloses media to an expired JWT', async () => {
    await request(http()).post('/api/v1/uploads/images').set('Authorization', token()).attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image.svg').expect(400);
    await request(http()).post('/api/v1/uploads/images').set('Authorization', token()).attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), 'oversize.png').expect(413);
    const asset = await upload();
    const expired = jwt.sign({ sub: owner, email: 'owner@example.test' }, { expiresIn: -1 });
    await request(http()).get(mediaPath(asset.url)).set('Authorization', `Bearer ${expired}`).expect(401).expect('Cache-Control', /no-store/);
    await pool.query('UPDATE users SET is_active=false WHERE id=$1', [owner]);
    await read(asset.url).expect(404);
    await pool.query('UPDATE users SET is_active=true WHERE id=$1', [owner]);
  });
});
