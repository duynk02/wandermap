import { createHash } from 'node:crypto';

export const migrationHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export interface HistoricalMigration { canonical: string; windows: string; }

/** Package a verified copy; never rewrite SQL sources or change recorded DB checksums. */
export function migrationArtifact(bytes: Buffer, historical?: HistoricalMigration): Buffer {
  if (!historical) {
    if (bytes.includes(13)) throw new Error('New SQL migrations must use LF line endings.');
    return Buffer.from(bytes);
  }
  const hash = migrationHash(bytes);
  if (hash === historical.canonical) return Buffer.from(bytes);
  if (hash !== historical.windows) throw new Error('Historical SQL differs from the reviewed Git baseline; do not edit applied migrations.');
  const canonicalCopy = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'));
  if (migrationHash(canonicalCopy) !== historical.canonical) throw new Error('Historical SQL artifact failed checksum verification.');
  return canonicalCopy;
}
