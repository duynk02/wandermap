import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { CreateVisitDto, CreateVisitedLocationDto, TravelFiltersDto, UpdateVisitDto, UpdateVisitedLocationDto, VisitQueryDto, VisitedLocationQueryDto } from './dto/visited-location.dto';

export interface VisitedLocationResponse {
  id: string;
  user_id: string;
  location_id: string;
  note: string | null;
  visibility: 'public' | 'private';
  created_at: string;
  updated_at: string;
  visit_count: number;
  last_visited_at: string | null;
  location: {
    id: string; name: string; address: string | null; country: string | null; city: string | null;
    category: string; coordinates: { lat: number; lng: number };
  };
}

export interface LocationVisitResponse {
  id: string;
  visited_location_id: string;
  visited_at: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

const dateFilter = (alias: string) => `($4::integer IS NULL OR (${alias}.visited_at >= make_date($4, 1, 1) AND ${alias}.visited_at < make_date($4 + 1, 1, 1)))`;
const markFields = (filtered = false) => `v.id, v.user_id, v.location_id, v.note, v.visibility, v.created_at, v.updated_at,
  (SELECT count(*)::integer FROM user_location_visits visit WHERE visit.visited_location_id = v.id ${filtered ? `AND ${dateFilter('visit')}` : ''}) AS visit_count,
  (SELECT max(visit.visited_at)::text FROM user_location_visits visit WHERE visit.visited_location_id = v.id ${filtered ? `AND ${dateFilter('visit')}` : ''}) AS last_visited_at,
  json_build_object('id', l.id, 'name', l.name, 'address', l.address, 'country', l.country, 'city', l.city, 'category', l.category,
    'coordinates', json_build_object('lat', ST_Y(l.coordinates), 'lng', ST_X(l.coordinates))) AS location`;
const MARK_FIELDS = markFields();
const VISIBLE = `v.user_id = $1 AND u.is_active = true AND (v.user_id = $2::uuid OR v.visibility = 'public')`;
const FILTERED = `${VISIBLE} AND ($3::uuid IS NULL OR v.location_id = $3)
  AND ($4::integer IS NULL OR EXISTS (SELECT 1 FROM user_location_visits d WHERE d.visited_location_id = v.id AND ${dateFilter('d')}))
  AND ($5::text IS NULL OR strpos(lower(public.unaccent(concat_ws(' ', l.name, l.city, l.country))), lower(public.unaccent($5))) > 0)
  AND ($6::text IS NULL OR l.country = $6)`;
const VISIT_FIELDS = 'id, visited_location_id, visited_at::text, note, created_at, updated_at';

@Injectable()
export class VisitedLocationsService {
  constructor(private readonly db: DatabaseService) {}

  async listMine(userId: string, query: VisitedLocationQueryDto) {
    return this.list(userId, userId, query);
  }

  async listPublic(username: string, viewerId: string | undefined, query: VisitedLocationQueryDto) {
    const owner = await this.findOwner(username);
    return this.list(owner, viewerId, query);
  }

  private async findOwner(username: string) {
    const owner = await this.db.query<{ id: string }>(`SELECT p.id FROM profiles p JOIN users u ON u.id = p.id
      WHERE lower(p.username) = lower($1) AND u.is_active = true`, [username]);
    if (!owner.rows[0]) throw new NotFoundException('Không tìm thấy hồ sơ.');
    return owner.rows[0].id;
  }

  private filterValues(owner: string, viewer: string | undefined, query: TravelFiltersDto) {
    return [owner, viewer ?? null, query.location_id ?? null, query.year ?? null, query.search || null, query.country || null];
  }

  private async list(owner: string, viewer: string | undefined, query: VisitedLocationQueryDto) {
    const { page, pageSize } = query;
    const values = this.filterValues(owner, viewer, query);
    // A single statement gives the count and page the same snapshot, including empty pages.
    const result = await this.db.query<{ data: VisitedLocationResponse[]; count: number }>(`WITH visible AS (
      SELECT ${markFields(true)} FROM user_visited_locations v JOIN locations l ON l.id = v.location_id
      JOIN users u ON u.id = v.user_id WHERE ${FILTERED}
    ) SELECT (SELECT count(*)::integer FROM visible) AS count,
      COALESCE((SELECT json_agg(item ORDER BY item.created_at DESC, item.id DESC) FROM
        (SELECT * FROM visible ORDER BY created_at DESC, id DESC LIMIT $7 OFFSET $8) item), '[]'::json) AS data`,
    [...values, pageSize, (page - 1) * pageSize]);
    return this.page(result.rows[0].data, result.rows[0].count, page, pageSize);
  }

