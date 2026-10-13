import { ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PostsService } from './posts.service';

describe('PostsService', () => {
  let db: { query: jest.Mock };
  let service: PostsService;

  beforeEach(() => {
    db = { query: jest.fn() };
    service = new PostsService(db as unknown as DatabaseService);
  });

  it('does not bind viewer parameters to a count query when no feed filters are supplied', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await service.feed({ page: 1, pageSize: 12 }, 'viewer-id');
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][0]).toContain('COUNT(*)');
    expect(db.query.mock.calls[1][1]).toEqual([]);
  });

  it('uses idempotent insert semantics when liking a post', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'post-id' }] }) // visibility check
      .mockResolvedValueOnce({ rows: [] }) // INSERT ... ON CONFLICT DO NOTHING
      .mockResolvedValueOnce({ rows: [{ likes_count: 7 }] });

    await expect(service.setLike('user-id', 'post-id', true)).resolves.toEqual({ liked: true, likes_count: 7 });
    expect(db.query.mock.calls[1][0]).toContain('ON CONFLICT DO NOTHING');
  });

  it('rejects attempts to delete posts owned by another user', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ author_id: 'owner-id' }] });
    await expect(service.delete('different-user', 'post-id')).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
