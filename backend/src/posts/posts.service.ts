import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreatePostDto, UpdatePostDto } from './dto/create-post.dto';
import { PostQueryDto } from './dto/post-query.dto';
import { ShareJourneyDto } from './dto/share-journey.dto';
import { journeyPostAccess, postAccess } from './post-access';
import { SavedPostQueryDto } from './dto/saved-post-query.dto';

const POST_FIELDS = `p.id, p.author_id, p.location_id, p.content, p.images, p.rating, p.visited_at, p.visibility,
  p.likes_count, p.saves_count, p.comments_count, p.created_at, p.updated_at, p.post_type, p.journey_id, p.preview_revision,
  json_build_object('id', author.id, 'username', author.username, 'display_name', author.display_name, 'avatar_url', author.avatar_url,
    'is_following', ($1::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM follows fo WHERE fo.follower_id = $1 AND fo.following_id = author.id))) AS author,
  CASE WHEN l.id IS NOT NULL THEN json_build_object('id', l.id, 'name', l.name, 'city', l.city, 'country', l.country, 'category', l.category,
    'coordinates', json_build_object('lat', ST_Y(l.coordinates), 'lng', ST_X(l.coordinates))) END AS location,
  (SELECT json_build_object('id', j.id, 'title', j.title, 'revision', j.revision, 'visibility', j.visibility, 'status', j.status,
    'stop_count', (SELECT count(*)::integer FROM journey_stops s WHERE s.journey_id = j.id),
    'preview_names', COALESCE((SELECT json_agg(names.location_name_snapshot ORDER BY names.stop_order) FROM
      (SELECT location_name_snapshot, stop_order FROM journey_stops s WHERE s.journey_id = j.id ORDER BY stop_order LIMIT 3) names), '[]'::json))
    FROM journeys j WHERE j.id = p.journey_id) AS journey,
  ($1::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM likes li WHERE li.post_id = p.id AND li.user_id = $1)) AS is_liked,
  ($1::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM saves sa WHERE sa.post_id = p.id AND sa.user_id = $1)) AS is_saved`;

@Injectable()
export class PostsService {
  constructor(private readonly db: DatabaseService) {}

