-- Accent-insensitive, typo-tolerant location search (so "da lat" finds "Đà Lạt").
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- IMMUTABLE wrapper (unaccent() itself is only STABLE), required for generated columns and indexes.
-- Also folds đ/Đ explicitly and lowercases AFTER unaccent so it does not depend on the DB locale.
CREATE OR REPLACE FUNCTION vn_normalize(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT lower(replace(replace(public.unaccent('public.unaccent(input)'), 'Đ', 'd'), 'đ', 'd')) $$;

ALTER TABLE locations add COLUMN IF NOT EXISTS search_text text
    GENERATED ALWAYS AS (
        vn_normalize(
            coalesce(name, '') || ' ' || coalesce(city, '') || ' ' ||coalesce(country, '') || ' ' || coalesce(address, '')
        )
    ) STORED;
CREATE INDEX IF NOT EXISTS locations_search_text_idx ON locations USING gin (search_text gin_trgm_ops);