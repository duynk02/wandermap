import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import {
  CreateJourneyDto,
  JourneyFieldsDto,
  JourneyQueryDto,
  JourneyStopDto,
  JourneyStyleDto,
  PublishJourneyDto,
  UpdateJourneyDto,
} from './dto/journey.dto';

interface JourneyRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  visibility: 'public' | 'private';
  status: 'draft' | 'published';
  style_config: JourneyStyleDto;
  revision: number;
}
interface StopRow {
  location_id: string;
  visit_id: string | null;
  location_name_snapshot: string;
  visited_at_snapshot: string | null;
  stop_order: number;
}
const FIELDS = `j.id, j.user_id, j.title, j.description, j.cover_image_url, j.visibility, j.status, j.style_config, j.revision, j.created_at, j.updated_at,
  json_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url) AS author`;
const ACCESS = `u.is_active = true AND (j.user_id = $1::uuid OR (j.visibility = 'public' AND j.status = 'published'))`;

@Injectable()
export class JourneysService {
  constructor(private readonly db: DatabaseService) {}

  async list(viewer: string | undefined, query: JourneyQueryDto) {
    if (query.mine && !viewer)
      throw new UnauthorizedException('Bạn cần đăng nhập để xem bản nháp.');
    if (query.username) {
      const owner = await this.db.query(
        `SELECT p.id FROM profiles p JOIN users u ON u.id = p.id WHERE lower(p.username) = lower($1) AND u.is_active = true`,
        [query.username],
      );
      if (!owner.rowCount) throw new NotFoundException('Không tìm thấy hồ sơ.');
    }
    const result = await this.db.query(
      `WITH visible AS (
      SELECT ${FIELDS}, (SELECT count(*)::integer FROM journey_stops s WHERE s.journey_id = j.id) AS stop_count,
      COALESCE((SELECT json_agg(name ORDER BY stop_order) FROM (SELECT location_name_snapshot AS name, stop_order FROM journey_stops s WHERE s.journey_id = j.id ORDER BY stop_order LIMIT 3) first_stops), '[]'::json) AS preview_names
      FROM journeys j JOIN users u ON u.id = j.user_id JOIN profiles p ON p.id = j.user_id
      WHERE ${ACCESS} AND ($2::text IS NULL OR lower(p.username) = lower($2)) AND ($3::boolean = false OR j.user_id = $1)
    ) SELECT (SELECT count(*)::integer FROM visible) AS count,
      COALESCE((SELECT json_agg(item ORDER BY updated_at DESC, id DESC) FROM
        (SELECT * FROM visible ORDER BY updated_at DESC, id DESC LIMIT $4 OFFSET $5) item), '[]'::json) AS data`,
      [
        viewer ?? null,
        query.username ?? null,
        query.mine ?? false,
        query.pageSize,
        (query.page - 1) * query.pageSize,
      ],
    );
    const row = result.rows[0];
    return {
      ...row,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: query.page * query.pageSize < row.count,
    };
  }

  async get(id: string, viewer?: string) {
    const result = await this.db.query(
      `SELECT ${FIELDS},
      COALESCE((SELECT json_agg(jsonb_build_object('id', s.id, 'location_id', s.location_id, 'stop_order', s.stop_order,
        'location_name_snapshot', s.location_name_snapshot, 'visited_at_snapshot', s.visited_at_snapshot::text,
        'location', json_build_object('id', l.id, 'name', s.location_name_snapshot, 'city', l.city, 'country', l.country,
          'coordinates', json_build_object('lat', ST_Y(l.coordinates), 'lng', ST_X(l.coordinates))))
        || CASE WHEN j.user_id = $1::uuid THEN jsonb_build_object('visit_id', s.visit_id) ELSE '{}'::jsonb END ORDER BY s.stop_order)
        FROM journey_stops s JOIN locations l ON l.id = s.location_id WHERE s.journey_id = j.id), '[]'::json) AS stops
      FROM journeys j JOIN users u ON u.id = j.user_id JOIN profiles p ON p.id = j.user_id WHERE j.id = $2 AND ${ACCESS}`,
      [viewer ?? null, id],
    );
    if (!result.rows[0])
      throw new NotFoundException('Không tìm thấy hành trình.');
    return result.rows[0];
  }