  async mineByLocation(userId: string, locationId: string, query: SavedPostQueryDto) {
    const { page, pageSize } = query;
    const where = "p.author_id = $1 AND p.location_id = $2 AND p.post_type = 'location' AND u.is_active = true";
    const [data, count] = await Promise.all([
      this.db.query(`SELECT p.id, p.author_id, p.location_id, p.content, p.visited_at::text AS visited_at, p.visibility, p.created_at
        FROM posts p JOIN users u ON u.id = p.author_id WHERE ${where}
        ORDER BY p.created_at DESC, p.id DESC LIMIT $3 OFFSET $4`, [userId, locationId, pageSize, (page - 1) * pageSize]),
      this.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM posts p JOIN users u ON u.id = p.author_id WHERE ${where}`, [userId, locationId]),
    ]);
    return this.paginated(data.rows, Number(count.rows[0]?.count ?? 0), page, pageSize);
  }

  async saved(userId: string, query: SavedPostQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 12;
    const where = `s.user_id = $1 AND ${postAccess()}`;
    const [data, count] = await Promise.all([
      this.db.query(`SELECT ${POST_FIELDS} FROM saves s JOIN posts p ON p.id = s.post_id
        JOIN profiles author ON author.id = p.author_id LEFT JOIN locations l ON l.id = p.location_id
        WHERE ${where} ORDER BY s.created_at DESC, p.id DESC LIMIT $2 OFFSET $3`,
      [userId, pageSize, (page - 1) * pageSize]),
      this.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM saves s JOIN posts p ON p.id = s.post_id
        WHERE ${where}`, [userId]),
    ]);
    return this.paginated(data.rows, Number(count.rows[0]?.count ?? 0), page, pageSize);
  }

  async feed(query: PostQueryDto, viewerId?: string) {
    const page = query.page ?? 1; const pageSize = query.pageSize ?? 12; const offset = (page - 1) * pageSize;
    const filterValues: unknown[] = [];
    const dataConditions = ["p.visibility = 'public'", journeyPostAccess()];
    const countConditions = ["p.visibility = 'public'", journeyPostAccess()];
    if (query.author_id) {
      filterValues.push(query.author_id);
      dataConditions.push(`p.author_id = $${filterValues.length + 1}`);
      countConditions.push(`p.author_id = $${filterValues.length}`);
    }
    if (query.location_id) {
      filterValues.push(query.location_id);
      dataConditions.push(`p.location_id = $${filterValues.length + 1}`);
      countConditions.push(`p.location_id = $${filterValues.length}`);
    }
    const dataWhere = dataConditions.join(' AND ');
    const countWhere = countConditions.join(' AND ');
    const [data, count] = await Promise.all([
      this.db.query(`SELECT ${POST_FIELDS} FROM posts p JOIN profiles author ON author.id = p.author_id LEFT JOIN locations l ON l.id = p.location_id
        WHERE ${dataWhere} ORDER BY p.created_at DESC, p.id DESC LIMIT $${filterValues.length + 2} OFFSET $${filterValues.length + 3}`,
        [viewerId ?? null, ...filterValues, pageSize, offset]),
      this.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM posts p WHERE ${countWhere}`, filterValues),
    ]);
    return this.paginated(data.rows, Number(count.rows[0]?.count ?? 0), page, pageSize);
  }

  async followingFeed(userId: string, query: PostQueryDto) {
    const page = query.page ?? 1; const pageSize = query.pageSize ?? 12; const offset = (page - 1) * pageSize;
    const values: unknown[] = [userId];
    const conditions = ["p.visibility IN ('public', 'followers')", journeyPostAccess(), 'EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = p.author_id)'];
    if (query.location_id) { values.push(query.location_id); conditions.push(`p.location_id = $${values.length}`); }
    const where = conditions.join(' AND ');
    const [data, count] = await Promise.all([
      this.db.query(`SELECT ${POST_FIELDS} FROM posts p JOIN profiles author ON author.id = p.author_id LEFT JOIN locations l ON l.id = p.location_id
       WHERE ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
       [...values, pageSize, offset]),
      this.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM posts p WHERE ${where}`, values),
    ]);
    return this.paginated(data.rows, Number(count.rows[0]?.count ?? 0), page, pageSize);
  }

  async byLocation(locationId: string, page = 1, pageSize = 12) {
    const safePage = Math.max(1, page); const safeSize = Math.min(Math.max(1, pageSize), 50); const offset = (safePage - 1) * safeSize;
    const values = [null, locationId, safeSize, offset];
    const [data, count] = await Promise.all([
      this.db.query(`SELECT ${POST_FIELDS} FROM posts p JOIN profiles author ON author.id = p.author_id LEFT JOIN locations l ON l.id = p.location_id
       WHERE p.location_id = $2 AND p.visibility = 'public' AND ${journeyPostAccess()} ORDER BY p.created_at DESC, p.id DESC LIMIT $3 OFFSET $4`, values),
      this.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM posts p WHERE p.location_id = $1 AND p.visibility = 'public' AND ${journeyPostAccess()}`, [locationId]),
    ]);
    return this.paginated(data.rows, Number(count.rows[0]?.count ?? 0), safePage, safeSize);
  }

  async byAuthor(username: string, page = 1, pageSize = 12, viewerId?: string) {
    const profile = await this.db.query<{ id: string }>('SELECT id FROM profiles WHERE lower(username) = lower($1)', [username]);
    if (!profile.rows[0]) throw new NotFoundException('Profile not found.');
    const safePage = Math.max(1, page); const safeSize = Math.min(Math.max(1, pageSize), 50); const offset = (safePage - 1) * safeSize;
    const values: unknown[] = [viewerId ?? null, profile.rows[0].id];
    const where = `(${postAccess()}) AND p.author_id = $2`;
    const [data, count] = await Promise.all([
      this.db.query(`SELECT ${POST_FIELDS} FROM posts p JOIN profiles author ON author.id = p.author_id LEFT JOIN locations l ON l.id = p.location_id
       WHERE ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT $3 OFFSET $4`, [...values, safeSize, offset]),
      this.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM posts p WHERE ${where}`, values),
    ]);
    return this.paginated(data.rows, Number(count.rows[0]?.count ?? 0), safePage, safeSize);
  }

  async getById(id: string, viewerId?: string) {
    const result = await this.db.query(
      `SELECT ${POST_FIELDS} FROM posts p JOIN profiles author ON author.id = p.author_id LEFT JOIN locations l ON l.id = p.location_id
       WHERE p.id = $2 AND ${postAccess()}`,
      [viewerId ?? null, id],
    );
    if (!result.rows[0]) throw new NotFoundException('Post not found.');
    return result.rows[0];
  }


  /** Throws 404 unless the viewer may see the post (same rules as getById, without loading it). */
  async assertVisible(postId: string, viewerId?: string): Promise<void> {
    const result = await this.db.query(
      `SELECT 1 FROM posts p WHERE p.id = $2 AND ${postAccess()}`,
      [viewerId ?? null, postId],
    );
    if (!result.rows[0]) throw new NotFoundException('Post not found.');
  }

  async sharedJourney(userId: string, journeyId: string) {
    const result = await this.db.query<{ id: string }>(
      'SELECT p.id FROM posts p JOIN journeys j ON j.id = p.journey_id WHERE j.id = $1 AND j.user_id = $2',
      [journeyId, userId],
    );
    return { post: result.rows[0] ? await this.getById(result.rows[0].id, userId) : null };
  }

  async shareJourney(userId: string, dto: ShareJourneyDto) {
    const result = await this.db.transaction(async (client) => {
      // Same lock order as Journey edits: owner, then Journey. Concurrent retries serialize here.
      const owner = await client.query('SELECT id FROM users WHERE id = $1 AND is_active = true FOR UPDATE', [userId]);
      if (!owner.rowCount) throw new NotFoundException('Không tìm thấy hành trình.');
      const journey = await client.query<{ status: string; visibility: string; revision: number }>(
        'SELECT status, visibility, revision FROM journeys WHERE id = $1 AND user_id = $2 FOR UPDATE', [dto.journey_id, userId],
      );
      const current = journey.rows[0];
      if (!current) throw new NotFoundException('Không tìm thấy hành trình.');
      if (current.status !== 'published' || current.visibility !== 'public')
        throw new ForbiddenException('Chỉ chia sẻ hành trình đã lưu ở trạng thái công khai. Hãy chỉnh sửa hành trình trước.');
      const existing = await client.query<{ id: string }>('SELECT id FROM posts WHERE journey_id = $1', [dto.journey_id]);
      if (existing.rows[0]) return { id: existing.rows[0].id, created: false };
      if (current.revision !== dto.revision)
        throw new ConflictException('Hành trình đã thay đổi. Hãy tải lại để xem preview mới trước khi đăng.');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO posts (author_id, post_type, journey_id, preview_revision, content, images, visibility)
          VALUES ($1, 'journey', $2, $3, $4, $5, 'public') RETURNING id`,
        [userId, dto.journey_id, dto.revision, dto.content.trim(), [dto.preview_image_url]],
      );
      return { id: inserted.rows[0].id, created: true };
    });
    return { post: await this.getById(result.id, userId), created: result.created };
  }

  async create(userId: string, dto: CreatePostDto) {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO posts (author_id, location_id, content, images, rating, visited_at, visibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [userId, dto.location_id, dto.content.trim(), dto.images ?? [], dto.rating, dto.visited_at, dto.visibility ?? 'public'],
    );
    return this.getById(result.rows[0].id, userId);
  }

  async update(userId: string, postId: string, dto: UpdatePostDto) {
    const current = await this.db.query<{ author_id: string; post_type: string }>('SELECT author_id, post_type FROM posts WHERE id = $1', [postId]);
    if (!current.rows[0]) throw new NotFoundException('Post not found.');
    if (current.rows[0].author_id !== userId) throw new ForbiddenException('You can only edit your own posts.');
    if (current.rows[0].post_type === 'journey' && (dto.rating !== undefined || dto.visited_at !== undefined))
      throw new BadRequestException('Bài hành trình không có đánh giá hoặc ngày ghé thăm riêng.');
    const mapping: Array<[keyof UpdatePostDto, string, unknown]> = [
      ['content', 'content', dto.content?.trim()], ['images', 'images', dto.images], ['rating', 'rating', dto.rating],
      ['visited_at', 'visited_at', dto.visited_at], ['visibility', 'visibility', dto.visibility],
    ];
    const values: unknown[] = [postId]; const assignments: string[] = [];
    for (const [key, column, value] of mapping) {
      if (dto[key] !== undefined) { values.push(value); assignments.push(`${column} = $${values.length}`); }
    }
    if (!assignments.length) return this.getById(postId, userId);
    await this.db.query(`UPDATE posts SET ${assignments.join(', ')} WHERE id = $1`, values);
    return this.getById(postId, userId);
  }

  async delete(userId: string, postId: string) {
    const current = await this.db.query<{ author_id: string }>('SELECT author_id FROM posts WHERE id = $1', [postId]);
    if (!current.rows[0]) throw new NotFoundException('Post not found.');
    if (current.rows[0].author_id !== userId) throw new ForbiddenException('You can only delete your own posts.');
    await this.db.query('DELETE FROM posts WHERE id = $1', [postId]);
    return { deleted: true };
  }

  async setLike(userId: string, postId: string, liked: boolean) {
    await this.getById(postId, userId);
    if (liked) {
      await this.db.query('INSERT INTO likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, postId]);
    } else {
      await this.db.query('DELETE FROM likes WHERE user_id = $1 AND post_id = $2', [userId, postId]);
    }
    const result = await this.db.query<{ likes_count: number }>('SELECT likes_count FROM posts WHERE id = $1', [postId]);
    return { liked, likes_count: result.rows[0]?.likes_count ?? 0 };
  }

  async setSave(userId: string, postId: string, saved: boolean) {
    await this.getById(postId, userId);
    if (saved) await this.db.query('INSERT INTO saves (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, postId]);
    else await this.db.query('DELETE FROM saves WHERE user_id = $1 AND post_id = $2', [userId, postId]);
    const result = await this.db.query<{ saves_count: number }>('SELECT saves_count FROM posts WHERE id = $1', [postId]);
    return { saved, saves_count: result.rows[0]?.saves_count ?? 0 };
  }

  private paginated(data: unknown[], count: number, page: number, pageSize: number) {
    const offset = (page - 1) * pageSize;
    return { data, count, page, pageSize, hasMore: offset + data.length < count };
  }
}
