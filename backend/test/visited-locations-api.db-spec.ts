import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client, PoolClient } from 'pg';
import request from 'supertest';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { DatabaseModule } from '../src/database/database.module';
import { DatabaseService } from '../src/database/database.service';
import { UsersModule } from '../src/users/users.module';

const databaseUrl = process.env.WANDERMAP_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('Visited locations HTTP API with real PostgreSQL/PostGIS', () => {
  let db: Client;
  let app: INestApplication;
  let savepoint = false;
  let migratedMark: string;
  const owner = randomUUID();
  const other = randomUUID();
  const inactive = randomUUID();
  const locations = [randomUUID(), randomUUID(), randomUUID()];
  const secret = 'isolated-visited-api-test-secret-at-least-32-characters';
  const jwt = new JwtService({ secret });
  const token = (id = owner) => `Bearer ${jwt.sign({ sub: id, email: `${id}@example.test` })}`;
  const base = '/api/v1/users/me/visited-locations';

  beforeAll(async () => {
    db = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    await db.connect();
    await db.query('BEGIN');
    await db.query('CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public');
    const schema = `visited_api_${randomUUID().replaceAll('-', '')}`;
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`SET LOCAL search_path TO "${schema}", public`);
    const directory = path.resolve(__dirname, '../src/database/migrations');
    const files = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
    const cutover = '008_visited_locations_cutover.sql';
    expect(files).toContain(cutover);
    for (const file of files.filter((name) => name < cutover)) await db.query(await readFile(path.join(directory, file), 'utf8'));
    for (const [id, name, active] of [[owner, 'api_owner', true], [other, 'api_other', true], [inactive, 'api_inactive', false]] as const) {
      await db.query('INSERT INTO users (id, email, is_active) VALUES ($1, $2, $3)', [id, `${id}@example.test`, active]);
      await db.query('INSERT INTO profiles (id, username, display_name) VALUES ($1, $2, $2)', [id, name]);
    }
    for (const [index, id] of locations.entries()) await db.query(`INSERT INTO locations (id, name, country, coordinates)
      VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))`, [id, `Điểm đến ${index}`, index ? 'Nhật Bản' : 'Việt Nam', 106 + index, 10 + index]);
    await db.query("INSERT INTO user_pins (user_id, location_id, status, created_at) VALUES ($1, $2, 'visited', '2020-01-01T00:00:00Z'), ($1, $3, 'wishlist', '2020-02-01T00:00:00Z')", [owner, locations[0], locations[1]]);
    await db.query("INSERT INTO posts (author_id, location_id, content, rating, visited_at) VALUES ($1, $2, 'A post does not imply a visit', 4, '2021-03-04')", [owner, locations[2]]);
    await db.query(await readFile(path.join(directory, cutover), 'utf8'));
    migratedMark = (await db.query<{ id: string }>('SELECT id FROM user_visited_locations WHERE user_id = $1 AND location_id = $2', [owner, locations[0]])).rows[0].id;

    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ JWT_ACCESS_SECRET: secret })] }),
      DatabaseModule, UsersModule,
    ] }).overrideProvider(DatabaseService).useValue({
      query: (sql: string, values: unknown[]) => db.query(sql, values),
      // Real SQL, isolated by nested transaction savepoints inside this test schema.
      transaction: async <T>(work: (client: PoolClient) => Promise<T>) => {
        await db.query('SAVEPOINT api_mutation');
        try {
          const result = await work(db as unknown as PoolClient);
          await db.query('SET CONSTRAINTS ALL IMMEDIATE');
          await db.query('RELEASE SAVEPOINT api_mutation');
          return result;
        } catch (error) {
          await db.query('ROLLBACK TO SAVEPOINT api_mutation');
          await db.query('RELEASE SAVEPOINT api_mutation');
          throw error;
        }
      },
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  beforeEach(async () => { await db.query('SAVEPOINT api_test'); savepoint = true; });
  afterEach(async () => {
    if (!savepoint) return;
    await db.query('ROLLBACK TO SAVEPOINT api_test');
    await db.query('RELEASE SAVEPOINT api_test');
    savepoint = false;
  });
  afterAll(async () => {
    await app?.close();
    if (db) { try { await db.query('ROLLBACK'); } finally { await db.end(); } }
  });

  const mark = (locationId: string = locations[1], values: object = {}) => request(app.getHttpServer()).post(base).set('Authorization', token()).send({ location_id: locationId, ...values });
  const addVisit = (id: string, date: string, note?: string) => request(app.getHttpServer()).post(`${base}/${id}/visits`).set('Authorization', token()).send({ visited_at: date, note });

  it('backfills only visited pins as private, retaining timestamps without inventing dates or importing posts', async () => {
    const response = await request(app.getHttpServer()).get(base).set('Authorization', token()).expect(200);
    expect(response.body).toMatchObject({ count: 1, hasMore: false });
    expect(response.body.data[0]).toMatchObject({ id: migratedMark, visibility: 'private', note: null, visit_count: 0, last_visited_at: null, location: { coordinates: { lng: 106, lat: 10 } } });
    // PostgreSQL json_agg emits an ISO offset, while pg's Date serializer emits Z.
    expect(new Date(response.body.data[0].created_at).toISOString()).toBe('2020-01-01T00:00:00.000Z');
    expect((await db.query('SELECT count(*)::integer AS count FROM user_pins')).rows[0].count).toBe(2);
    expect((await db.query('SELECT count(*)::integer AS count FROM posts')).rows[0].count).toBe(1);
  });

  it('requires a valid active JWT for all private reads and writes', async () => {
    await request(app.getHttpServer()).get(base).expect(401);
    await request(app.getHttpServer()).post(base).send({ location_id: locations[1] }).expect(401);
    await request(app.getHttpServer()).patch(`${base}/${migratedMark}`).send({ note: 'forged' }).expect(401);
    await request(app.getHttpServer()).delete(`${base}/${migratedMark}`).expect(401);
    await request(app.getHttpServer()).post(`${base}/${migratedMark}/visits`).send({ visited_at: '2026-01-01' }).expect(401);
    await request(app.getHttpServer()).get(base).set('Authorization', 'Bearer invalid').expect(401);
    await request(app.getHttpServer()).get(base).set('Authorization', token(inactive)).expect(401);
  });

  it('rejects unknown owner fields, invalid dates, visibility, note lengths and malformed pagination', async () => {
    for (const body of [
      { user_id: other }, { visited_at: '2026-02-30' }, { visited_at: '2026-01-02T10:00:00Z' },
      { visited_at: '0000-01-01' }, { visibility: null }, { visibility: 'followers' }, { note: 'x'.repeat(1001) },
    ]) await mark(locations[1], body).expect(400);
    await mark('invalid').expect(400);
    await request(app.getHttpServer()).get(base).set('Authorization', token()).query({ page: 0 }).expect(400);
    await request(app.getHttpServer()).get(base).set('Authorization', token()).query({ pageSize: 51 }).expect(400);
    await request(app.getHttpServer()).get(base).set('Authorization', token()).query({ location_id: 'invalid' }).expect(400);
    await request(app.getHttpServer()).get(base).set('Authorization', token()).query({ user_id: other }).expect(400);
    await request(app.getHttpServer()).patch(`${base}/${migratedMark}`).set('Authorization', token()).send({}).expect(400);
    await request(app.getHttpServer()).post(`${base}/${migratedMark}/visits`).set('Authorization', token()).send({ visited_at: null }).expect(400);
    await mark(randomUUID()).expect(404);
  });

  it('creates a dated mark atomically and replays identical requests without duplicate data', async () => {
    const body = { visited_at: '2024-02-29', note: '  Kỷ niệm đẹp  ', visibility: 'private' };
    const first = await mark(locations[1], body).expect(201);
    const second = await mark(locations[1], body).expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body).toMatchObject({ note: 'Kỷ niệm đẹp', visibility: 'private', visit_count: 1, last_visited_at: '2024-02-29' });
    await mark(locations[1], { ...body, note: 'different' }).expect(409);
    const undated = await mark(locations[2], { visited_at: null }).expect(201);
    expect(undated.body).toMatchObject({ visit_count: 0, last_visited_at: null, visibility: 'private' });
  });

  it('returns 404 for another owner even when IDs and visit IDs are known', async () => {
    const visit = await addVisit(migratedMark, '2026-01-02').expect(201);
    const outsider = token(other);
    await request(app.getHttpServer()).get(`${base}/${migratedMark}`).set('Authorization', outsider).expect(404);
    await request(app.getHttpServer()).patch(`${base}/${migratedMark}`).set('Authorization', outsider).send({ visibility: 'public' }).expect(404);
    await request(app.getHttpServer()).delete(`${base}/${migratedMark}`).set('Authorization', outsider).expect(404);
    await request(app.getHttpServer()).get(`${base}/${migratedMark}/visits`).set('Authorization', outsider).expect(404);
    await request(app.getHttpServer()).post(`${base}/${migratedMark}/visits`).set('Authorization', outsider).send({ visited_at: '2026-02-02' }).expect(404);
    await request(app.getHttpServer()).patch(`${base}/${migratedMark}/visits/${visit.body.id}`).set('Authorization', outsider).send({ note: 'forged' }).expect(404);
    await request(app.getHttpServer()).delete(`${base}/${migratedMark}/visits/${visit.body.id}`).set('Authorization', outsider).expect(404);
  });

  it('filters private locations and counts for anonymous/other viewers, but allows the owner', async () => {
    await request(app.getHttpServer()).get('/api/v1/users/api_owner/visited-locations').expect(200).expect(({ body }) => expect(body).toMatchObject({ count: 0, data: [] }));
    await mark(locations[1], { visibility: 'public', note: 'Chia sẻ' }).expect(201);
    const publicList = await request(app.getHttpServer()).get('/api/v1/users/API_OWNER/visited-locations').query({ pageSize: 1 }).expect(200);
    expect(publicList.body).toMatchObject({ count: 1, hasMore: false, data: [{ visibility: 'public', note: 'Chia sẻ', location_id: locations[1] }] });
    expect(JSON.stringify(publicList.body)).not.toContain(migratedMark);
    await request(app.getHttpServer()).get('/api/v1/users/api_owner/visited-locations').set('Authorization', token(other)).query({ page: 2 }).expect(200).expect(({ body }) => expect(body).toMatchObject({ count: 1, data: [] }));
    await request(app.getHttpServer()).get('/api/v1/users/api_owner/visited-locations').set('Authorization', token()).expect(200).expect(({ body }) => expect(body.count).toBe(2));
    await request(app.getHttpServer()).get('/api/v1/users/api_inactive/visited-locations').expect(404);
    await request(app.getHttpServer()).get('/api/v1/users/missing/visited-locations').expect(404);
  });

  it('changes visibility immediately and clears notes without affecting posts', async () => {
    await request(app.getHttpServer()).patch(`${base}/${migratedMark}`).set('Authorization', token()).send({ visibility: 'public', note: 'Hello' }).expect(200);
    await request(app.getHttpServer()).get('/api/v1/users/api_owner/visited-locations').expect(200).expect(({ body }) => expect(body.count).toBe(1));
    await request(app.getHttpServer()).patch(`${base}/${migratedMark}`).set('Authorization', token()).send({ visibility: 'private', note: null }).expect(200).expect(({ body }) => expect(body.note).toBeNull());
    await request(app.getHttpServer()).get('/api/v1/users/api_owner/visited-locations').expect(200).expect(({ body }) => expect(body.count).toBe(0));
    expect((await db.query('SELECT count(*)::integer AS count FROM posts')).rows[0].count).toBe(1);
  });

  it('records repeat visits with date idempotency, conflict detection and accurate unique counts', async () => {
    const first = await addVisit(migratedMark, '2026-01-02', 'A').expect(201);
    const replay = await addVisit(migratedMark, '2026-01-02', 'A').expect(201);
    expect(replay.body.id).toBe(first.body.id);
    await addVisit(migratedMark, '2026-01-02', 'B').expect(409);
    await addVisit(migratedMark, '2026-02-03', 'B').expect(201);
    const history = await request(app.getHttpServer()).get(`${base}/${migratedMark}/visits`).set('Authorization', token()).query({ pageSize: 1 }).expect(200);
    expect(history.body).toMatchObject({ count: 2, hasMore: true, data: [{ visited_at: '2026-02-03' }] });
    await request(app.getHttpServer()).get(base).set('Authorization', token()).query({ location_id: locations[0] }).expect(200).expect(({ body }) => expect(body).toMatchObject({ count: 1, data: [{ visit_count: 2 }] }));
  });

  it('updates/deletes a visit only within its own mark and rolls back date conflicts', async () => {
    const first = await addVisit(migratedMark, '2026-01-02', 'A').expect(201);
    const second = await addVisit(migratedMark, '2026-02-03', 'B').expect(201);
    const anotherMark = await mark().expect(201);
    await request(app.getHttpServer()).patch(`${base}/${anotherMark.body.id}/visits/${first.body.id}`).set('Authorization', token()).send({ note: 'forged' }).expect(404);
    await request(app.getHttpServer()).patch(`${base}/${migratedMark}/visits/${second.body.id}`).set('Authorization', token()).send({ visited_at: '2026-01-02', note: 'lost?' }).expect(409);
    await request(app.getHttpServer()).get(`${base}/${migratedMark}/visits`).set('Authorization', token()).expect(200).expect(({ body }) => expect(body.data[0]).toMatchObject({ visited_at: '2026-02-03', note: 'B' }));
    await request(app.getHttpServer()).patch(`${base}/${migratedMark}/visits/${second.body.id}`).set('Authorization', token()).send({ visited_at: '2026-03-04', note: null }).expect(200).expect(({ body }) => expect(body).toMatchObject({ visited_at: '2026-03-04', note: null }));
    await request(app.getHttpServer()).delete(`${base}/${migratedMark}/visits/${first.body.id}`).set('Authorization', token()).expect(200);
    await request(app.getHttpServer()).get(`${base}/${migratedMark}`).set('Authorization', token()).expect(200).expect(({ body }) => expect(body.visit_count).toBe(1));
  });

  it('preserves wishlist independently and keeps legacy pins responses coherent', async () => {
    const created = await mark().expect(201);
    await addVisit(created.body.id, '2026-01-02').expect(201);
    await request(app.getHttpServer()).put(`/api/v1/users/me/pins/${locations[1]}`).set('Authorization', token()).send({ status: 'wishlist' }).expect(200);
    await request(app.getHttpServer()).get('/api/v1/users/me/pins').set('Authorization', token()).expect(200).expect(({ body }) => {
      expect(body.filter((pin: { id: string }) => pin.id === locations[1])).toHaveLength(1);
      expect(body.find((pin: { id: string }) => pin.id === locations[1]).status).toBe('visited');
    });
    await request(app.getHttpServer()).delete(`${base}/${created.body.id}`).set('Authorization', token()).expect(200);
    await request(app.getHttpServer()).get('/api/v1/users/me/pins').set('Authorization', token()).query({ status: 'wishlist' }).expect(200).expect(({ body }) => expect(body).toEqual([expect.objectContaining({ id: locations[1], status: 'wishlist' })]));
    expect((await db.query('SELECT count(*)::integer AS count FROM user_location_visits WHERE visited_location_id = $1', [created.body.id])).rows[0].count).toBe(0);
  });

  it('routes legacy visited PUT/DELETE through canonical marks without creating duplicate visits', async () => {
    for (let index = 0; index < 2; index++) await request(app.getHttpServer()).put(`/api/v1/users/me/pins/${locations[2]}`).set('Authorization', token()).send({ status: 'visited' }).expect(200);
    await request(app.getHttpServer()).get(base).set('Authorization', token()).query({ location_id: locations[2] }).expect(200).expect(({ body }) => expect(body).toMatchObject({ count: 1, data: [{ visit_count: 0 }] }));
    await request(app.getHttpServer()).delete(`/api/v1/users/me/pins/${locations[2]}`).set('Authorization', token()).expect(200).expect(({ body }) => expect(body.removed).toBe(true));
    await request(app.getHttpServer()).delete(`/api/v1/users/me/pins/${locations[2]}`).set('Authorization', token()).expect(200).expect(({ body }) => expect(body.removed).toBe(false));
    await request(app.getHttpServer()).get(base).set('Authorization', token()).query({ location_id: locations[2] }).expect(200).expect(({ body }) => expect(body.count).toBe(0));
  });

  it('computes profile counters from visible unique marks instead of posts or repeated visits', async () => {
    await mark(locations[1], { visibility: 'public', visited_at: '2026-01-02' }).expect(201);
    await addVisit(migratedMark, '2026-01-02').expect(201);
    await addVisit(migratedMark, '2026-02-02').expect(201);
    await request(app.getHttpServer()).get('/api/v1/users/me').set('Authorization', token()).expect(200).expect(({ body }) => expect(body).toMatchObject({ visited_location_count: 2, country_count: 2, total_posts: 1 }));
    await request(app.getHttpServer()).get('/api/v1/users/api_owner').expect(200).expect(({ body }) => expect(body).toMatchObject({ visited_location_count: 1, country_count: 1, total_posts: 1 }));
    await request(app.getHttpServer()).get('/api/v1/users/api_owner').set('Authorization', token(other)).expect(200).expect(({ body }) => expect(body.visited_location_count).toBe(1));
  });
});
