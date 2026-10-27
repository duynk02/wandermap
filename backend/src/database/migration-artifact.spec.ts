import { migrationArtifact, migrationHash } from './migration-artifact';

describe('canonical release migration artifact', () => {
  const canonical = Buffer.from('SELECT 1;\nSELECT 2;\n');
  const windows = Buffer.from('SELECT 1;\r\nSELECT 2;\r\n');
  const manifest = { canonical: migrationHash(canonical), windows: migrationHash(windows) };
  it('packages identical Git-canonical bytes from known LF and CRLF checkouts without modifying the source buffer', () => {
    const original = Buffer.from(windows);
    expect(migrationArtifact(canonical, manifest)).toEqual(canonical);
    expect(migrationArtifact(windows, manifest)).toEqual(canonical);
    expect(windows).toEqual(original);
  });
  it('rejects content drift and does not silently normalize new migrations', () => {
    expect(() => migrationArtifact(Buffer.from('SELECT 3;\r\n'), manifest)).toThrow(/Historical SQL differs/);
    expect(() => migrationArtifact(windows)).toThrow(/LF/);
  });
});
