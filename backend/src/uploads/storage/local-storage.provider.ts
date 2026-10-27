import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StorageProvider, StoredObject } from './storage-provider';

/** Dot-directory is never served by the legacy static route (dotfiles: deny). */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local' as const;
  private readonly directory: string;
  constructor(config: ConfigService) {
    this.directory = path.join(path.resolve(config.get<string>('UPLOAD_DIR') || 'uploads'), '.private');
  }
  private file(key: string) {
    if (!/^[0-9a-f-]{36}\.webp$/.test(key)) throw new Error('Invalid media storage key.');
    return path.join(this.directory, key);
  }
  async put(id: string, bytes: Buffer): Promise<StoredObject> {
    const key = `${id}.webp`;
    const file = this.file(key);
    await mkdir(this.directory, { recursive: true });
    await writeFile(file, bytes, { flag: 'wx' });
    return { key, version: null };
  }
  read(object: StoredObject) { return readFile(this.file(object.key)); }
}
