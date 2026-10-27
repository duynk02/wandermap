import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import { DatabaseService } from '../database/database.service';
import type { StorageProvider } from './storage/storage-provider';

describe('managed media delivery', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const row = { id, provider: 'cloudinary', storage_key: `wandermap/${id}`, version: '123', bytes: 4 };
  let query: jest.Mock;
  let provider: StorageProvider;
  let service: StorageService;
  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [row] });
    provider = { name: 'cloudinary', put: jest.fn().mockResolvedValue({ key: row.storage_key, version: 123 }), read: jest.fn().mockResolvedValue(Buffer.from('webp')) };
    service = new StorageService({ query } as unknown as DatabaseService, new ConfigService({ PUBLIC_API_URL: 'https://api.example.com/api/v1' }), provider);
  });
  it('does not touch provider bytes if resource authorization denies the request', async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(service.read(id)).rejects.toBeInstanceOf(NotFoundException);
    expect(provider.read).not.toHaveBeenCalled();
  });
  it('reauthorizes after download so a concurrent privacy change discards the bytes', async () => {
    query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [] });
    await expect(service.read(id, id)).rejects.toBeInstanceOf(NotFoundException);
    expect(provider.read).toHaveBeenCalledTimes(1);
  });
  it('returns only stable API URL metadata after upload, never provider key or signed URL', async () => {
    const result = await service.store(id, Buffer.from('webp'), 2, 2);
    expect(result).toEqual({ url: expect.stringMatching(/^https:\/\/api.example.com\/api\/v1\/media\/[0-9a-f-]{36}$/), width: 2, height: 2, bytes: 4 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO media_assets'), expect.arrayContaining([id, 'cloudinary', row.storage_key]));
  });
  it('never exposes provider exceptions containing credentials or signed URLs', async () => {
    jest.mocked(provider.read).mockRejectedValue(new Error('https://secret:signed-token@provider.invalid'));
    try { await service.read(id, id); throw new Error('Expected failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(String(error)).not.toContain('signed-token');
    }
  });
});
