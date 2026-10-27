// Run only after operator approval. SELECT-only inspection in a READ ONLY transaction.
// Never imports migrate.js, creates history, takes advisory locks, or prints raw errors.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const tls = require('node:tls');
const { root, verifyArtifact } = require('./verify-artifact.cjs');
const backendRequire = createRequire(path.join(root, 'backend/package.json'));
let stage = 'input-and-runtime';

async function inspect() {
  const phase = process.argv[2];
  assert.ok(['before', 'after'].includes(phase));
  assert.equal(process.env.NODE_ENV, 'production');
  assert.equal(process.env.PGSSLMODE, 'verify-full');
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
  assert.ok(!process.env.NODE_OPTIONS, 'Use a dedicated shell without Node option overrides.');
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  assert.ok(major === 22 && minor === 23 && patch === 4);
  const host = process.env.WANDERMAP_PROD_HOST;
  assert.match(host || '', /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.render\.com$/i);
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, host);
  assert.equal(decodeURIComponent(url.username), 'wandermap_app');
  assert.equal(decodeURIComponent(url.pathname), '/wandermap');
  assert.ok(url.password && !url.hash);
  assert.ok(!url.port || url.port === '5432');
  for (const [key, value] of url.searchParams) {
    assert.equal(key, 'sslmode');
    assert.ok(['require', 'verify-full'].includes(value));
  }
  assert.ok(url.searchParams.getAll('sslmode').length <= 1);
  stage = 'release-artifact';
  const migrations = verifyArtifact();
  const { Client } = backendRequire('pg');
  const { databaseConnectionOptions } = backendRequire('./dist/database/connection-options.js');
  const options = databaseConnectionOptions(url.toString(), 'verify-full', true);
  assert.equal(options.ssl.rejectUnauthorized, true);
  const client = new Client({ ...options, application_name: 'wandermap-production-preflight', connectionTimeoutMillis: 10000,
    options: '-c default_transaction_read_only=on -c statement_timeout=15000' });
  try {
    stage = 'connection-and-verified-tls';
    await client.connect();
    assert.equal(client.connection.stream.encrypted, true);
    assert.equal(client.connection.stream.authorized, true);
    assert.equal(tls.checkServerIdentity(host, client.connection.stream.getPeerCertificate()), undefined);
    stage = 'identity-and-permissions';
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '15s'");
    const identity = (await client.query(`SELECT current_database() AS db, current_user AS usr, session_user AS session_usr,
      current_setting('server_version_num')::int AS version,
      current_setting('transaction_read_only') AS read_only,
      current_schema() AS schema,
      has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect,
      has_schema_privilege(current_user, 'public', 'CREATE') AS can_create,
      has_schema_privilege(current_user, 'public', 'USAGE') AS can_use`)).rows[0];
    assert.equal(identity.db, 'wandermap');
    assert.equal(identity.usr, 'wandermap_app');
    assert.equal(identity.session_usr, 'wandermap_app');
    assert.equal(identity.read_only, 'on');
    assert.equal(identity.schema, 'public');
    assert.ok(identity.version >= 160000 && identity.version < 170000, 'Review non-PG16 target separately.');
    assert.ok(identity.can_connect && identity.can_create && identity.can_use);
    const sslSession = (await client.query('SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()')).rows[0];
    assert.equal(sslSession.ssl, true);
    stage = 'extensions';
    const extensions = (await client.query(`SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname IN ('postgis', 'pg_trgm', 'unaccent') ORDER BY e.extname`)).rows;
    assert.equal(extensions.length, 3);
    const expectedVersions = { postgis: '3.6.2', pg_trgm: '1.6', unaccent: '1.1' };
    for (const ext of extensions) {
      assert.equal(ext.schema, 'public');
      assert.equal(ext.version, expectedVersions[ext.name], 'Review changed extension version.');
    }
    await client.query('SELECT public.postgis_full_version()');
    if (phase === 'before') {
      stage = 'empty-schema';
      const objects = (await client.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass
          AND d.objid=c.oid AND d.deptype='e')`)).rows;
      assert.equal(objects.length, 0, 'Database has non-extension relations; stop fresh-DB procedure.');
      const functions = (await client.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND NOT EXISTS (SELECT 1 FROM pg_depend d
          WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')`)).rows;
      assert.equal(functions.length, 0);
    } else {
      stage = 'post-migration-verification';
      const history = (await client.query('SELECT name, trim(checksum) AS checksum FROM public.schema_migrations ORDER BY name')).rows;
      assert.deepEqual(history, migrations);
      const names = migrations.flatMap(({ name }) => {
        const sql = fs.readFileSync(path.join(root, 'backend/dist/database/migrations', name), 'utf8');
        return [...sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-z_]+)/gi)].map((match) => match[1]);
      });
      const expected = [...new Set(names)].sort();
      const tables = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'
        AND tablename NOT IN ('spatial_ref_sys','schema_migrations') ORDER BY tablename`)).rows.map((row) => row.tablename);
      assert.deepEqual(tables, expected);
      // All identifiers come from the reviewed artifact and this explicit identifier allowlist.
      for (const table of expected) {
        assert.match(table, /^[a-z_]+$/);
        const count = (await client.query(`SELECT count(*)::int AS n FROM public."${table}"`)).rows[0].n;
        assert.equal(count, 0, 'Expected a fresh database without application data.');
      }
      const invalid = (await client.query(`SELECT i.indexrelid FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (NOT i.indisvalid OR NOT i.indisready)`)).rows;
      assert.equal(invalid.length, 0);
      const indexes = (await client.query(`SELECT c.relname AS name, am.amname AS method
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_am am ON am.oid=c.relam WHERE n.nspname='public' AND c.relkind='i'`)).rows;
      for (const [name, method] of [['locations_coordinates_gist_idx', 'gist'], ['locations_search_text_idx', 'gin'],
        ['media_assets_owner_idx', 'btree'], ['posts_media_urls_idx', 'gin']]) {
        assert.ok(indexes.some((index) => index.name === name && index.method === method));
      }
      const constraints = (await client.query(`SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
        WHERE n.nspname='public' AND NOT c.convalidated`)).rows;
      assert.equal(constraints.length, 0);
      const normalized = (await client.query("SELECT public.vn_normalize('ĐÀ LẠT') AS lat, public.vn_normalize('Đà Nẵng') AS nang")).rows[0];
      assert.deepEqual(normalized, { lat: 'da lat', nang: 'da nang' });
      const triggers = (await client.query(`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled='O'`)).rows.map((row) => row.tgname);
      for (const trigger of ['locations_set_updated_at', 'posts_media_ownership', 'journeys_media_ownership', 'profiles_media_ownership', 'itineraries_media_ownership']) assert.ok(triggers.includes(trigger));
      const spatial = (await client.query("SELECT srid, type FROM public.geometry_columns WHERE f_table_schema='public' AND f_table_name='locations' AND f_geometry_column='coordinates'")).rows;
      assert.equal(spatial.length, 1);
      assert.equal(spatial[0].srid, 4326);
      assert.equal(spatial[0].type, 'POINT');
    }
    stage = 'finish-read-only-transaction';
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ result: 'PASS', phase, verifiedTLS: true, hostnameMatched: true,
      database: identity.db, user: identity.usr, permissions: { connect: identity.can_connect, usage: identity.can_use, create: identity.can_create },
      postgresVersion: identity.version, extensions,
      migrations: phase === 'before' ? 'history absent; 16 expected pending (runner not invoked)' : '16 checksums matched; 0 pending' }, null, 2));
  } finally {
    await client.end();
  }
}

inspect().catch(() => {
  console.error(JSON.stringify({ result: 'FAIL', stage, message: 'Inspection stopped; no raw connection/error details emitted. Review this gate without changing the database.' }));
  process.exitCode = 1;
});
