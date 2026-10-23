import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DatabaseService } from '../database/database.service';
import { PostsService } from '../posts/posts.service';
import { CommentsService } from './comments.service';
import { COMMENT_MAX_LENGTH, CreateCommentDto } from './dto/create-comment.dto';

const POST = '11111111-1111-4111-8111-111111111111';
const OTHER_POST = '22222222-2222-4222-8222-222222222222';
const PARENT = '33333333-3333-4333-8333-333333333333';
const REPLY = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';
const REQUEST = '66666666-6666-4666-8666-666666666666';

function setup(rows: Record<string, unknown[]>) {
  const query = jest.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.startsWith('SELECT id, post_id, parent_id FROM comments')) return { rows: rows.parent ?? [] };
    if (sql.startsWith('INSERT INTO comments')) return { rows: rows.insert ?? [{ id: 'new-comment' }] };
    if (sql.startsWith('SELECT id, post_id, parent_id, content FROM comments')) return { rows: rows.existing ?? [] };
    return { rows: [{ id: 'new-comment', comments_count: 3, reply_count: 1 }] };
  });
  const assertVisible = jest.fn().mockResolvedValue(undefined);
  const service = new CommentsService({ query } as unknown as DatabaseService, { assertVisible } as unknown as PostsService);
  return { service, query, assertVisible };
}

