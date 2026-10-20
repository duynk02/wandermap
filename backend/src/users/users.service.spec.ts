import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UsersService } from './users.service';

describe('UsersService profile editing', () => {
  let db: { query: jest.Mock };
  let service: UsersService;

  beforeEach(() => {
    db = { query: jest.fn() };
    service = new UsersService(db as unknown as DatabaseService);
  });

  it('updates only the authenticated ID and binds profile content as parameters', async () => {
    const profile = { id: 'owner-id', username: 'new_name', display_name: "O'Brien" };
    db.query.mockResolvedValue({ rows: [profile] });
    await expect(service.updateMe('owner-id', {
      username: ' new_name ', display_name: " O'Brien ", bio: ' Travel ', home_city: ' Huế ',
    })).resolves.toEqual(profile);
    const [sql, values] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE id = $1');
    expect(sql).not.toContain("O'Brien");
    expect(values).toEqual(['owner-id', 'new_name', "O'Brien", 'Travel', 'Huế']);
  });

  it('clears optional fields and the avatar without touching omitted fields', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'owner-id' }] });
    await service.updateMe('owner-id', { bio: '', avatar_url: null, home_city: null });
    const [sql, values] = db.query.mock.calls[0];
    expect(values).toEqual(['owner-id', null, null, null]);
    expect(sql.split('RETURNING')[0]).not.toMatch(/username\s*=|display_name\s*=/);
  });

  it('rejects an empty update before querying the database', async () => {
    await expect(service.updateMe('owner-id', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('turns the username unique-index conflict into a specific client error', async () => {
    db.query.mockRejectedValue({ code: '23505', constraint: 'profiles_username_lower_unique' });
    try {
      await service.updateMe('owner-id', { username: 'taken_name' });
      throw new Error('Expected a username conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        code: 'USERNAME_TAKEN', message: 'Tên người dùng đã được sử dụng.',
      });
    }
  });

  it('does not misclassify unrelated database failures as username conflicts', async () => {
    const failure = { code: '08006' };
    db.query.mockRejectedValue(failure);
    await expect(service.updateMe('owner-id', { bio: 'Travel' })).rejects.toBe(failure);
  });

  it('reports a missing profile instead of claiming success', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await expect(service.updateMe('missing-id', { bio: 'Travel' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
