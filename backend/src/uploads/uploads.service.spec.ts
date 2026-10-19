import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { UploadsService } from './uploads.service';

describe('UploadsService', () => {
  let dir: string;
  let service: UploadsService;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wandermap-uploads-'));
    const values: Record<string, unknown> = { UPLOAD_DIR: dir, UPLOAD_PUBLIC_URL: 'http://localhost:4000/uploads/', PORT: 4000 };
    service = new UploadsService({ get: (key: string, fallback?: unknown) => values[key] ?? fallback } as unknown as ConfigService);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const photo = (width: number, height: number, format: 'jpeg' | 'png' = 'jpeg') => {
    const image = sharp({ create: { width, height, channels: 3, background: '#2f9e44' } }).withExif({ IFD0: { Copyright: 'secret-owner' } });
    return (format === 'png' ? image.png() : image.jpeg()).toBuffer();
  };

  it('re-encodes to WebP, downsizes large images and strips metadata', async () => {
    const stored = await service.saveImage(await photo(4000, 3000));
    expect(stored.url).toMatch(/^http:\/\/localhost:4000\/uploads\/[0-9a-f]{2}\/[0-9a-f]{32}\.webp$/);
    expect(Math.max(stored.width, stored.height)).toBe(2048);

    const file = path.join(dir, stored.url.split('/uploads/')[1]);
    const meta = await sharp(await readFile(file)).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
  });

  it('does not enlarge small images', async () => {
    const stored = await service.saveImage(await photo(300, 200, 'png'));
    expect([stored.width, stored.height]).toEqual([300, 200]);
  });

  it('stores identical uploads once (content-addressed)', async () => {
    const input = await photo(500, 500);
    const a = await service.saveImage(input);
    const b = await service.saveImage(input);
    expect(a.url).toBe(b.url);
  });

  it('rejects files that are not images, whatever their name or MIME type says', async () => {
    await expect(service.saveImage(Buffer.from('<?php echo 1; ?>'))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects SVG (can embed scripts / external references)', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    await expect(service.saveImage(svg)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects truncated / corrupt images', async () => {
    const input = await photo(800, 800);
    await expect(service.saveImage(input.subarray(0, 200))).rejects.toBeInstanceOf(BadRequestException);
  });
});