describe('CommentsService.create', () => {
  it('checks that the viewer can see the post before anything else', async () => {
    const { service, assertVisible } = setup({});
    assertVisible.mockRejectedValueOnce(new NotFoundException());
    await expect(service.create(USER, POST, { content: 'hi' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a reply to a reply (only one reply level)', async () => {
    const { service, query } = setup({ parent: [{ id: REPLY, post_id: POST, parent_id: PARENT }] });
    await expect(service.create(USER, POST, { content: 'hi', parent_id: REPLY })).rejects.toBeInstanceOf(BadRequestException);
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT'))).toBe(false);
  });

  it('rejects a parent that belongs to another post, or does not exist', async () => {
    const other = setup({ parent: [{ id: PARENT, post_id: OTHER_POST, parent_id: null }] });
    await expect(other.service.create(USER, POST, { content: 'hi', parent_id: PARENT })).rejects.toBeInstanceOf(NotFoundException);
    const missing = setup({ parent: [] });
    await expect(missing.service.create(USER, POST, { content: 'hi', parent_id: PARENT })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects blank content even if it bypassed the DTO', async () => {
    const { service } = setup({});
    await expect(service.create(USER, POST, { content: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('inserts the trimmed content and returns the authoritative counters', async () => {
    const { service, query } = setup({ parent: [{ id: PARENT, post_id: POST, parent_id: null }] });
    const result = await service.create(USER, POST, { content: '  xin chào  ', parent_id: PARENT });
    const insert = query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT'));
    expect(insert?.[1]).toEqual([POST, USER, PARENT, 'xin chào']);
    expect(result.post).toEqual({ id: POST, comments_count: 3 });
    expect(result.parent).toMatchObject({ reply_count: 1 });
  });

  it('uses an optional author-scoped key for new submissions and preserves authoritative counters', async () => {
    const { service, query } = setup({});
    const result = await service.create(USER, POST, { content: '  hi  ', client_request_id: REQUEST });
    const insert = query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT'));
    expect(insert?.[1]).toEqual([POST, USER, null, 'hi', REQUEST]);
    expect(insert?.[0]).toContain('ON CONFLICT (author_id, client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING');
    expect(result.comment.id).toBe('new-comment');
    expect(result.post).toEqual({ id: POST, comments_count: 3 });
    expect(result.parent).toBeNull();
    expect(query.mock.calls.some(([sql]) => String(sql).includes('FROM comments WHERE author_id'))).toBe(false);
  });

  it('returns the existing comment and current counters when a keyed submission is retried', async () => {
    const { service, query } = setup({
      insert: [],
      existing: [{ id: 'new-comment', post_id: POST, parent_id: null, content: 'hi' }],
    });
    const result = await service.create(USER, POST, { content: ' hi ', client_request_id: REQUEST });
    const existing = query.mock.calls.find(([sql]) => String(sql).includes('FROM comments WHERE author_id'));
    expect(existing?.[1]).toEqual([USER, REQUEST]);
    expect(result.comment.id).toBe('new-comment');
    expect(result.post).toEqual({ id: POST, comments_count: 3 });
    expect(query.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT'))).toHaveLength(1);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO notifications'))).toBe(false);
  });

  it('reuses a reply submission without changing its parent context', async () => {
    const { service } = setup({
      parent: [{ id: PARENT, post_id: POST, parent_id: null }],
      insert: [],
      existing: [{ id: 'new-comment', post_id: POST, parent_id: PARENT, content: 'reply' }],
    });
    const result = await service.create(USER, POST, { content: 'reply', parent_id: PARENT, client_request_id: REQUEST });
    expect(result.comment.id).toBe('new-comment');
    expect(result.parent).toMatchObject({ reply_count: 1 });
  });

  it.each([
    { post_id: POST, parent_id: null, content: 'different text' },
    { post_id: OTHER_POST, parent_id: null, content: 'hi' },
    { post_id: POST, parent_id: PARENT, content: 'hi' },
  ])('rejects reuse of a request key for a different content or context: %j', async (existing) => {
    const { service } = setup({ insert: [], existing: [{ id: 'new-comment', ...existing }] });
    await expect(service.create(USER, POST, { content: 'hi', client_request_id: REQUEST })).rejects.toBeInstanceOf(ConflictException);
  });

  it('fails safely if the competing comment disappeared before the duplicate lookup', async () => {
    const { service } = setup({ insert: [], existing: [] });
    await expect(service.create(USER, POST, { content: 'hi', client_request_id: REQUEST })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CommentsService.setLike', () => {
  it('404s for an unknown comment and never touches likes', async () => {
    const { service, query } = setup({ parent: [] });
    await expect(service.setLike(USER, PARENT, true)).rejects.toBeInstanceOf(NotFoundException);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('comment_likes'))).toBe(false);
  });

  it('refuses to like comments on a post the viewer cannot see', async () => {
    const { service, assertVisible, query } = setup({ parent: [{ id: PARENT, post_id: POST, parent_id: null }] });
    assertVisible.mockRejectedValueOnce(new NotFoundException());
    await expect(service.setLike(USER, PARENT, true)).rejects.toBeInstanceOf(NotFoundException);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('comment_likes'))).toBe(false);
  });
});

describe('CreateCommentDto', () => {
  const check = (body: object) => validate(plainToInstance(CreateCommentDto, body));

  it('trims and accepts normal content', async () => {
    const dto = plainToInstance(CreateCommentDto, { content: '  ok  ' });
    expect(dto.content).toBe('ok');
    expect(await validate(dto)).toHaveLength(0);
  });
  it('rejects empty / whitespace-only content', async () => {
    expect(await check({ content: '' })).not.toHaveLength(0);
    expect(await check({ content: '   \n ' })).not.toHaveLength(0);
  });
  it(`rejects content over ${COMMENT_MAX_LENGTH} characters but accepts exactly the limit`, async () => {
    expect(await check({ content: 'a'.repeat(COMMENT_MAX_LENGTH) })).toHaveLength(0);
    expect(await check({ content: 'a'.repeat(COMMENT_MAX_LENGTH + 1) })).not.toHaveLength(0);
  });
  it('rejects a non-UUID parent_id', async () => {
    expect(await check({ content: 'x', parent_id: 'nope' })).not.toHaveLength(0);
  });
  it('accepts an omitted or valid request key and rejects an invalid key', async () => {
    expect(await check({ content: 'x' })).toHaveLength(0);
    expect(await check({ content: 'x', client_request_id: REQUEST })).toHaveLength(0);
    expect(await check({ content: 'x', client_request_id: 'invalid-request' })).not.toHaveLength(0);
  });
});