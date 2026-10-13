import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreatePostDto, UpdatePostDto } from './dto/create-post.dto';
import { PostQueryDto } from './dto/post-query.dto';

const POST_FIELDS = `p.id, p.author_id, p.location_id, p.content, p.images, p.rating, p.visited_at, p.visibility,
  p.likes_count, p.saves_count, p.created_at, p.updated_at,
  json_build_object('id', author.id, 'username', author.username, 'display_name', author.display_name, 'avatar_url', author.avatar_url) AS author,
  json_build_object('id', l.id, 'name', l.name, 'city', l.city, 'country', l.country, 'category', l.category,
    'coordinates', json_build_object('lat', ST_Y(l.coordinates), 'lng', ST_X(l.coordinates))) AS location,
  ($1::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM likes li WHERE li.post_id = p.id AND li.user_id = $1)) AS is_liked,
  ($1::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM saves sa WHERE sa.post_id = p.id AND sa.user_id = $1)) AS is_saved`;

@Injectable()
export class PostsService {
  constructor(private readonly db: DatabaseService) {}

  async feed(query: PostQueryDto, viewerId?: string) {
    const page = query.page ?? 1; const pageSize = query.pageSize ?? 12; const offset = (page - 1) * pageSize;
    const filterValues: unknown[] = [];
    const dataConditions = ["p.visibility = 'public'"];
    const countConditions = ["p.visibility = 'public'"];
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
      this.db.query(`SELECT ${POST_FIELDS} FROM posts p JOIN profiles author ON author.id = p.author_id JOIN locations l ON l.id = p.location_id
        WHERE ${dataWhere} ORDER BY p.created_at DESC, p.id DESC LIMIT $${filterValues.length + 2} OFFSET $${filterValues.length + 3}`,
        [viewerId ?? null, ...filterValues, pageSize, offset]),
      this.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM posts p WHERE ${countWhere}`, filterValues),
    ]);
    return this.paginated(data.rows, Number(count.rows[0]?.count ?? 0), page, pageSize);
  }

  async followingFeed(userId: string, query: PostQueryDto) {
    const page = query.page ?? 1; const pageSize = query.pageSize ?? 12; const offset = (page - 1) * pageSize;
    const values: unknown[] = [userId];
    const conditions = ["p.visibility IN ('public', 'followers')", 'EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = p.author_id)'];
    if (query.location_id) { values.push(query.location_id); conditions.push(`p.location_id = $${values.length}`); }
    const where = conditions.join(' AND ');
    const [data, count] = await Promise.all([
      this.db.query(`SELECT ${POST_FIELDS} FROM posts p JOIN profiles author ON author.id = p.author_id JOIN locations l ON l.id = p.location_id
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
      this.db.query(`SELECT ${POST_FIELDS} FROM posts p JOIN profiles author ON author.id = p.author_id JOIN locations l ON l.id = p.location_id
       WHERE p.location_id = $2 AND p.visibility = 'public' ORDER BY p.created_at DESC, p.id DESC LIMIT $3 OFFSET $4`, values),
      this.db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM posts WHERE location_id = $1 AND visibility = 'public'", [locationId]),
    ]);
    return this.paginated(data.rows, Number(count.rows[0]?.count ?? 0), safePage, safeSize);
  }

  async byAuthor(username: string, page = 1, pageSize = 12, viewerId?: string) {
    const profile = await this.db.query<{ id: string }>('SELECT id FROM profiles WHERE lower(username) = lower($1)', [username]);
    if (!profile.rows[0]) throw new NotFoundException('Profile not found.');
    const safePage = Math.max(1, page); const safeSize = Math.min(Math.max(1, pageSize), 50); const offset = (safePage - 1) * safeSize;
    const values: unknown[] = [viewerId ?? null, profile.rows[0].id];
    const where = `(p.visibility = 'public' OR p.author_id = $1 OR (p.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = p.author_id))) AND p.author_id = $2`;
    const [data, count] = await Promise.all([
      this.db.query(`SELECT ${POST_FIELDS} FROM posts p JOIN profiles author ON author.id = p.author_id JOIN locations l ON l.id = p.location_id
       WHERE ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT $3 OFFSET $4`, [...values, safeSize, offset]),
      this.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM posts p WHERE ${where}`, values),
    ]);
    return this.paginated(data.rows, Number(count.rows[0]?.count ?? 0), safePage, safeSize);
  }

  async getById(id: string, viewerId?: string) {
    const result = await this.db.query(
      `SELECT ${POST_FIELDS} FROM posts p JOIN profiles author ON author.id = p.author_id JOIN locations l ON l.id = p.location_id
       WHERE p.id = $2 AND (p.visibility = 'public' OR p.author_id = $1 OR
         (p.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = p.author_id)))`,
      [viewerId ?? null, id],
    );
    if (!result.rows[0]) throw new NotFoundException('Post not found.');
    return result.rows[0];
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
    const current = await this.db.query<{ author_id: string }>('SELECT author_id FROM posts WHERE id = $1', [postId]);
    if (!current.rows[0]) throw new NotFoundException('Post not found.');
    if (current.rows[0].author_id !== userId) throw new ForbiddenException('You can only edit your own posts.');
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
