import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { databaseConnectionOptions } from '../src/database/connection-options.ts';

const fixture = 'postgresql://test:fixture@db.example.test/transport_test';
test('pg URL sslmode cannot overwrite certificate verification for pool/listener/migration configuration', () => {
  for (const setting of ['', 'require', 'verify-full']) {
    const options = databaseConnectionOptions(`${fixture}?sslmode=require`, setting, true);
    assert.equal(new URL(options.connectionString).searchParams.has('sslmode'), false);
    const client = new pg.Client(options);
    assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
  }
});
test('production rejects insecure and file-bearing URL TLS options without echoing credentials', () => {
  for (const query of ['sslmode=disable', 'sslmode=no-verify', 'sslmode=prefer', 'ssl=true', 'sslrootcert=/secret/path', 'uselibpqcompat=true']) {
    assert.throws(() => databaseConnectionOptions(`${fixture}?${query}`, '', true), (error) => !error.message.includes('fixture') && !error.message.includes('/secret/path'));
  }
});
test('production defaults to verified TLS while local tests may explicitly use plaintext', () => {
  assert.equal(new pg.Client(databaseConnectionOptions(fixture, '', true)).connectionParameters.ssl.rejectUnauthorized, true);
  assert.equal(new pg.Client(databaseConnectionOptions(fixture, '', false)).connectionParameters.ssl, false);
});
