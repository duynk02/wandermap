import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { UploadsService } from './uploads.service';
import { StorageService } from './storage.service';
import { LocalStorageProvider } from './storage/local-storage.provider';
import { DatabaseService } from '../database/database.service';

describe('UploadsService', () => {
  let dir: string;
  let service: UploadsService;
  const owner = '11111111-1111-4111-8111-111111111111';

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wandermap-uploads-'));
    const values: Record<string, unknown> = { UPLOAD_DIR: dir, UPLOAD_PUBLIC_URL: 'http://localhost:4000/uploads/', PORT: 4000 };
    const config = new ConfigService(values);
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as DatabaseService;
    service = new UploadsService(config, new StorageService(db, config, new LocalStorageProvider(config)));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const photo = (width: number, height: number, format: 'jpeg' | 'png' = 'jpeg') => {
    const image = sharp({ create: { width, height, channels: 3, background: '#2f9e44' } }).withExif({ IFD0: { Copyright: 'secret-owner' } });
    return (format === 'png' ? image.png() : image.jpeg()).toBuffer();
  };

  it('re-encodes to WebP, downsizes large images and strips metadata', async () => {
    const stored = await service.saveImage(await photo(4000, 3000), owner);
    expect(stored.url).toMatch(/^http:\/\/localhost:4000\/api\/v1\/media\/[0-9a-f-]{36}$/);
    expect(Math.max(stored.width, stored.height)).toBe(2048);

    const file = path.join(dir, '.private', `${stored.url.split('/').at(-1)}.webp`);
    const meta = await sharp(await readFile(file)).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
  });

  it('does not enlarge small images', async () => {
    const stored = await service.saveImage(await photo(300, 200, 'png'), owner);
    expect([stored.width, stored.height]).toEqual([300, 200]);
  });

  it('gives identical bytes separate managed identities so private delivery is not deduplicated across owners', async () => {
    const input = await photo(500, 500);
    const a = await service.saveImage(input, owner);
    const b = await service.saveImage(input, '22222222-2222-4222-8222-222222222222');
    expect(a.url).not.toBe(b.url);
    expect(a.bytes).toBe(b.bytes);
  });

  it('rejects files that are not images, whatever their name or MIME type says', async () => {
    await expect(service.saveImage(Buffer.from('<?php echo 1; ?>'), owner)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects SVG (can embed scripts / external references)', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    await expect(service.saveImage(svg, owner)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects truncated / corrupt images', async () => {
    const input = await photo(800, 800);
    await expect(service.saveImage(input.subarray(0, 200), owner)).rejects.toBeInstanceOf(BadRequestException);
  });
});
