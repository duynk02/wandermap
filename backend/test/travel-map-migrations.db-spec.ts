import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

// Deliberately do not load .env or fall back to the application's DATABASE_URL.
// Everything (including schema/fixtures) is rolled back; use a disposable PostGIS DB.
const databaseUrl = process.env.WANDERMAP_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('Phase 2 migrations on PostgreSQL/PostGIS', () => {
  let db: Client;
  let hasSavepoint = false;
  const user = randomUUID();
  const otherUser = randomUUID();
  const locations = [randomUUID(), randomUUID(), randomUUID()];
  const oldPost = randomUUID();
  const schema = `travel_map_test_${randomUUID().replaceAll('-', '')}`;

  beforeAll(async () => {
    db = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    await db.connect();
    await db.query('BEGIN');
    // Migration 002 explicitly calls public.unaccent. Match that prerequisite
    // before changing search_path; a missing extension is also rolled back.
    await db.query('CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public');
    // Identifier is generated internally, never from configuration/user input.
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`SET LOCAL search_path TO "${schema}", public`);
    const directory = path.resolve(__dirname, '../src/database/migrations');
    const files = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
    const foundation = '007_travel_map_journeys.sql';
    expect(files).toContain(foundation);
    for (const file of files.filter((name) => name < foundation)) {
      await db.query(await readFile(path.join(directory, file), 'utf8'));
    }
    await db.query('INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)', [user, `${user}@example.test`, otherUser, `${otherUser}@example.test`]);
    await db.query('INSERT INTO profiles (id, username, display_name) VALUES ($1, $2, $2), ($3, $4, $4)', [user, 'traveler', otherUser, 'other_traveler']);
    for (const [index, id] of locations.entries()) {
      await db.query('INSERT INTO locations (id, name, coordinates, country) VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5)',
        [id, `Địa điểm ${index + 1}`, 106 + index, 10 + index, 'Việt Nam']);
    }
    await db.query("INSERT INTO user_pins (user_id, location_id, status) VALUES ($1, $2, 'visited'), ($1, $3, 'wishlist')", [user, locations[0], locations[1]]);
    await db.query("INSERT INTO posts (id, author_id, location_id, content, rating, visited_at) VALUES ($1, $2, $3, 'Bài đăng cũ', 5, '2026-01-02')", [oldPost, user, locations[0]]);
    await db.query(await readFile(path.join(directory, foundation), 'utf8'));
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    await db.query('SET CONSTRAINTS ALL DEFERRED');
  });

  beforeEach(async () => {
    await db.query('SAVEPOINT test_case');
    hasSavepoint = true;
  });
  afterEach(async () => {
    if (!hasSavepoint) return;
    await db.query('ROLLBACK TO SAVEPOINT test_case');
    await db.query('RELEASE SAVEPOINT test_case');
    hasSavepoint = false;
  });
  afterAll(async () => {
    if (db) {
      try { await db.query('ROLLBACK'); } finally { await db.end(); }
    }
  });

  async function mark(locationId = locations[0], owner = user) {
    const result = await db.query<{ id: string }>('INSERT INTO user_visited_locations (user_id, location_id) VALUES ($1, $2) RETURNING id', [owner, locationId]);
    return result.rows[0].id;
  }

  async function visit(markId: string, date = '2026-01-02', owner = user, locationId = locations[0]) {
    const result = await db.query<{ id: string }>(`INSERT INTO user_location_visits (visited_location_id, user_id, location_id, visited_at)
      VALUES ($1, $2, $3, $4) RETURNING id`, [markId, owner, locationId, date]);
    return result.rows[0].id;
  }

  async function journey() {
    const result = await db.query<{ id: string }>("INSERT INTO journeys (user_id, title) VALUES ($1, 'Hành trình của tôi') RETURNING id", [user]);
    return result.rows[0].id;
  }

  async function stop(journeyId: string, order: number, locationId = locations[0], visitId: string | null = null, owner = user) {
    await db.query(`INSERT INTO journey_stops (journey_id, user_id, location_id, visit_id, stop_order, location_name_snapshot, visited_at_snapshot)
      VALUES ($1, $2, $3, $4, $5, 'Tên địa điểm đã lưu', '2026-01-02')`, [journeyId, owner, locationId, visitId, order]);
  }

  async function rejected(action: () => Promise<unknown>, code: string, constraint?: string) {
    await db.query('SAVEPOINT rejected_write');
    try {
      await expect((async () => {
        await action();
        await db.query('SET CONSTRAINTS ALL IMMEDIATE');
      })()).rejects.toMatchObject({ code, ...(constraint ? { constraint } : {}) });
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT rejected_write');
      await db.query('RELEASE SAVEPOINT rejected_write');
    }
  }

  it('preserves existing pins, posts, geometry and counters without inferring visits', async () => {
    const pins = await db.query('SELECT status FROM user_pins WHERE user_id = $1 ORDER BY status', [user]);
    expect(pins.rows).toEqual([{ status: 'visited' }, { status: 'wishlist' }]);
    const post = await db.query('SELECT content, rating, visited_at::text FROM posts WHERE id = $1', [oldPost]);
    expect(post.rows[0]).toEqual({ content: 'Bài đăng cũ', rating: 5, visited_at: '2026-01-02' });
    const profile = await db.query('SELECT country_count, total_posts FROM profiles WHERE id = $1', [user]);
    expect(profile.rows[0]).toEqual({ country_count: 1, total_posts: 1 });
    const geometry = await db.query('SELECT ST_X(coordinates) AS lng, ST_Y(coordinates) AS lat, ST_SRID(coordinates) AS srid FROM locations WHERE id = $1', [locations[0]]);
    expect(geometry.rows[0]).toEqual({ lng: 106, lat: 10, srid: 4326 });
    expect((await db.query('SELECT count(*)::integer AS count FROM user_visited_locations')).rows[0].count).toBe(0);
    // Existing write paths continue to work after the additive migration.
    await db.query("UPDATE user_pins SET status = 'visited' WHERE user_id = $1 AND location_id = $2", [user, locations[1]]);
    expect((await db.query('SELECT country_count FROM profiles WHERE id = $1', [user])).rows[0].country_count).toBe(1);
  });

  it('supports an undated private mark without inventing a visit', async () => {
    const id = await mark();
    expect((await db.query('SELECT visibility FROM user_visited_locations WHERE id = $1', [id])).rows[0].visibility).toBe('private');
    expect((await db.query('SELECT count(*)::integer AS count FROM user_location_visits')).rows[0].count).toBe(0);
  });

  it('rejects duplicate marks and missing users/locations', async () => {
    await mark();
    await rejected(() => mark(), '23505', 'user_visited_locations_user_location_unique');
    await rejected(() => mark(randomUUID()), '23503');
    await rejected(() => mark(locations[1], randomUUID()), '23503');
  });

  it('records repeat visits while counting a single unique location', async () => {
    const id = await mark();
    await visit(id);
    await visit(id, '2026-02-03');
    const result = await db.query('SELECT count(DISTINCT location_id)::integer AS locations, count(*)::integer AS visits FROM user_location_visits WHERE user_id = $1', [user]);
    expect(result.rows[0]).toEqual({ locations: 1, visits: 2 });
    await rejected(() => visit(id), '23505', 'user_location_visits_mark_date_unique');
    await rejected(() => visit(id, 'infinity'), '23514');
    await rejected(() => db.query('INSERT INTO user_location_visits (visited_location_id, user_id, location_id) VALUES ($1, $2, $3)', [id, user, locations[0]]), '23502');
  });

  it('rejects visits attached to a different owner or location', async () => {
    const id = await mark();
    await rejected(() => visit(id, '2026-01-02', otherUser), '23503', 'user_location_visits_mark_fk');
    await rejected(() => visit(id, '2026-01-02', user, locations[1]), '23503', 'user_location_visits_mark_fk');
  });

  it('enforces visibility, text limits and journey configuration shape', async () => {
    const id = await mark();
    const journeyId = await journey();
    await rejected(() => db.query("UPDATE user_visited_locations SET visibility = 'followers' WHERE id = $1", [id]), '23514');
    await rejected(() => db.query('UPDATE user_visited_locations SET note = $2 WHERE id = $1', [id, 'x'.repeat(1001)]), '23514');
    for (const update of ["title = ' '", "status = 'invalid'", "visibility = 'followers'", "style_config = '[]'::jsonb", 'revision = 0']) {
      await rejected(() => db.query(`UPDATE journeys SET ${update} WHERE id = $1`, [journeyId]), '23514');
    }
  });

  it('defaults a journey to private draft with existing map style and versioned config', async () => {
    const id = await journey();
    const row = (await db.query('SELECT status, visibility, revision, style_config FROM journeys WHERE id = $1', [id])).rows[0];
    expect(row).toMatchObject({ status: 'draft', visibility: 'private', revision: 1, style_config: { version: 1, map_style: 'outdoors-v12' } });
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  });

  it('rejects publishing without two stops, including at transaction end', async () => {
    const id = await journey();
    await rejected(() => db.query("UPDATE journeys SET status = 'published' WHERE id = $1", [id]), '23514', 'journeys_published_min_stops');
    await stop(id, 1);
    await rejected(() => db.query("UPDATE journeys SET status = 'published' WHERE id = $1", [id]), '23514', 'journeys_published_min_stops');
    await rejected(() => db.query("INSERT INTO journeys (user_id, title, status) VALUES ($1, 'Invalid published journey', 'published')", [user]), '23514', 'journeys_published_min_stops');
  });

  it('publishes valid stops and atomically swaps their order', async () => {
    const id = await journey();
    await stop(id, 1);
    await stop(id, 2, locations[1]);
    await db.query("UPDATE journeys SET status = 'published', visibility = 'public', revision = revision + 1 WHERE id = $1", [id]);
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    await db.query('SET CONSTRAINTS journey_stops_order_unique DEFERRED');
    await db.query('UPDATE journey_stops SET stop_order = 3 - stop_order WHERE journey_id = $1', [id]);
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    expect((await db.query('SELECT location_id FROM journey_stops WHERE journey_id = $1 ORDER BY stop_order', [id])).rows).toEqual([{ location_id: locations[1] }, { location_id: locations[0] }]);
  });

  it('rejects duplicate destinations, duplicate/invalid/gapped order and missing locations', async () => {
    const id = await journey();
    await stop(id, 1);
    await rejected(() => stop(id, 2), '23505', 'journey_stops_location_unique');
    // Isolate the unique-order constraint from the deferred aggregate check:
    // duplicate orders violate both, with no guaranteed deferred trigger order.
    await db.query('SET CONSTRAINTS journey_stops_order_unique IMMEDIATE');
    await rejected(() => stop(id, 1, locations[1]), '23505', 'journey_stops_order_unique');
    await rejected(() => stop(id, 0, locations[1]), '23514');
    await rejected(() => stop(id, 3, locations[1]), '23514', 'journey_stops_contiguous_order');
    await rejected(() => stop(id, 2, randomUUID()), '23503');
  });

  it('rejects stops with the wrong owner or an unrelated visit', async () => {
    const id = await journey();
    const foreignVisit = await visit(await mark(locations[0], otherUser), '2026-01-02', otherUser);
    const ownVisit = await visit(await mark());
    await rejected(() => stop(id, 1, locations[0], null, otherUser), '23503', 'journey_stops_owner_fk');
    await rejected(() => stop(id, 1, locations[0], foreignVisit), '23503', 'journey_stops_visit_fk');
    await rejected(() => stop(id, 1, locations[1], ownVisit), '23503', 'journey_stops_visit_fk');
  });

  it('preserves published stop snapshots after editing/deleting a visit or mark', async () => {
    const markId = await mark();
    const visitId = await visit(markId);
    const id = await journey();
    await stop(id, 1, locations[0], visitId);
    await stop(id, 2, locations[1]);
    await db.query("UPDATE journeys SET status = 'published' WHERE id = $1", [id]);
    await db.query("UPDATE user_location_visits SET visited_at = '2026-03-04', note = 'Đã sửa' WHERE id = $1", [visitId]);
    await db.query('DELETE FROM user_visited_locations WHERE id = $1', [markId]);
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    const snapshot = (await db.query('SELECT visit_id, location_id, location_name_snapshot, visited_at_snapshot::text FROM journey_stops WHERE journey_id = $1 AND stop_order = 1', [id])).rows[0];
    expect(snapshot).toEqual({ visit_id: null, location_id: locations[0], location_name_snapshot: 'Tên địa điểm đã lưu', visited_at_snapshot: '2026-01-02' });
    expect((await db.query('SELECT count(*)::integer AS count FROM journey_stops WHERE journey_id = $1', [id])).rows[0].count).toBe(2);
  });

  it('rejects removing a published stop unless the aggregate is drafted/updated atomically', async () => {
    const id = await journey();
    await stop(id, 1);
    await stop(id, 2, locations[1]);
    await db.query("UPDATE journeys SET status = 'published' WHERE id = $1", [id]);
    await rejected(() => db.query('DELETE FROM journey_stops WHERE journey_id = $1 AND stop_order = 2', [id]), '23514', 'journeys_published_min_stops');
    await db.query("UPDATE journeys SET status = 'draft' WHERE id = $1", [id]);
    await db.query('DELETE FROM journey_stops WHERE journey_id = $1 AND stop_order = 2', [id]);
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  });

  it('restricts location deletion and cascades journey deletion', async () => {
    const id = await journey();
    await stop(id, 1, locations[2]);
    await rejected(() => db.query('DELETE FROM locations WHERE id = $1', [locations[2]]), '23503');
    await db.query('DELETE FROM journeys WHERE id = $1', [id]);
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    expect((await db.query('SELECT count(*)::integer AS count FROM journey_stops WHERE journey_id = $1', [id])).rows[0].count).toBe(0);
  });

  it('cascades user deletion through marks, visits and journeys', async () => {
    const markId = await mark();
    await visit(markId);
    const id = await journey();
    await stop(id, 1);
    await db.query('DELETE FROM users WHERE id = $1', [user]);
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    for (const table of ['user_visited_locations', 'user_location_visits', 'journeys', 'journey_stops']) {
      expect((await db.query(`SELECT count(*)::integer AS count FROM ${table} WHERE user_id = $1`, [user])).rows[0].count).toBe(0);
    }
  });
});
