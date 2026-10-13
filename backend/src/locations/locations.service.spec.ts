import { DatabaseService } from '../database/database.service';
import { LocationsService } from './locations.service';

describe('LocationsService', () => {
  let db: { query: jest.Mock };
  let service: LocationsService;

  beforeEach(() => {
    db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    service = new LocationsService(db as unknown as DatabaseService);
  });

  it('uses PostGIS envelope predicates for a normal map viewport', async () => {
    await service.inViewport({ west: 100, south: 8, east: 110, north: 20, limit: 100 });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain('ST_MakeEnvelope($1, $2, $3, $4, 4326)');
    expect(db.query.mock.calls[0][1]).toEqual([100, 8, 110, 20, 100]);
  });

  it('splits a viewport that crosses the antimeridian into two indexable envelopes', async () => {
    await service.inViewport({ west: 170, south: -10, east: -170, north: 10, limit: 50 });
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain(' OR l.coordinates && ST_MakeEnvelope($5, $6, $7, $8, 4326)');
    expect(db.query.mock.calls[0][1]).toEqual([170, -10, 180, 10, -180, -10, -170, 10, 50]);
  });

  it('returns no pins for invalid vertical bounds without querying PostgreSQL', async () => {
    await expect(service.inViewport({ west: 0, south: 10, east: 10, north: 10, limit: 10 })).resolves.toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });
});
