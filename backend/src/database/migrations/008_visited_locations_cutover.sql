-- Deploy with the Step 2 backend while old pin writers are stopped. The runner
-- executes this backfill atomically; existing pins and wishlist rows are retained.
LOCK TABLE user_pins IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE user_visited_locations IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO user_visited_locations (user_id, location_id, visibility, created_at, updated_at)
SELECT user_id, location_id, 'private', created_at, updated_at
FROM user_pins WHERE status = 'visited'
ON CONFLICT (user_id, location_id) DO NOTHING;

-- Legacy counter now derives from the canonical marks. Public API statistics
-- are calculated with viewer visibility instead of exposing this owner counter.
CREATE OR REPLACE FUNCTION refresh_profile_country_count(target_user_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE profiles p SET country_count = (
    SELECT COUNT(DISTINCT NULLIF(trim(l.country), ''))::integer
    FROM user_visited_locations v JOIN locations l ON l.id = v.location_id
    WHERE v.user_id = target_user_id
  ) WHERE p.id = target_user_id;
END; $$;

CREATE FUNCTION visited_locations_country_count_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_profile_country_count(OLD.user_id);
    RETURN OLD;
  END IF;
  PERFORM refresh_profile_country_count(NEW.user_id);
  IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    PERFORM refresh_profile_country_count(OLD.user_id);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER visited_locations_refresh_country_count AFTER INSERT OR UPDATE OR DELETE ON user_visited_locations
  FOR EACH ROW EXECUTE FUNCTION visited_locations_country_count_trigger();

SELECT refresh_profile_country_count(id) FROM profiles;