  private async lockOwner(client: PoolClient, userId: string) {
    const user = await client.query(
      'SELECT id FROM users WHERE id = $1 AND is_active = true FOR UPDATE',
      [userId],
    );
    if (!user.rowCount)
      throw new NotFoundException('Không tìm thấy tài khoản.');
  }
  private async lockJourney(
    client: PoolClient,
    userId: string,
    id: string,
    revision: number,
  ) {
    const result = await client.query<JourneyRow>(
      'SELECT * FROM journeys WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [id, userId],
    );
    if (!result.rows[0])
      throw new NotFoundException('Không tìm thấy hành trình.');
    if (result.rows[0].revision !== revision)
      throw new ConflictException({
        code: 'JOURNEY_REVISION_CONFLICT',
        message:
          'Hành trình đã được cập nhật ở nơi khác. Bản đang nhập vẫn được giữ; hãy mở lại phiên bản mới trước khi lưu.',
      });
    return result.rows[0];
  }
  private async existingStops(client: PoolClient, id: string) {
    return (
      await client.query<StopRow>(
        'SELECT location_id, visit_id, location_name_snapshot, visited_at_snapshot::text, stop_order FROM journey_stops WHERE journey_id = $1 ORDER BY stop_order',
        [id],
      )
    ).rows;
  }
  private assertPublish(status: string, count: number) {
    if (status === 'published' && count < 2)
      throw new BadRequestException(
        'Hãy chọn ít nhất 2 địa điểm để hoàn tất hành trình.',
      );
  }
  private async resolveStops(
    client: PoolClient,
    userId: string,
    requested: JourneyStopDto[],
    existing: StopRow[],
  ) {
    if (new Set(requested.map((s) => s.location_id)).size !== requested.length)
      throw new BadRequestException(
        'Mỗi địa điểm chỉ xuất hiện một lần trong hành trình.',
      );
    const locations = requested.map((s) => s.location_id);
    const marks = await client.query<{
      location_id: string;
      name: string;
      latest_visit_id: string | null;
      latest_date: string | null;
    }>(
      `SELECT m.location_id, l.name, latest.id AS latest_visit_id, latest.visited_at::text AS latest_date
      FROM user_visited_locations m JOIN locations l ON l.id = m.location_id
      LEFT JOIN LATERAL (SELECT id, visited_at FROM user_location_visits d WHERE d.visited_location_id = m.id ORDER BY visited_at DESC LIMIT 1) latest ON true
      WHERE m.user_id = $1 AND m.location_id = ANY($2::uuid[])`,
      [userId, locations],
    );
    const visits = await client.query<{
      id: string;
      location_id: string;
      visited_at: string;
    }>(
      'SELECT id, location_id, visited_at::text FROM user_location_visits WHERE user_id = $1 AND id = ANY($2::uuid[])',
      [userId, requested.flatMap((s) => (s.visit_id ? [s.visit_id] : []))],
    );
    const oldByLocation = new Map(existing.map((s) => [s.location_id, s]));
    const marksByLocation = new Map(marks.rows.map((m) => [m.location_id, m]));
    const visitsById = new Map(visits.rows.map((v) => [v.id, v]));
    return requested.map((stop, index): StopRow => {
      const old = oldByLocation.get(stop.location_id);
      // Reordering or editing metadata preserves snapshots, including detached visits.
      if (
        old &&
        (stop.visit_id === undefined || stop.visit_id === old.visit_id)
      )
        return { ...old, stop_order: index + 1 };
      const mark = marksByLocation.get(stop.location_id);
      if (!mark)
        throw new BadRequestException(
          'Chỉ có thể thêm địa điểm bạn đã đánh dấu đã đến.',
        );
      const visit = stop.visit_id ? visitsById.get(stop.visit_id) : undefined;
      if (stop.visit_id && (!visit || visit.location_id !== stop.location_id))
        throw new BadRequestException(
          'Lần ghé thăm không thuộc địa điểm hoặc tài khoản này.',
        );
      return {
        location_id: stop.location_id,
        visit_id:
          stop.visit_id === undefined ? mark.latest_visit_id : stop.visit_id,
        visited_at_snapshot:
          stop.visit_id === undefined
            ? mark.latest_date
            : (visit?.visited_at ?? null),
        location_name_snapshot: [...mark.name].slice(0, 200).join(''),
        stop_order: index + 1,
      };
    });
  }
  private async writeStops(
    client: PoolClient,
    userId: string,
    id: string,
    stops: StopRow[],
  ) {
    await client.query('SET CONSTRAINTS journey_stops_order_unique DEFERRED');
    await client.query(
      'DELETE FROM journey_stops WHERE journey_id = $1 AND NOT (location_id = ANY($2::uuid[]))',
      [id, stops.map((s) => s.location_id)],
    );
    if (stops.length)
      await client.query(
        `INSERT INTO journey_stops (journey_id, user_id, location_id, visit_id, stop_order, location_name_snapshot, visited_at_snapshot)
      SELECT $1, $2, x.location_id, x.visit_id, x.stop_order, x.location_name_snapshot, x.visited_at_snapshot
      FROM jsonb_to_recordset($3::jsonb) AS x(location_id uuid, visit_id uuid, stop_order integer, location_name_snapshot text, visited_at_snapshot date)
      ON CONFLICT (journey_id, location_id) DO UPDATE SET visit_id = EXCLUDED.visit_id, stop_order = EXCLUDED.stop_order,
        location_name_snapshot = EXCLUDED.location_name_snapshot, visited_at_snapshot = EXCLUDED.visited_at_snapshot`,
        [id, userId, JSON.stringify(stops)],
      );
  }
  private style(style?: JourneyStyleDto) {
    return { ...new JourneyStyleDto(), ...style };
  }

