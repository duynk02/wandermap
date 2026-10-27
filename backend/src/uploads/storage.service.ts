import { Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { postAccess } from '../posts/post-access';
import { STORAGE_PROVIDER, StorageProvider } from './storage/storage-provider';

interface AssetRow { id: string; provider: string; storage_key: string; version: string | number | null; bytes: number; }

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly publicApiUrl: string;
  constructor(private readonly db: DatabaseService, config: ConfigService,
    @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider) {
    this.publicApiUrl = (config.get<string>('PUBLIC_API_URL') || 'http://localhost:4000/api/v1').replace(/\/+$/, '');
  }
  async store(owner: string, data: Buffer, width: number, height: number) {
    const id = randomUUID();
    const url = `${this.publicApiUrl}/media/${id}`;
    let object;
    try { object = await this.provider.put(id, data); }
    catch { this.logger.warn('Media storage unavailable.'); throw new ServiceUnavailableException({ code: 'MEDIA_UNAVAILABLE', message: 'Không thể lưu ảnh. Vui lòng thử lại.' }); }
    // A failed INSERT may leave an inaccessible authenticated orphan, never a public image.
    await this.db.query(`INSERT INTO media_assets (id, owner_id, provider, storage_key, version, canonical_url, width, height, bytes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [id, owner, this.provider.name, object.key, object.version, url, width, height, data.length]);
    return { url, width, height, bytes: data.length };
  }
  private async accessible(id: string, viewer?: string): Promise<AssetRow> {
    const result = await this.db.query<AssetRow>(`SELECT a.id, a.provider, a.storage_key, a.version, a.bytes
      FROM media_assets a JOIN users owner ON owner.id = a.owner_id AND owner.is_active = true
      WHERE a.id = $2 AND (a.owner_id = $1::uuid
        OR EXISTS (SELECT 1 FROM profiles av WHERE av.id = a.owner_id AND av.avatar_url = a.canonical_url)
        OR EXISTS (SELECT 1 FROM posts p WHERE p.images @> ARRAY[a.canonical_url] AND ${postAccess('$1::uuid')})
        OR EXISTS (SELECT 1 FROM journeys j WHERE j.cover_image_url = a.canonical_url
          AND (j.user_id = $1::uuid OR (j.visibility = 'public' AND j.status = 'published')))
        OR EXISTS (SELECT 1 FROM itineraries i WHERE i.cover_image = a.canonical_url AND (i.author_id = $1::uuid OR i.is_public)))`, [viewer ?? null, id]);
    const asset = result.rows[0];
    if (!asset) throw new NotFoundException('Không tìm thấy ảnh.');
    return asset;
  }
  async read(id: string, viewer?: string): Promise<Buffer> {
    const asset = await this.accessible(id, viewer);
    if (asset.provider !== this.provider.name) throw new ServiceUnavailableException('Media provider is unavailable.');
    let data: Buffer;
    try { data = await this.provider.read({ key: asset.storage_key, version: asset.version === null ? null : Number(asset.version) }); }
    catch { this.logger.warn('Media delivery unavailable.'); throw new ServiceUnavailableException({ code: 'MEDIA_UNAVAILABLE', message: 'Không thể tải ảnh. Vui lòng thử lại.' }); }
    if (data.length !== asset.bytes) throw new ServiceUnavailableException('Media delivery is incomplete.');
    // A visibility change while the provider was responding must not disclose the buffer.
    await this.accessible(id, viewer);
    return data;
  }
}
