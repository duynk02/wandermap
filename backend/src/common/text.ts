/**
 * Lowercases, strips Vietnamese diacritics (including đ → d) and collapses whitespace.
 * Keep in sync with the SQL function vn_normalize() from migration 002.
 */

export function normalizeVietnamese(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}