  async create(userId: string, dto: CreateJourneyDto) {
    await this.db.transaction(async (client) => {
      await this.lockOwner(client, userId);
      const inserted = await client.query(
        `INSERT INTO journeys (id, user_id, title, description, cover_image_url, visibility, status, style_config)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [
          dto.request_id,
          userId,
          dto.title,
          dto.description ?? null,
          dto.cover_image_url ?? null,
          dto.visibility ?? 'private',
          dto.status ?? 'draft',
          JSON.stringify(this.style(dto.style_config)),
        ],
      );
      if (!inserted.rowCount) {
        const saved = (
          await client.query<JourneyRow>(
            'SELECT * FROM journeys WHERE id = $1 AND user_id = $2 FOR UPDATE',
            [dto.request_id, userId],
          )
        ).rows[0];
        if (!saved) throw new NotFoundException('Không tìm thấy hành trình.');
        const stops = await this.existingStops(client, saved.id);
        const style = this.style(dto.style_config);
        const same =
          saved.title === dto.title &&
          saved.description === (dto.description ?? null) &&
          saved.cover_image_url === (dto.cover_image_url ?? null) &&
          saved.visibility === (dto.visibility ?? 'private') &&
          saved.status === (dto.status ?? 'draft') &&
          Object.entries(style).every(
            ([key, value]) =>
              saved.style_config[key as keyof JourneyStyleDto] === value,
          ) &&
          stops.length === dto.stops.length &&
          dto.stops.every(
            (s, i) =>
              s.location_id === stops[i].location_id &&
              (s.visit_id === undefined || s.visit_id === stops[i].visit_id),
          );
        if (!same)
          throw new ConflictException({
            code: 'JOURNEY_REQUEST_REUSED',
            message:
              'Lần lưu trước đã hoàn tất với nội dung khác. Hãy mở lại hành trình đã lưu trước khi chỉnh sửa.',
          });
        return;
      }
      this.assertPublish(dto.status ?? 'draft', dto.stops.length);
      await this.writeStops(
        client,
        userId,
        dto.request_id,
        await this.resolveStops(client, userId, dto.stops, []),
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    });
    return this.get(dto.request_id, userId);
  }

  async update(userId: string, id: string, dto: UpdateJourneyDto) {
    if (
      ![
        dto.title,
        dto.description,
        dto.cover_image_url,
        dto.visibility,
        dto.status,
        dto.style_config,
        dto.stops,
      ].some((value) => value !== undefined)
    )
      throw new BadRequestException('Hãy chọn thông tin cần cập nhật.');
    await this.db.transaction(async (client) => {
      await this.lockOwner(client, userId);
      const current = await this.lockJourney(client, userId, id, dto.revision);
      const old = await this.existingStops(client, id);
      this.assertPublish(
        dto.status ?? current.status,
        dto.stops?.length ?? old.length,
      );
      if (dto.stops)
        await this.writeStops(
          client,
          userId,
          id,
          await this.resolveStops(client, userId, dto.stops, old),
        );
      const fields: Array<[keyof JourneyFieldsDto, string, unknown]> = [
        ['title', 'title', dto.title],
        ['description', 'description', dto.description ?? null],
        ['cover_image_url', 'cover_image_url', dto.cover_image_url ?? null],
        ['visibility', 'visibility', dto.visibility],
        ['status', 'status', dto.status],
        [
          'style_config',
          'style_config',
          dto.style_config
            ? JSON.stringify(this.style(dto.style_config))
            : undefined,
        ],
      ];
      const values: unknown[] = [id, userId];
      const assignments = ['revision = revision + 1'];
      for (const [key, column, value] of fields)
        if (dto[key] !== undefined) {
          values.push(value);
          assignments.push(`${column} = $${values.length}`);
        }
      await client.query(
        `UPDATE journeys SET ${assignments.join(', ')} WHERE id = $1 AND user_id = $2`,
        values,
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    });
    return this.get(id, userId);
  }

  async publish(userId: string, id: string, dto: PublishJourneyDto) {
    return this.update(userId, id, {
      revision: dto.revision,
      status: 'published',
      ...(dto.visibility ? { visibility: dto.visibility } : {}),
    });
  }
  async remove(userId: string, id: string, revision: number) {
    await this.db.transaction(async (client) => {
      await this.lockOwner(client, userId);
      await this.lockJourney(client, userId, id, revision);
      await client.query(
        'DELETE FROM journeys WHERE id = $1 AND user_id = $2',
        [id, userId],
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    });
    return { deleted: true };
  }
}
