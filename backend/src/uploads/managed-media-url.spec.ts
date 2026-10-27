import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePostDto } from '../posts/dto/create-post.dto';
import { JourneyFieldsDto } from '../journeys/dto/journey.dto';
import { isManagedMediaUrl } from './managed-media-url';

describe('production media references', () => {
  const canonical = 'https://api.example.test/api/v1/media/11111111-1111-4111-8111-111111111111';
  it('rejects provider, credential-bearing and signed-query URLs as production canonical references', () => {
    expect(isManagedMediaUrl(canonical)).toBe(true);
    for (const url of ['https://res.cloudinary.com/cloud/image/upload/public.webp', `${canonical}?token=private`, canonical.replace('https://', 'https://user:secret@'), canonical.replace('https:', 'http:')]) expect(isManagedMediaUrl(url)).toBe(false);
  });
  it('enforces managed URL policy in real Post and Journey DTO validation while retaining development legacy compatibility', async () => {
    const previous = process.env.NODE_ENV;
    const post = { location_id: '22222222-2222-4222-8222-222222222222', content: 'Private image', rating: 5, visited_at: '2026-01-01', visibility: 'private' };
    try {
      process.env.NODE_ENV = 'production';
      expect((await validate(plainToInstance(CreatePostDto, { ...post, images: ['https://legacy.example.test/image.webp'] }))).map((error) => error.property)).toContain('images');
      expect(await validate(plainToInstance(CreatePostDto, { ...post, images: [canonical] }))).toEqual([]);
      expect((await validate(plainToInstance(JourneyFieldsDto, { cover_image_url: 'https://legacy.example.test/image.webp' }))).map((error) => error.property)).toContain('cover_image_url');
      process.env.NODE_ENV = 'test';
      expect(await validate(plainToInstance(CreatePostDto, { ...post, images: ['https://legacy.example.test/image.webp'] }))).toEqual([]);
    } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
  });
});
