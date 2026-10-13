import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateItineraryDto, CreateStopDto, UpdateItineraryDto, UpdateStopDto } from './dto/itinerary.dto';

const ITINERARY_SELECT = `i.id, i.author_id, i.title, i.description, i.cover_image, i.is_public, i.total_days, i.created_at, i.updated_at,
  json_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url) AS author`;

@Injectable()
export class ItinerariesService {
  constructor(private readonly db: DatabaseService) {}

  async list(viewerId?: string, mine = false, page = 1, pageSize = 20) {
    const safePage = Math.max(1, page); const safeSize = Math.min(Math.max(1, pageSize), 50); const offset = (safePage - 1) * safeSize;
    if (mine && !viewerId) throw new UnauthorizedException('Authentication is required to list your itineraries.');
    const where = mine ? 'i.author_id = $1' : `(i.is_public = true OR i.author_id = $1)`;
    const values = [viewerId ?? null, safeSize, offset];
    const [data, count] = await Promise.all([
      this.db.query(`SELECT ${ITINERARY_SELECT},
        (SELECT COUNT(*)::integer FROM itinerary_stops s WHERE s.itinerary_id = i.id) AS stop_count
        FROM itineraries i JOIN profiles p ON p.id = i.author_id WHERE ${where}
        ORDER BY i.created_at DESC, i.id DESC LIMIT $2 OFFSET $3`, values),
      this.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM itineraries i WHERE ${where}`, [viewerId ?? null]),
    ]);
    const total = Number(count.rows[0]?.count ?? 0);
    return { data: data.rows, count: total, page: safePage, pageSize: safeSize, hasMore: offset + data.rows.length < total };
  }

  async getById(id: string, viewerId?: string) {
    const result = await this.db.query(
      `SELECT ${ITINERARY_SELECT},
       COALESCE((SELECT json_agg(json_build_object(
         'id', s.id, 'itinerary_id', s.itinerary_id, 'location_id', s.location_id, 'day_number', s.day_number,
         'order_in_day', s.order_in_day, 'note', s.note,
         'location', json_build_object('id', l.id, 'name', l.name, 'city', l.city, 'country', l.country, 'category', l.category,
           'coordinates', json_build_object('lat', ST_Y(l.coordinates), 'lng', ST_X(l.coordinates)))
       ) ORDER BY s.day_number, s.order_in_day) FROM itinerary_stops s JOIN locations l ON l.id = s.location_id WHERE s.itinerary_id = i.id), '[]'::json) AS stops
       FROM itineraries i JOIN profiles p ON p.id = i.author_id
       WHERE i.id = $2 AND (i.is_public = true OR i.author_id = $1)`, [viewerId ?? null, id],
    );
    if (!result.rows[0]) throw new NotFoundException('Itinerary not found.');
    return result.rows[0];
  }

  async create(userId: string, dto: CreateItineraryDto) {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO itineraries (author_id, title, description, cover_image, is_public, total_days)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, dto.title.trim(), dto.description?.trim() || null, dto.cover_image || null, dto.is_public ?? true, dto.total_days ?? 1],
    );
    return this.getById(result.rows[0].id, userId);
  }

  async update(userId: string, id: string, dto: UpdateItineraryDto) {
    await this.assertOwner(userId, id);
    if (dto.total_days !== undefined) {
      const latestStop = await this.db.query<{ max_day: number | null }>(
        'SELECT MAX(day_number)::integer AS max_day FROM itinerary_stops WHERE itinerary_id = $1', [id],
      );
      if ((latestStop.rows[0]?.max_day ?? 0) > dto.total_days) {
        throw new BadRequestException('total_days cannot be lower than the day number of an existing stop.');
      }
    }
    const mapping: Array<[keyof UpdateItineraryDto, string, unknown]> = [
      ['title', 'title', dto.title?.trim()], ['description', 'description', dto.description?.trim() || null],
      ['cover_image', 'cover_image', dto.cover_image || null], ['is_public', 'is_public', dto.is_public], ['total_days', 'total_days', dto.total_days],
    ];
    const values: unknown[] = [id]; const assignments: string[] = [];
    for (const [key, column, value] of mapping) {
      if (dto[key] !== undefined) { values.push(value); assignments.push(`${column} = $${values.length}`); }
    }
    if (assignments.length) await this.db.query(`UPDATE itineraries SET ${assignments.join(', ')} WHERE id = $1`, values);
    return this.getById(id, userId);
  }

  async delete(userId: string, id: string) {
    await this.assertOwner(userId, id);
    await this.db.query('DELETE FROM itineraries WHERE id = $1', [id]);
    return { deleted: true };
  }

  async addStop(userId: string, itineraryId: string, dto: CreateStopDto) {
    const stopId = await this.db.transaction(async (client) => {
      const itinerary = await client.query<{ total_days: number }>('SELECT total_days FROM itineraries WHERE id = $1 AND author_id = $2 FOR UPDATE', [itineraryId, userId]);
      if (!itinerary.rows[0]) {
        const exists = await client.query('SELECT 1 FROM itineraries WHERE id = $1', [itineraryId]);
        if (exists.rowCount) throw new ForbiddenException('You can only modify your own itinerary.');
        throw new NotFoundException('Itinerary not found.');
      }
      if (dto.day_number > itinerary.rows[0].total_days) throw new BadRequestException('day_number cannot exceed the itinerary total_days.');
      const nextOrder = await client.query<{ next_order: number }>(
        'SELECT COALESCE(MAX(order_in_day), 0)::integer + 1 AS next_order FROM itinerary_stops WHERE itinerary_id = $1 AND day_number = $2', [itineraryId, dto.day_number],
      );
      const result = await client.query<{ id: string }>(
        `INSERT INTO itinerary_stops (itinerary_id, location_id, day_number, order_in_day, note)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [itineraryId, dto.location_id, dto.day_number, nextOrder.rows[0].next_order, dto.note?.trim() || null],
      );
      return result.rows[0].id;
    });
    const result = await this.db.query(
      `SELECT s.id, s.itinerary_id, s.location_id, s.day_number, s.order_in_day, s.note,
       json_build_object('id', l.id, 'name', l.name, 'city', l.city, 'country', l.country, 'category', l.category,
        'coordinates', json_build_object('lat', ST_Y(l.coordinates), 'lng', ST_X(l.coordinates))) AS location
       FROM itinerary_stops s JOIN locations l ON l.id = s.location_id WHERE s.id = $1`, [stopId],
    );
    return result.rows[0];
  }

  async updateStop(userId: string, itineraryId: string, stopId: string, dto: UpdateStopDto) {
    await this.assertOwner(userId, itineraryId);
    const current = await this.db.query<{ day_number: number; total_days: number }>(
      `SELECT s.day_number, i.total_days FROM itinerary_stops s JOIN itineraries i ON i.id = s.itinerary_id
       WHERE s.id = $1 AND s.itinerary_id = $2`, [stopId, itineraryId],
    );
    if (!current.rows[0]) throw new NotFoundException('Itinerary stop not found.');
    if (dto.day_number !== undefined && dto.day_number > current.rows[0].total_days) {
      throw new BadRequestException('day_number cannot exceed the itinerary total_days.');
    }
    const values: unknown[] = [stopId, itineraryId]; const assignments: string[] = [];
    if (dto.day_number !== undefined) { values.push(dto.day_number); assignments.push(`day_number = $${values.length}`); }
    if (dto.order_in_day !== undefined) { values.push(dto.order_in_day); assignments.push(`order_in_day = $${values.length}`); }
    if (dto.note !== undefined) { values.push(dto.note?.trim() || null); assignments.push(`note = $${values.length}`); }
    if (assignments.length) await this.db.query(`UPDATE itinerary_stops SET ${assignments.join(', ')} WHERE id = $1 AND itinerary_id = $2`, values);
    return this.getById(itineraryId, userId);
  }

  async deleteStop(userId: string, itineraryId: string, stopId: string) {
    await this.assertOwner(userId, itineraryId);
    const result = await this.db.query('DELETE FROM itinerary_stops WHERE id = $1 AND itinerary_id = $2', [stopId, itineraryId]);
    if (!result.rowCount) throw new NotFoundException('Itinerary stop not found.');
    return { deleted: true };
  }

  private async assertOwner(userId: string, id: string) {
    const result = await this.db.query<{ author_id: string }>('SELECT author_id FROM itineraries WHERE id = $1', [id]);
    if (!result.rows[0]) throw new NotFoundException('Itinerary not found.');
    if (result.rows[0].author_id !== userId) throw new ForbiddenException('You can only modify your own itinerary.');
  }
}
