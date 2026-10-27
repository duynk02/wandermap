import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeVietnamese } from '../common/text';
import { LocationsService } from '../locations/locations.service';
import { PlaceSearchQueryDto } from './dto/place-search-query.dto';
import { inferCategory, PlaceCategory } from './osm-category';

/** Vietnam incl. the Hoàng Sa / Trường Sa islands. Neighbours that fall inside are dropped by country code. */
const VN_BBOX = '102.0,6.0,118.0,23.6';
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 500;
const UPSTREAM_TIMEOUT_MS = 4_000;

export interface PlaceSuggestion {
  /** Stable id, stored in locations.google_place_id to avoid duplicates: "osm:N123", "osm:W456"... */
  key: string;
  name: string;
  address: string;
  city?: string;
  country?: string;
  countryCode?: string;
  coordinates: { lat: number; lng: number };
  category: PlaceCategory;
  /** Raw OSM classification, e.g. "natural:waterfall". */
  kind: string;
}

export interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number;
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    locality?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
  };
}

@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);
  private readonly photonUrl: string;
  private readonly userAgent: string;
  private readonly cache = new Map<string, { expires: number; value: PlaceSuggestion[] }>();

  constructor(config: ConfigService, private readonly locations: LocationsService) {
    this.photonUrl = (config.get<string>('PHOTON_URL') || 'https://photon.komoot.io').replace(/\/+$/, '');
    this.userAgent = config.get<string>('PLACES_USER_AGENT') || 'WanderMap/1.0 (place search)';
  }

  /**
   * Existing WanderMap locations first (accent-insensitive, instant), then OpenStreetMap places the
   * user can add. An upstream failure never fails the request: the caller gets `externalAvailable: false`.
   */
  async search(query: PlaceSearchQueryDto) {
    const limit = query.limit ?? 8;
    const [existing, external] = await Promise.allSettled([
      this.locations.suggest(query.q, 5),
      this.searchExternal(query.q, query.scope ?? 'vn', query.lat, query.lng, limit),
    ]);
    if (existing.status === 'rejected') throw existing.reason;

    if (external.status === 'rejected') {
      this.logger.warn('Photon search unavailable; returning existing locations only.');
    }
    const suggestions = external.status === 'fulfilled' ? external.value : [];
    return {
      existing: existing.value,
      external: this.withoutKnownLocations(suggestions, existing.value).slice(0, limit),
      externalAvailable: external.status === 'fulfilled',
    };
  }

  private withoutKnownLocations(
    suggestions: PlaceSuggestion[],
    existing: { name: string; google_place_id: string | null; coordinates: { lat: number; lng: number } }[],
  ) {
    const keys = new Set(existing.map((l) => l.google_place_id).filter(Boolean));
    return suggestions.filter((s) => {
      if (keys.has(s.key)) return false;
      const name = normalizeVietnamese(s.name);
      return !existing.some(
        (l) =>
          normalizeVietnamese(l.name) === name &&
          Math.abs(l.coordinates.lat - s.coordinates.lat) < 0.02 &&
          Math.abs(l.coordinates.lng - s.coordinates.lng) < 0.02,
      );
    });
  }

  private async searchExternal(q: string, scope: 'vn' | 'world', lat: number | undefined, lng: number | undefined, limit: number) {
    const cacheKey = `${scope}|${q.toLowerCase()}|${lat?.toFixed(1) ?? ''}|${lng?.toFixed(1) ?? ''}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.value;

    const url = new URL('/api', this.photonUrl);
    url.searchParams.set('q', q);
    // Over-fetch: results are filtered by country and de-duplicated afterwards.
    url.searchParams.set('limit', String(Math.min(limit * 3, 30)));
    url.searchParams.append('osm_tag', '!highway');
    if (scope === 'vn') url.searchParams.set('bbox', VN_BBOX);
    if (lat !== undefined && lng !== undefined) {
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lng));
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Photon responded with HTTP ${response.status}`);
    const body = (await response.json()) as { features?: PhotonFeature[] };

    const value = this.mapFeatures(body.features ?? [], scope);
    if (this.cache.size >= CACHE_MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, value });
    return value;
  }

  mapFeatures(features: PhotonFeature[], scope: 'vn' | 'world'): PlaceSuggestion[] {
    const seen = new Set<string>();
    const result: PlaceSuggestion[] = [];

    for (const feature of features) {
      const p = feature.properties ?? {};
      const [lng, lat] = feature.geometry?.coordinates ?? [];
      if (!p.name || !p.osm_id || !p.osm_type || typeof lat !== 'number' || typeof lng !== 'number') continue;
      if (p.osm_key === 'highway') continue;
      if (scope === 'vn' && p.countrycode !== 'VN') continue;

      const key = `osm:${p.osm_type}${p.osm_id}`;
      // Same name within ~1 km is almost always the same place mapped twice (node + area).
      const fingerprint = `${normalizeVietnamese(p.name)}|${lat.toFixed(2)}|${lng.toFixed(2)}`;
      if (seen.has(key) || seen.has(fingerprint)) continue;
      seen.add(key);
      seen.add(fingerprint);

      const isSettlement = p.osm_key === 'place' && ['city', 'town', 'village', 'hamlet', 'suburb'].includes(p.osm_value ?? '');
      const addressParts = [
        [p.housenumber, p.street].filter(Boolean).join(' '),
        p.locality,
        p.district,
        p.city,
        p.county,
        p.state,
        p.country,
      ].filter((part, index, all): part is string => !!part && part !== p.name && all.indexOf(part) === index);

      result.push({
        key,
        name: p.name,
        address: addressParts.join(', '),
        city: isSettlement ? p.name : (p.city ?? p.county ?? p.state),
        country: p.country,
        countryCode: p.countrycode,
        coordinates: { lat, lng },
        category: inferCategory(p.osm_key ?? '', p.osm_value ?? ''),
        kind: `${p.osm_key ?? ''}:${p.osm_value ?? ''}`,
      });
    }
    return result;
  }
}