  async travelMap(username: string, viewerId: string | undefined, query: TravelFiltersDto) {
    const owner = await this.findOwner(username);
    const result = await this.db.query(`WITH visible AS (
      SELECT ${markFields(true)} FROM user_visited_locations v JOIN locations l ON l.id = v.location_id
      JOIN users u ON u.id = v.user_id WHERE ${FILTERED}
    ) SELECT json_build_object(
      'location_count', (SELECT count(*)::integer FROM visible),
      'visit_count', (SELECT COALESCE(sum(visit_count), 0)::integer FROM visible),
      'journey_count', (SELECT count(*)::integer FROM journeys j WHERE j.user_id = $1 AND (j.user_id = $2::uuid OR (j.visibility = 'public' AND j.status = 'published')))
    ) AS statistics,
    json_build_object(
      'years', COALESCE((SELECT json_agg(y ORDER BY y DESC) FROM (
        SELECT DISTINCT extract(year FROM d.visited_at)::integer AS y FROM user_location_visits d
        JOIN user_visited_locations v ON v.id = d.visited_location_id JOIN users u ON u.id = v.user_id WHERE ${VISIBLE}
      ) years), '[]'::json),
      'countries', COALESCE((SELECT json_agg(country ORDER BY country) FROM (
        SELECT DISTINCT l.country FROM user_visited_locations v JOIN users u ON u.id = v.user_id JOIN locations l ON l.id = v.location_id
        WHERE ${VISIBLE} AND NULLIF(btrim(l.country), '') IS NOT NULL
      ) countries), '[]'::json)
    ) AS options,
    COALESCE((SELECT json_agg(json_build_object(
      'id', id, 'location_id', location_id, 'name', location->>'name', 'city', location->>'city', 'country', location->>'country',
      'coordinates', location->'coordinates', 'last_visited_at', last_visited_at, 'visit_count', visit_count, 'visibility', visibility
    ) ORDER BY created_at DESC, id DESC) FROM visible), '[]'::json) AS points`, this.filterValues(owner, viewerId, query));
    return result.rows[0];
  }

  async get(userId: string, id: string): Promise<VisitedLocationResponse> {
    const result = await this.db.query<VisitedLocationResponse>(`SELECT ${MARK_FIELDS} FROM user_visited_locations v
      JOIN locations l ON l.id = v.location_id JOIN users u ON u.id = v.user_id
      WHERE v.id = $1 AND v.user_id = $2 AND u.is_active = true`, [id, userId]);
    if (!result.rows[0]) throw new NotFoundException('Không tìm thấy địa điểm đã đến.');
    return result.rows[0];
  }

  // Serialize aggregate writes per owner, including legacy pin writes/counters.
  async withOwner<T>(userId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.db.transaction(async (client) => {
      const user = await client.query('SELECT id FROM users WHERE id = $1 AND is_active = true FOR UPDATE', [userId]);
      if (!user.rowCount) throw new NotFoundException('Không tìm thấy tài khoản.');
      return work(client);
    });
  }

