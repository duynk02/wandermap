import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  async getById(userId: string) {
    const result = await this.db.query(
      `SELECT p.id, u.email, p.username, p.display_name, p.avatar_url, p.bio, p.country_count, p.total_posts,
              p.followers_count, p.following_count, p.created_at
       FROM profiles p JOIN users u ON u.id = p.id WHERE p.id = $1 AND u.is_active = true`, [userId],
    );
    if (!result.rows[0]) throw new NotFoundException('Profile not found.');
    return result.rows[0];
  }

  async getByUsername(username: string, viewerId?: string) {
    const result = await this.db.query(
      `SELECT p.id, p.username, p.display_name, p.avatar_url, p.bio, p.country_count, p.total_posts,
              p.followers_count, p.following_count, p.created_at,
              ($2::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $2 AND f.following_id = p.id)) AS is_following
       FROM profiles p JOIN users u ON u.id = p.id AND u.is_active = true WHERE lower(p.username) = lower($1)`, [username, viewerId ?? null],
    );
    if (!result.rows[0]) throw new NotFoundException('Profile not found.');
    return result.rows[0];
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    const fields: string[] = [];
    const values: unknown[] = [userId];
    if (dto.display_name !== undefined) { values.push(dto.display_name.trim()); fields.push(`display_name = $${values.length}`); }
    if (dto.bio !== undefined) { values.push(dto.bio?.trim() || null); fields.push(`bio = $${values.length}`); }
    if (dto.avatar_url !== undefined) { values.push(dto.avatar_url || null); fields.push(`avatar_url = $${values.length}`); }
    if (fields.length === 0) throw new BadRequestException('Provide at least one profile field to update.');
    const result = await this.db.query(
      `UPDATE profiles SET ${fields.join(', ')} WHERE id = $1
       RETURNING id, username, display_name, avatar_url, bio, country_count, total_posts, followers_count, following_count, created_at`, values,
    );
    if (!result.rows[0]) throw new NotFoundException('Profile not found.');
    return result.rows[0];
  }

  async follow(userId: string, username: string) {
    const target = await this.findIdByUsername(username);
    if (target.id === userId) throw new BadRequestException('You cannot follow yourself.');
    const result = await this.db.query(
      'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING follower_id', [userId, target.id],
    );
    return { following: true, changed: (result.rowCount ?? 0) > 0 };
  }

  async unfollow(userId: string, username: string) {
    const target = await this.findIdByUsername(username);
    const result = await this.db.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [userId, target.id]);
    return { following: false, changed: (result.rowCount ?? 0) > 0 };
  }

  async listRelations(username: string, relation: 'followers' | 'following', page = 1, pageSize = 20) {
    const target = await this.findIdByUsername(username);
    const safePage = Math.max(1, page);
    const safeSize = Math.min(Math.max(1, pageSize), 50);
    const offset = (safePage - 1) * safeSize;
    const where = relation === 'followers' ? 'f.following_id = $1' : 'f.follower_id = $1';
    const joinColumn = relation === 'followers' ? 'f.follower_id' : 'f.following_id';
    const [items, count] = await Promise.all([
      this.db.query(
        `SELECT p.id, p.username, p.display_name, p.avatar_url, p.bio, p.followers_count
         FROM follows f JOIN profiles p ON p.id = ${joinColumn}
         WHERE ${where} ORDER BY f.created_at DESC LIMIT $2 OFFSET $3`, [target.id, safeSize, offset],
      ),
      this.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM follows f WHERE ${where}`, [target.id]),
    ]);
    const total = Number(count.rows[0]?.count ?? 0);
    return { data: items.rows, count: total, page: safePage, pageSize: safeSize, hasMore: offset + items.rows.length < total };
  }

  async getPins(userId: string, status?: 'visited' | 'wishlist') {
    const result = await this.db.query(
      `SELECT l.id, l.name, l.address, l.country, l.city, l.category, l.google_place_id,
              l.post_count, l.avg_rating, l.trending_score, l.created_at,
              json_build_object('lat', ST_Y(l.coordinates), 'lng', ST_X(l.coordinates)) AS coordinates,
              up.status, up.created_at AS pinned_at
       FROM user_pins up JOIN locations l ON l.id = up.location_id
       WHERE up.user_id = $1 AND ($2::text IS NULL OR up.status = $2)
       ORDER BY up.created_at DESC`, [userId, status ?? null],
    );
    return result.rows;
  }

  async upsertPin(userId: string, locationId: string, status: 'visited' | 'wishlist') {
    const result = await this.db.query(
      `INSERT INTO user_pins (user_id, location_id, status) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, location_id) DO UPDATE SET status = EXCLUDED.status
       RETURNING user_id, location_id, status, created_at, updated_at`, [userId, locationId, status],
    ).catch((error: any) => {
      if (error?.code === '23503') throw new NotFoundException('Location not found.');
      throw error;
    });
    return result.rows[0];
  }

  async removePin(userId: string, locationId: string) {
    const result = await this.db.query('DELETE FROM user_pins WHERE user_id = $1 AND location_id = $2', [userId, locationId]);
    return { removed: (result.rowCount ?? 0) > 0 };
  }

  private async findIdByUsername(username: string) {
    const result = await this.db.query<{ id: string }>('SELECT id FROM profiles WHERE lower(username) = lower($1)', [username]);
    if (!result.rows[0]) throw new NotFoundException('Profile not found.');
    return result.rows[0];
  }
}
