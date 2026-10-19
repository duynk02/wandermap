import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/** Formats accepted as input. Everything is re-encoded to WebP. SVG is rejected on purpose. */
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif']);
const MAX_EDGE_PX = 2048;
const MAX_INPUT_PIXELS = 80_000_000;

export interface StoredImage {
  url: string;
  width: number;
  height: number;
  bytes: number;
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  readonly rootDir: string;
  private readonly publicBase: string;

  constructor(config: ConfigService) {
    this.rootDir = path.resolve(config.get<string>('UPLOAD_DIR') || path.join(process.cwd(), 'uploads'));
    const port = config.get<number>('PORT', 4000);
    this.publicBase = (config.get<string>('UPLOAD_PUBLIC_URL') || `http://localhost:${port}/uploads`).replace(/\/+$/, '');
  }

  /**
   * Validates that the bytes really are an image (the declared MIME type is never trusted),
   * auto-rotates, downsizes, strips all metadata (EXIF GPS included) and stores it as WebP.
   * The file name is the content hash, so identical uploads are stored once and can be cached forever.
   */
  async saveImage(input: Buffer): Promise<StoredImage> {
    let output: { data: Buffer; info: { width: number; height: number } };
    try {
      const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
      if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) throw new Error(`unsupported format: ${meta.format}`);
      output = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate()
        .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
    } catch (error) {
      this.logger.debug(`Rejected upload: ${error instanceof Error ? error.message : error}`);
      throw new BadRequestException('Tệp không phải ảnh hợp lệ. Hỗ trợ JPEG, PNG, WebP, GIF và AVIF.');
    }

    const hash = createHash('sha256').update(output.data).digest('hex').slice(0, 32);
    const shard = hash.slice(0, 2);
    const directory = path.join(this.rootDir, shard);
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(path.join(directory, `${hash}.webp`), output.data, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    return {
      url: `${this.publicBase}/${shard}/${hash}.webp`,
      width: output.info.width,
      height: output.info.height,
      bytes: output.data.length,
    };
  }
}