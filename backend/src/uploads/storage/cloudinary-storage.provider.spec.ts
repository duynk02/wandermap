import { ConfigService } from '@nestjs/config';
import { PassThrough } from 'node:stream';
import { v2 as cloudinary, UploadApiOptions } from 'cloudinary';
import { CloudinaryStorageProvider } from './cloudinary-storage.provider';

jest.mock('cloudinary', () => ({ v2: { uploader: { upload_stream: jest.fn() }, url: jest.fn() } }));

describe('Cloudinary authenticated storage (mocked provider only)', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const config = new ConfigService({ CLOUDINARY_CLOUD_NAME: 'test-cloud', CLOUDINARY_API_KEY: 'test-key', CLOUDINARY_API_SECRET: 'test-secret' });
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.resetAllMocks(); });
  it('uploads a sanitized buffer as authenticated WebP without overwriting existing objects', async () => {
    (cloudinary.uploader.upload_stream as unknown as jest.Mock).mockImplementation((options: UploadApiOptions, callback: unknown) => {
      expect(options).toMatchObject({ type: 'authenticated', resource_type: 'image', overwrite: false, public_id: `wandermap/${id}`, format: 'webp' });
      const stream = new PassThrough();
      stream.on('finish', () => (callback as (error: unknown, result: unknown) => void)(null, { public_id: `wandermap/${id}`, version: 123, type: 'authenticated', format: 'webp' }));
      return stream as ReturnType<typeof cloudinary.uploader.upload_stream>;
    });
    await expect(new CloudinaryStorageProvider(config).put(id, Buffer.from('webp'))).resolves.toEqual({ key: `wandermap/${id}`, version: 123 });
  });
  it('signs only server-side authenticated delivery and reads bytes without redirects', async () => {
    jest.mocked(cloudinary.url).mockReturnValue('https://res.cloudinary.com/test-cloud/image/authenticated/s--signature--/image.webp');
    global.fetch = jest.fn().mockResolvedValue(new Response(Buffer.from('webp'), { headers: { 'content-type': 'image/webp' } }));
    await expect(new CloudinaryStorageProvider(config).read({ key: `wandermap/${id}`, version: 123 })).resolves.toEqual(Buffer.from('webp'));
    expect(cloudinary.url).toHaveBeenCalledWith(`wandermap/${id}`, expect.objectContaining({ sign_url: true, secure: true, type: 'authenticated' }));
    expect(global.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error' }));
  });
});
