import type { ClientConfig } from 'pg';

/** pg URL SSL parameters can replace the explicit ssl object: consume/remove them first. */
export function databaseConnectionOptions(raw: string, setting = '', production = false): ClientConfig {
  let url: URL;
  try {
    url = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error();
  } catch { throw new Error('DATABASE_URL must be a PostgreSQL URL including a database name.'); }
  const queryMode = url.searchParams.get('sslmode');
  const mode = queryMode || setting;
  if (!['', 'require', 'verify-full', 'disable'].includes(mode) || (production && mode === 'disable')) {
    throw new Error('DATABASE_URL/PGSSLMODE must not weaken TLS verification.');
  }
  for (const key of ['ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat', 'sslnegotiation']) {
    if (url.searchParams.has(key)) throw new Error('Configure verified database TLS through PGSSLMODE and the Node trust store, not URL SSL overrides.');
  }
  url.searchParams.delete('sslmode');
  return {
    connectionString: url.toString(),
    // Production always verifies TLS; local disposable databases may use plaintext.
    ssl: production || ['require', 'verify-full'].includes(mode) ? { rejectUnauthorized: true } : false,
  };
}
