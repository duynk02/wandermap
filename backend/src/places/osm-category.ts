export type PlaceCategory =
  | 'camping' | 'cafe' | 'heritage' | 'beach' | 'mountain' | 'street_food' | 'waterfall' | 'village' | 'other';

/** Maps an OpenStreetMap key/value pair onto WanderMap's location categories. */
export function inferCategory(key: string, value: string): PlaceCategory {
  switch (key) {
    case 'waterway':
      return value === 'waterfall' ? 'waterfall' : 'other';
    case 'natural':
      if (value === 'waterfall') return 'waterfall';
      if (['beach', 'bay', 'cape'].includes(value)) return 'beach';
      if (['peak', 'volcano', 'ridge', 'saddle', 'mountain_pass', 'hill'].includes(value)) return 'mountain';
      return 'other';
    case 'tourism':
      if (['camp_site', 'caravan_site', 'camp_pitch'].includes(value)) return 'camping';
      if (['museum', 'gallery'].includes(value)) return 'heritage';
      return 'other';
    case 'leisure':
      return value === 'beach_resort' ? 'beach' : 'other';
    case 'amenity':
      if (['cafe', 'coffee_shop'].includes(value)) return 'cafe';
      if (['restaurant', 'fast_food', 'food_court', 'marketplace', 'street_vendor'].includes(value)) return 'street_food';
      if (value === 'place_of_worship') return 'heritage';
      return 'other';
    case 'shop':
      return value === 'coffee' ? 'cafe' : 'other';
    case 'historic':
      return 'heritage';
    case 'place':
      return ['village', 'hamlet', 'isolated_dwelling'].includes(value) ? 'village' : 'other';
    default:
      return 'other';
  }
}