import { config as loadLocalEnvironment } from 'dotenv';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { databaseConnectionOptions } from './connection-options';

async function main() {
  if (!['production', 'test'].includes(process.env.NODE_ENV ?? '')) loadLocalEnvironment();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required. Copy .env.example to .env and configure it first.');

  const client = new Client({
    ...databaseConnectionOptions(databaseUrl, process.env.PGSSLMODE, process.env.NODE_ENV === 'production'),
    application_name: 'wandermap-migrations',
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  const lockKey = 719_202_610;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [lockKey]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const dir = path.join(__dirname, 'migrations');
    const files = (await readdir(dir)).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
    if (files.length === 0) throw new Error(`No SQL migrations found in ${dir}`);
    const applied = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations');
    const appliedByName = new Map(applied.rows.map((row) => [row.name, row.checksum.trim()]));
    let pending = 0;

    for (const name of files) {
      const sql = await readFile(path.join(dir, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = appliedByName.get(name);
      if (previous) {
        if (previous !== checksum) throw new Error(`Applied migration ${name} was modified. Create a new migration instead of editing an applied one.`);
        console.log(`✓ ${name} (already applied)`);
        continue;
      }
      if (process.argv.includes('--status')) {
        console.log(`○ ${name} (pending)`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT');
        pending++;
        console.log(`✓ ${name} applied`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    if (process.argv.includes('--status')) console.log(`${files.filter((name) => !appliedByName.has(name)).length} migration(s) pending.`);
    else console.log(pending === 0 ? 'Database schema is up to date.' : `Applied ${pending} migration(s).`);
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [lockKey]); } finally { await client.end(); }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
