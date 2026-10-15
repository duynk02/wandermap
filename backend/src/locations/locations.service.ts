import { Injectable, NotFoundException } from '@nestjs/common';
import { normalizeVietnamese } from '../common/text';
import { DatabaseService } from '../database/database.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { LocationQueryDto, ViewportQueryDto } from './dto/location-query.dto';

const LOCATION_FIELDS = `l.id, l.name, l.address, l.country, l.city, l.category, l.google_place_id,
  l.post_count, l.avg_rating::double precision AS avg_rating, l.trending_score, l.created_at,
  json_build_object('lat', ST_Y(l.coordinates), 'lng', ST_X(l.coordinates)) AS coordinates`;

@Injectable()
export class LocationsService {
  constructor(private readonly db: DatabaseService) { }

  async list(query: LocationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const conditions: string[] = [];
    const values: unknown[] = [];
    const add = (condition: (index: number) => string, value: unknown) => { values.push(value); conditions.push(condition(values.length)); };
    if (query.category) add((i) => `l.category = $${i}`, query.category);
    if (query.minRating !== undefined) add((i) => `l.avg_rating >= $${i}`, query.minRating);
    if (query.country) add((i) => `l.country ILIKE $${i}`, query.country);
    if (query.city) add((i) => `l.city ILIKE $${i}`, query.city);
    let rank = '';
    if (query.search && normalizeVietnamese(query.search)) {
      const search = this.searchClause(query.search, values);
      conditions.push(search.clause);
      rank = `${search.rank} DESC,`;
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;
    const dataQuery = this.db.query(
      `SELECT ${LOCATION_FIELDS} FROM locations l ${where}
      ORDER BY ${rank}l.trending_score DESC, l.post_count DESC, l.created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, offset],
    );
    const countQuery = this.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM locations l ${where}`, values);
    const [data, count] = await Promise.all([dataQuery, countQuery]);
    const total = Number(count.rows[0]?.count ?? 0);
    return { data: data.rows, count: total, page, pageSize, hasMore: offset + data.rows.length < total };
  }

  /** 
   * Accent-insensitive match: every word must appear in search_text (see migration 002),
   * OR the whole phrase is trigram-similar (tolerates typos). Pushes its parameters onto `values`.
   */
  private searchClause(search: string, values: unknown[]) {
    const needle = normalizeVietnamese(search);
    const patterns = needle.split(' ').filter(Boolean).slice(0, 6).map((word) => `%${word.replace(/[\\%_]/g, '\\$&')}%`);
    values.push(patterns);
    const patternsIndex = values.length;
    values.push(needle);
    const needleIndex = values.length;
    return {
      clause: `(l.search_text ILIKE ALL ($${patternsIndex}::text[]) OR l.search_text % $${needleIndex}::text)`,
      rank: `similarity(l.search_text, $${needleIndex}::text)`,
    };
  }

  async suggest(search: string, limit = 5) {
    const values: unknown[] = [];
    const { clause, rank } = this.searchClause(search, values);
    values.push(Math.min(Math.max(limit, 1), 20));
    const result = await this.db.query(
      `SELECT ${LOCATION_FIELDS} FROM locations l WHERE ${clause}
      ORDER BY ${rank} DESC, l.post_count DESC, l.trending_score DESC LIMIT $${values.length}`, values,
    );
    return result.rows as { id: string; name: string; google_place_id: string | null; coordinates: { lat: number; lng: number } }[];
  }

  async inViewport(query: ViewportQueryDto) {
    if (query.south >= query.north) return [];
    const values: unknown[] = [];
    const conditions: string[] = [];
    if (query.west <= query.east) {
      values.push(query.west, query.south, query.east, query.north);
      conditions.push(`l.coordinates && ST_MakeEnvelope($1, $2, $3, $4, 4326)`);
    } else {
      // A viewport crossing the antimeridian consists of two envelopes.
      values.push(query.west, query.south, 180, query.north, -180, query.south, query.east, query.north);
      conditions.push(`(l.coordinates && ST_MakeEnvelope($1, $2, $3, $4, 4326) OR l.coordinates && ST_MakeEnvelope($5, $6, $7, $8, 4326))`);
    }
    if (query.category) { values.push(query.category); conditions.push(`l.category = $${values.length}`); }
    if (query.minRating !== undefined) { values.push(query.minRating); conditions.push(`l.avg_rating >= $${values.length}`); }
    if (query.country) { values.push(query.country); conditions.push(`l.country ILIKE $${values.length}`); }
    values.push(query.limit ?? 200);
    const result = await this.db.query(
      `SELECT ${LOCATION_FIELDS} FROM locations l WHERE ${conditions.join(' AND ')}
       ORDER BY l.trending_score DESC, l.post_count DESC LIMIT $${values.length}`, values,
    );
    return result.rows;
  }

  async trending(limit = 50) {
    const safeLimit = Math.min(Math.max(Math.trunc(limit || 50), 1), 100);
    const result = await this.db.query(
      `SELECT ${LOCATION_FIELDS} FROM locations l WHERE l.post_count > 0
       ORDER BY l.trending_score DESC, l.post_count DESC LIMIT $1`, [safeLimit],
    );
    return result.rows;
  }

  async getById(id: string) {
    const result = await this.db.query(`SELECT ${LOCATION_FIELDS} FROM locations l WHERE l.id = $1`, [id]);
    if (!result.rows[0]) throw new NotFoundException('Location not found.');
    return result.rows[0];
  }

  async create(dto: CreateLocationDto) {
    const category = dto.category ?? 'other';
    const result = await this.db.query(
      `INSERT INTO locations (name, address, coordinates, country, city, category, google_place_id)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8)
       ON CONFLICT (google_place_id) DO UPDATE SET google_place_id = EXCLUDED.google_place_id
       RETURNING id`,
      [dto.name.trim(), dto.address?.trim() || null, dto.coordinates.lng, dto.coordinates.lat, dto.country?.trim() || null,
      dto.city?.trim() || null, category, dto.google_place_id?.trim() || null],
    );
    return this.getById(result.rows[0].id);
  }
}
