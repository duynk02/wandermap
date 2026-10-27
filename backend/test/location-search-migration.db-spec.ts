import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { LocationsService } from '../src/locations/locations.service';
import { DatabaseService } from '../src/database/database.service';

const databaseUrl = process.env.WANDERMAP_TEST_DATABASE_URL;
const disposable = databaseUrl && /(?:^|_)test(?:_|$)/i.test(new URL(databaseUrl).pathname.slice(1));
const describeDatabase = disposable ? describe : describe.skip;

describeDatabase('015 search migration on existing PostgreSQL/PostGIS rows', () => {
  let db: Client;
  const schema = `search_migration_${randomUUID().replaceAll('-', '')}`;
  const names = ['Đà Lạt', 'Đà Nẵng', 'Hà Nội'];
  const ids = names.map(() => randomUUID());
  let before: unknown[];
  beforeAll(async () => {
    db = new Client({ connectionString: databaseUrl });
    await db.connect();
    await db.query('BEGIN');
    await db.query('CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public');
    await db.query('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public');
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`SET LOCAL search_path TO "${schema}",public`);
    const directory = path.resolve(__dirname, '../src/database/migrations');
    for (const file of (await readdir(directory)).filter((name) => /^\d+_.*\.sql$/.test(name) && name < '015_').sort()) await db.query(await readFile(path.join(directory, file), 'utf8'));
    for (const [index, name] of names.entries()) await db.query(`INSERT INTO locations (id,name,coordinates,created_at,updated_at)
      VALUES ($1,$2,ST_SetSRID(ST_MakePoint(108,$3),4326),'2020-01-01','2020-02-01')`, [ids[index], name, 12 + index]);
    before = (await db.query('SELECT id,name,created_at,updated_at,ST_AsEWKT(coordinates) AS point FROM locations ORDER BY id')).rows;
    expect((await db.query('SELECT count(DISTINCT search_text)::int AS n FROM locations')).rows[0].n).toBe(1);
    await db.query(await readFile(path.join(directory, '015_fix_location_search_normalization.sql'), 'utf8'));
  });
  afterAll(async () => { if (db) { try { await db.query('ROLLBACK'); } finally { await db.end(); } } });

  it('normalizes distinct Vietnamese inputs, including đ/Đ and upper case', async () => {
    const result = await db.query("SELECT vn_normalize('ĐÀ LẠT') AS dalat, vn_normalize('Đà Nẵng') AS danang, vn_normalize('Hà Nội') AS hanoi");
    expect(result.rows[0]).toEqual({ dalat: 'da lat', danang: 'da nang', hanoi: 'ha noi' });
    expect((await db.query('SELECT count(DISTINCT search_text)::int AS n FROM locations')).rows[0].n).toBe(3);
  });
  it('backfills generated values without altering identity, timestamps, geometry or the timestamp trigger', async () => {
    expect((await db.query('SELECT id,name,created_at,updated_at,ST_AsEWKT(coordinates) AS point FROM locations ORDER BY id')).rows).toEqual(before);
    expect((await db.query("SELECT tgenabled FROM pg_trigger WHERE tgrelid='locations'::regclass AND tgname='locations_set_updated_at'")).rows[0].tgenabled).toBe('O');
    expect((await db.query('SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND indexname IN ($2,$3)', [schema, 'locations_search_text_idx', 'locations_coordinates_gist_idx'])).rows).toHaveLength(2);
  });
  it('supports accent-insensitive search and trigram ranking through the actual location service', async () => {
    const service = new LocationsService({ query: (sql: string, values: unknown[]) => db.query(sql, values) } as unknown as DatabaseService);
    expect((await service.suggest('da lat'))[0].id).toBe(ids[0]);
    expect((await service.suggest('ĐÀ NẴNG'))[0].id).toBe(ids[1]);
    expect((await service.suggest('da latt'))[0].id).toBe(ids[0]);
  });
});