  private async lockMark(client: PoolClient, userId: string, id: string) {
    const result = await client.query<{ id: string; location_id: string }>(
      'SELECT id, location_id FROM user_visited_locations WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
    if (!result.rows[0]) throw new NotFoundException('Không tìm thấy địa điểm đã đến.');
    return result.rows[0];
  }

  async create(userId: string, dto: CreateVisitedLocationDto): Promise<VisitedLocationResponse> {
    const id = await this.withOwner(userId, async (client) => {
      const location = await client.query('SELECT id FROM locations WHERE id = $1 FOR KEY SHARE', [dto.location_id]);
      if (!location.rowCount) throw new NotFoundException('Địa điểm không còn tồn tại.');
      const inserted = await client.query<{ id: string }>(`INSERT INTO user_visited_locations (user_id, location_id, note, visibility)
        VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, location_id) DO NOTHING RETURNING id`,
      [userId, dto.location_id, dto.note ?? null, dto.visibility ?? 'private']);
      const existing = await client.query<{ id: string; note: string | null; visibility: string }>(
        'SELECT id, note, visibility FROM user_visited_locations WHERE user_id = $1 AND location_id = $2 FOR UPDATE', [userId, dto.location_id]);
      const mark = existing.rows[0];
      if (!inserted.rowCount && ((dto.note !== undefined && dto.note !== mark.note) || (dto.visibility !== undefined && dto.visibility !== mark.visibility))) {
        throw new ConflictException({ code: 'VISITED_LOCATION_EXISTS', message: 'Địa điểm đã được đánh dấu. Hãy mở lại để chỉnh sửa thông tin mới nhất.' });
      }
      if (dto.visited_at) await this.insertVisit(client, userId, mark.id, dto.location_id, { visited_at: dto.visited_at });
      return mark.id;
    });
    return this.get(userId, id);
  }

  async update(userId: string, id: string, dto: UpdateVisitedLocationDto): Promise<VisitedLocationResponse> {
    if (dto.note === undefined && dto.visibility === undefined) throw new BadRequestException('Hãy chọn thông tin cần cập nhật.');
    await this.withOwner(userId, async (client) => {
      await this.lockMark(client, userId, id);
      await client.query(`UPDATE user_visited_locations SET note = CASE WHEN $3 THEN $4::text ELSE note END,
        visibility = COALESCE($5::text, visibility) WHERE id = $1 AND user_id = $2`,
      [id, userId, dto.note !== undefined, dto.note ?? null, dto.visibility ?? null]);
    });
    return this.get(userId, id);
  }

  async remove(userId: string, id: string) {
    await this.withOwner(userId, async (client) => {
      await this.lockMark(client, userId, id);
      await client.query('DELETE FROM user_visited_locations WHERE id = $1 AND user_id = $2', [id, userId]);
    });
    return { deleted: true };
  }

  async visits(userId: string, id: string, query: VisitQueryDto) {
    // Ownership is checked even when the requested page is empty.
    await this.get(userId, id);
    const { page, pageSize } = query;
    const result = await this.db.query<{ data: LocationVisitResponse[]; count: number }>(`WITH visible AS (
      SELECT ${VISIT_FIELDS} FROM user_location_visits WHERE visited_location_id = $1 AND user_id = $2
    ) SELECT (SELECT count(*)::integer FROM visible) AS count,
      COALESCE((SELECT json_agg(item ORDER BY item.visited_at DESC, item.id DESC) FROM
        (SELECT * FROM visible ORDER BY visited_at DESC, id DESC LIMIT $3 OFFSET $4) item), '[]'::json) AS data`,
    [id, userId, pageSize, (page - 1) * pageSize]);
    return this.page(result.rows[0].data, result.rows[0].count, page, pageSize);
  }

  private async insertVisit(client: PoolClient, userId: string, id: string, locationId: string, dto: CreateVisitDto) {
    const inserted = await client.query<LocationVisitResponse>(`INSERT INTO user_location_visits (visited_location_id, user_id, location_id, visited_at, note)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT (visited_location_id, visited_at) DO NOTHING RETURNING ${VISIT_FIELDS}`,
    [id, userId, locationId, dto.visited_at, dto.note ?? null]);
    if (inserted.rows[0]) return inserted.rows[0];
    const existing = await client.query<LocationVisitResponse>(`SELECT ${VISIT_FIELDS} FROM user_location_visits
      WHERE visited_location_id = $1 AND user_id = $2 AND visited_at = $3`, [id, userId, dto.visited_at]);
    if (existing.rows[0].note !== (dto.note ?? null)) {
      throw new ConflictException({ code: 'VISIT_DATE_EXISTS', message: 'Ngày này đã có một lần ghé thăm với ghi chú khác. Bạn có thể chỉnh sửa lần đã lưu.' });
    }
    return existing.rows[0];
  }

  async createVisit(userId: string, id: string, dto: CreateVisitDto) {
    return this.withOwner(userId, async (client) => {
      const mark = await this.lockMark(client, userId, id);
      return this.insertVisit(client, userId, id, mark.location_id, dto);
    });
  }

  async updateVisit(userId: string, id: string, visitId: string, dto: UpdateVisitDto) {
    if (dto.visited_at === undefined && dto.note === undefined) throw new BadRequestException('Hãy chọn thông tin cần cập nhật.');
    try {
      return await this.withOwner(userId, async (client) => {
        await this.lockMark(client, userId, id);
        const result = await client.query<LocationVisitResponse>(`UPDATE user_location_visits SET
          visited_at = COALESCE($4::date, visited_at), note = CASE WHEN $5 THEN $6::text ELSE note END
          WHERE id = $1 AND visited_location_id = $2 AND user_id = $3 RETURNING ${VISIT_FIELDS}`,
        [visitId, id, userId, dto.visited_at ?? null, dto.note !== undefined, dto.note ?? null]);
        if (!result.rows[0]) throw new NotFoundException('Không tìm thấy lần ghé thăm.');
        return result.rows[0];
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException({ code: 'VISIT_DATE_EXISTS', message: 'Ngày này đã được lưu. Hãy chọn ngày khác hoặc sửa lần ghé thăm đã có.' });
      throw error;
    }
  }

  async removeVisit(userId: string, id: string, visitId: string) {
    await this.withOwner(userId, async (client) => {
      await this.lockMark(client, userId, id);
      const result = await client.query('DELETE FROM user_location_visits WHERE id = $1 AND visited_location_id = $2 AND user_id = $3', [visitId, id, userId]);
      if (!result.rowCount) throw new NotFoundException('Không tìm thấy lần ghé thăm.');
    });
    return { deleted: true };
  }

  private page<T>(data: T[], count: number, page: number, pageSize: number) {
    return { data, count, page, pageSize, hasMore: page * pageSize < count };
  }
}
