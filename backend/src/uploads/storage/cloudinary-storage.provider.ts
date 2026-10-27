import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import type { StorageProvider, StoredObject } from './storage-provider';

export class CloudinaryStorageProvider implements StorageProvider {
  readonly name = 'cloudinary' as const;
  private readonly credentials: { cloud_name: string; api_key: string; api_secret: string };
  constructor(config: ConfigService) {
    this.credentials = {
      cloud_name: config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: config.getOrThrow<string>('CLOUDINARY_API_KEY'),
      api_secret: config.getOrThrow<string>('CLOUDINARY_API_SECRET'),
    };
  }
  async put(id: string, bytes: Buffer): Promise<StoredObject> {
    const key = `wandermap/${id}`;
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        ...this.credentials, public_id: key, resource_type: 'image', type: 'authenticated',
        format: 'webp', overwrite: false, unique_filename: false, timeout: 15_000,
      }, (error, result) => {
        if (error || !result || result.public_id !== key || result.type !== 'authenticated'
          || result.format !== 'webp' || !Number.isSafeInteger(result.version)) return reject(new Error('Media upload failed.'));
        resolve({ key, version: result.version });
      });
      stream.on('error', () => reject(new Error('Media upload failed.')));
      stream.end(bytes);
    });
  }
  async read(object: StoredObject): Promise<Buffer> {
    if (!/^wandermap\/[0-9a-f-]{36}$/.test(object.key) || !object.version) throw new Error('Invalid media storage key.');
    // Never return this signed URL to clients or store it as a canonical resource URL.
    const url = cloudinary.url(object.key, {
      ...this.credentials, version: object.version, resource_type: 'image', type: 'authenticated',
      format: 'webp', secure: true, sign_url: true,
    });
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/webp')) throw new Error('Media delivery failed.');
    if (Number(response.headers.get('content-length') ?? 0) > 10 * 1024 * 1024) throw new Error('Media delivery failed.');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Media delivery failed.');
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 10 * 1024 * 1024) { await reader.cancel(); throw new Error('Media delivery failed.'); }
        chunks.push(Buffer.from(next.value));
      }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks);
  }
}
