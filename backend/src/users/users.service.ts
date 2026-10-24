import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VisitedLocationsService } from '../visited-locations/visited-locations.service';
import { MessagingPolicyService } from '../messaging/messaging-policy.service';
import { MessagingEventPublisher } from '../messaging/messaging-events.publisher';
import { relationshipFields } from '../messaging/messaging-access';

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService, private readonly visited: VisitedLocationsService,
    private readonly messagingPolicy: MessagingPolicyService, private readonly messagingEvents: MessagingEventPublisher) {}

  async getById(userId: string) {
    const result = await this.db.query(
      `SELECT p.id, u.email, p.username, p.display_name, p.avatar_url, p.bio, p.home_city, p.country_count, p.total_posts,
              p.followers_count, p.following_count, p.created_at,
              (SELECT count(*)::integer FROM user_visited_locations v WHERE v.user_id = p.id) AS visited_location_count
       FROM profiles p JOIN users u ON u.id = p.id WHERE p.id = $1 AND u.is_active = true`, [userId],
    );
    if (!result.rows[0]) throw new NotFoundException('Profile not found.');
    return result.rows[0];
  }

  async getByUsername(username: string, viewerId?: string) {
    const result = await this.db.query(
      `SELECT p.id, p.username, p.display_name, p.avatar_url, p.bio, p.home_city, p.total_posts,
              (SELECT count(*)::integer FROM user_visited_locations v WHERE v.user_id = p.id
                AND (v.visibility = 'public' OR v.user_id = $2::uuid)) AS visited_location_count,
              (SELECT count(DISTINCT NULLIF(trim(l.country), ''))::integer FROM user_visited_locations v
                JOIN locations l ON l.id = v.location_id WHERE v.user_id = p.id
                AND (v.visibility = 'public' OR v.user_id = $2::uuid)) AS country_count,
              p.followers_count, p.following_count, p.created_at,
              ${relationshipFields('$2::uuid', 'p.id')}
       FROM profiles p JOIN users u ON u.id = p.id AND u.is_active = true WHERE lower(p.username) = lower($1)`, [username, viewerId ?? null],
    );
    if (!result.rows[0]) throw new NotFoundException('Profile not found.');
    return result.rows[0];
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    const fields: string[] = [];
    const values: unknown[] = [userId];
    if (dto.username !== undefined) { values.push(dto.username.trim()); fields.push(`username = $${values.length}`); }
    if (dto.display_name !== undefined) { values.push(dto.display_name.trim()); fields.push(`display_name = $${values.length}`); }
    if (dto.bio !== undefined) { values.push(dto.bio?.trim() || null); fields.push(`bio = $${values.length}`); }
    if (dto.avatar_url !== undefined) { values.push(dto.avatar_url || null); fields.push(`avatar_url = $${values.length}`); }
    if (dto.home_city !== undefined) { values.push(dto.home_city?.trim() || null); fields.push(`home_city = $${values.length}`); }
    if (fields.length === 0) throw new BadRequestException('Provide at least one profile field to update.');
    const result = await this.db.query(
      `UPDATE profiles SET ${fields.join(', ')} WHERE id = $1
       RETURNING id, username, display_name, avatar_url, bio, home_city, country_count, total_posts, followers_count, following_count, created_at,
         (SELECT count(*)::integer FROM user_visited_locations v WHERE v.user_id = profiles.id) AS visited_location_count`, values,
    ).catch((error: unknown) => {
      const dbError = error as { code?: string; constraint?: string };
      // The existing unique index also handles concurrent requests for the same username.
      if (dbError?.code === '23505' && dbError.constraint === 'profiles_username_lower_unique') {
        throw new ConflictException({ code: 'USERNAME_TAKEN', message: 'Tên người dùng đã được sử dụng.' });
      }
      throw error;
    });
    if (!result.rows[0]) throw new NotFoundException('Profile not found.');
    return result.rows[0];
  }

  async follow(userId: string, username: string) {
    return this.setFollowing(userId, username, true);
  }

  async unfollow(userId: string, username: string) {
    return this.setFollowing(userId, username, false);
  }

  private async setFollowing(userId: string, username: string, following: boolean) {
    const target = await this.findIdByUsername(username);
    if (target.id === userId) throw new BadRequestException('You cannot follow yourself.');
    const changed = await this.db.transaction(async (client) => {
      // Serialize unfollow with send/direct so the permission cannot change mid-send.
      await this.messagingPolicy.lockPair(client, userId, target.id);
      const active = await this.messagingPolicy.lockAccounts(client, userId, target.id);
      if (following && !active) throw new NotFoundException('Profile not found.');
      const result = following
        ? await client.query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, target.id])
        : await client.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [userId, target.id]);
      return !!result.rowCount;
    });
    if (changed) await this.messagingEvents.policy(userId, target.id);
    return { following, changed };
  }

  async listRelations(username: string, relation: 'followers' | 'following', page = 1, pageSize = 20, viewerId?: string) {
    const target = await this.findIdByUsername(username);
    const safePage = Math.max(1, page);
    const safeSize = Math.min(Math.max(1, pageSize), 50);
    const offset = (safePage - 1) * safeSize;
    const where = relation === 'followers' ? 'f.following_id = $1' : 'f.follower_id = $1';
    const joinColumn = relation === 'followers' ? 'f.follower_id' : 'f.following_id';
    const [items, count] = await Promise.all([
      this.db.query(
        `SELECT p.id, p.username, p.display_name, p.avatar_url, p.bio, p.followers_count,
           ${relationshipFields('$4::uuid', 'p.id')}
         FROM follows f JOIN profiles p ON p.id = ${joinColumn}
         JOIN users u ON u.id = p.id AND u.is_active = true
         WHERE ${where} ORDER BY f.created_at DESC, p.id DESC LIMIT $2 OFFSET $3`, [target.id, safeSize, offset, viewerId ?? null],
      ),
      this.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM follows f
        JOIN users u ON u.id = ${joinColumn} AND u.is_active = true WHERE ${where}`, [target.id]),
    ]);
    const total = Number(count.rows[0]?.count ?? 0);
    return { data: items.rows, count: total, page: safePage, pageSize: safeSize, hasMore: offset + items.rows.length < total };
  }

  async getPins(userId: string, status?: 'visited' | 'wishlist') {
    const result = await this.db.query(
      `WITH pins AS (
         SELECT user_id, location_id, 'visited'::text AS status, created_at FROM user_visited_locations WHERE user_id = $1
         UNION ALL
         SELECT up.user_id, up.location_id, up.status, up.created_at FROM user_pins up
         WHERE up.user_id = $1 AND up.status = 'wishlist'
           AND NOT EXISTS (SELECT 1 FROM user_visited_locations v WHERE v.user_id = up.user_id AND v.location_id = up.location_id)
       ) SELECT l.id, l.name, l.address, l.country, l.city, l.category, l.google_place_id,
              l.post_count, l.avg_rating, l.trending_score, l.created_at,
              json_build_object('lat', ST_Y(l.coordinates), 'lng', ST_X(l.coordinates)) AS coordinates,
              up.status, up.created_at AS pinned_at
       FROM pins up JOIN locations l ON l.id = up.location_id
       WHERE up.user_id = $1 AND ($2::text IS NULL OR up.status = $2)
       ORDER BY up.created_at DESC, l.id DESC`, [userId, status ?? null],
    );
    return result.rows;
  }

  async upsertPin(userId: string, locationId: string, status: 'visited' | 'wishlist') {
    if (status === 'visited') {
      const mark = await this.visited.create(userId, { location_id: locationId });
      return { user_id: userId, location_id: locationId, status, created_at: mark.created_at, updated_at: mark.updated_at };
    }
    return this.visited.withOwner(userId, async (client) => {
      const location = await client.query('SELECT id FROM locations WHERE id = $1 FOR KEY SHARE', [locationId]);
      if (!location.rowCount) throw new NotFoundException('Location not found.');
      const result = await client.query(`INSERT INTO user_pins (user_id, location_id, status) VALUES ($1, $2, 'wishlist')
        ON CONFLICT (user_id, location_id) DO UPDATE SET status = EXCLUDED.status
        RETURNING user_id, location_id, status, created_at, updated_at`, [userId, locationId]);
      return result.rows[0];
    });
  }

  async removePin(userId: string, locationId: string) {
    return this.visited.withOwner(userId, async (client) => {
      const marks = await client.query('DELETE FROM user_visited_locations WHERE user_id = $1 AND location_id = $2', [userId, locationId]);
      const pins = await client.query('DELETE FROM user_pins WHERE user_id = $1 AND location_id = $2', [userId, locationId]);
      return { removed: (marks.rowCount ?? 0) + (pins.rowCount ?? 0) > 0 };
    });
  }

  private async findIdByUsername(username: string) {
    const result = await this.db.query<{ id: string }>('SELECT id FROM profiles WHERE lower(username) = lower($1)', [username]);
    if (!result.rows[0]) throw new NotFoundException('Profile not found.');
    return result.rows[0];
  }
}
