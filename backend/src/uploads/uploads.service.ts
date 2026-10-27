import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import path from 'node:path';
import sharp from 'sharp';
import { StorageService } from './storage.service';

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

  constructor(config: ConfigService, private readonly storage: StorageService) {
    this.rootDir = path.resolve(config.get<string>('UPLOAD_DIR') || path.join(process.cwd(), 'uploads'));
  }

  /**
   * Validates that the bytes really are an image (the declared MIME type is never trusted),
   * auto-rotates, downsizes, strips all metadata (EXIF GPS included) and stores it as WebP.
   * The managed asset is stored privately and delivered only after resource authorization.
   */
  async saveImage(input: Buffer, owner: string): Promise<StoredImage> {
    let output: { data: Buffer; info: { width: number; height: number } };
    try {
      const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
      if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) throw new Error(`unsupported format: ${meta.format}`);
      output = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate()
        .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      this.logger.debug('Rejected invalid image upload.');
      throw new BadRequestException('Tệp không phải ảnh hợp lệ. Hỗ trợ JPEG, PNG, WebP, GIF và AVIF.');
    }

    if (output.data.length > 10 * 1024 * 1024) throw new BadRequestException('Ảnh sau xử lý vượt quá dung lượng cho phép.');
    return this.storage.store(owner, output.data, output.info.width, output.info.height);
  }
}
