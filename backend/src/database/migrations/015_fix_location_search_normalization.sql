-- Append-only fix for 002. Run under the runner's transaction, with a reviewed lock window.
LOCK TABLE locations IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION vn_normalize(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT lower(replace(replace(public.unaccent('public.unaccent', input), 'Đ', 'd'), 'đ', 'd')) $$;

-- Replacing an IMMUTABLE function does not recompute existing STORED generated values.
-- Suppress only the timestamp trigger while backfilling; preserve its original mode.
DO $$
DECLARE original_mode "char";
BEGIN
  SELECT tgenabled INTO original_mode FROM pg_trigger
    WHERE tgrelid = 'locations'::regclass AND tgname = 'locations_set_updated_at';
  IF original_mode IS NULL THEN RAISE EXCEPTION 'Missing locations timestamp trigger.'; END IF;
  ALTER TABLE locations DISABLE TRIGGER locations_set_updated_at;
  UPDATE locations SET search_text = DEFAULT
    WHERE search_text IS DISTINCT FROM vn_normalize(
      coalesce(name, '') || ' ' || coalesce(city, '') || ' ' || coalesce(country, '') || ' ' || coalesce(address, ''));
  IF original_mode = 'O' THEN ALTER TABLE locations ENABLE TRIGGER locations_set_updated_at;
  ELSIF original_mode = 'A' THEN ALTER TABLE locations ENABLE ALWAYS TRIGGER locations_set_updated_at;
  ELSIF original_mode = 'R' THEN ALTER TABLE locations ENABLE REPLICA TRIGGER locations_set_updated_at;
  END IF;
END; $$;

-- Existing GIN/GiST indexes are retained. UPDATE maintains GIN entries automatically.
ANALYZE locations;
