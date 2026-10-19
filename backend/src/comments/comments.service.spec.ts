import { BadRequestException, NotFoundException } from '@nestjs/common';
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

function setup(rows: Record<string, unknown[]>) {
  const query = jest.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.startsWith('SELECT id, post_id, parent_id FROM comments')) return { rows: rows.parent ?? [] };
    if (sql.startsWith('INSERT INTO comments')) return { rows: [{ id: 'new-comment' }] };
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
});