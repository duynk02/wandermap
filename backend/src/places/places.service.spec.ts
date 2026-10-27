import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeVietnamese } from '../common/text';
import { LocationsService } from '../locations/locations.service';
import { inferCategory } from './osm-category';
import { PhotonFeature, PlacesService } from './places.service';

const feature = (props: NonNullable<PhotonFeature['properties']>, lng = 106, lat = 16): PhotonFeature => ({
  geometry: { coordinates: [lng, lat] },
  properties: { osm_type: 'N', countrycode: 'VN', country: 'Việt Nam', ...props },
});

describe('PlacesService upstream failure', () => {
  it('keeps existing search results available without logging upstream content or user queries', async () => {
    const existing = [{ name: 'Đà Lạt', google_place_id: null, coordinates: { lat: 12, lng: 108 } }];
    const locations = { suggest: jest.fn().mockResolvedValue(existing) } as unknown as LocationsService;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('private query and provider response'));
    const log = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const service = new PlacesService(new ConfigService(), locations);
      await expect(service.search({ q: 'private query', scope: 'vn', limit: 8 })).resolves.toEqual({ existing, external: [], externalAvailable: false });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/private query|provider response/);
    } finally { fetchMock.mockRestore(); log.mockRestore(); }
  });
});

describe('normalizeVietnamese', () => {
  it('strips diacritics, folds đ and lowercases', () => {
    expect(normalizeVietnamese('Đà Lạt')).toBe('da lat');
    expect(normalizeVietnamese('  Thác   Bản Giốc ')).toBe('thac ban gioc');
    expect(normalizeVietnamese('Hồ Xuân Hương, Phường 9')).toBe('ho xuan huong, phuong 9');
    expect(normalizeVietnamese('ĐẶNG')).toBe('dang');
  });
});

describe('inferCategory', () => {
  it.each([
    ['natural', 'waterfall', 'waterfall'],
    ['natural', 'peak', 'mountain'],
    ['natural', 'beach', 'beach'],
    ['tourism', 'camp_site', 'camping'],
    ['amenity', 'cafe', 'cafe'],
    ['amenity', 'restaurant', 'street_food'],
    ['amenity', 'place_of_worship', 'heritage'],
    ['historic', 'monument', 'heritage'],
    ['place', 'village', 'village'],
    ['place', 'city', 'other'],
    ['shop', 'convenience', 'other'],
  ])('%s=%s → %s', (key, value, expected) => expect(inferCategory(key, value)).toBe(expected));
});

describe('PlacesService.mapFeatures', () => {
  const service = new PlacesService(
    { get: () => undefined } as unknown as ConfigService,
    {} as unknown as LocationsService,
  );

  it('maps Photon features, keeps Vietnam only and drops roads / nameless / duplicates', () => {
    const result = service.mapFeatures(
      [
        feature({ osm_id: 1, osm_key: 'natural', osm_value: 'waterfall', name: 'Thác Bản Giốc', state: 'Cao Bằng', street: 'QL3' }, 106.7, 22.85),
        feature({ osm_id: 2, osm_key: 'natural', osm_value: 'waterfall', name: 'Thác Bản Giốc' }, 106.701, 22.851), // duplicate
        feature({ osm_id: 3, osm_key: 'highway', osm_value: 'residential', name: 'Đường Bản Giốc' }),
        feature({ osm_id: 4, osm_key: 'amenity', osm_value: 'cafe' }), // no name
        feature({ osm_id: 5, osm_key: 'tourism', osm_value: 'attraction', name: 'Angkor Wat', countrycode: 'KH', country: 'Cambodia' }),
        feature({ osm_id: 6, osm_key: 'place', osm_value: 'city', name: 'Đà Lạt', state: 'Lâm Đồng' }, 108.44, 11.94),
      ],
      'vn',
    );

    expect(result.map((r) => r.name)).toEqual(['Thác Bản Giốc', 'Đà Lạt']);
    expect(result[0]).toMatchObject({
      key: 'osm:N1',
      category: 'waterfall',
      kind: 'natural:waterfall',
      coordinates: { lat: 22.85, lng: 106.7 },
      address: 'QL3, Cao Bằng, Việt Nam',
      city: 'Cao Bằng',
    });
    expect(result[1]).toMatchObject({ key: 'osm:N6', city: 'Đà Lạt', category: 'other' });
  });

  it('keeps foreign places when searching the whole world', () => {
    const result = service.mapFeatures(
      [feature({ osm_id: 5, osm_key: 'tourism', osm_value: 'attraction', name: 'Angkor Wat', countrycode: 'KH', country: 'Cambodia' })],
      'world',
    );
    expect(result).toHaveLength(1);
  });
});
