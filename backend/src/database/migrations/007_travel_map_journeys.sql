-- Phase 2 foundation. Existing pins, posts and itineraries remain authoritative
-- for their current APIs. Data cutover is coordinated with the visited API release.
CREATE TABLE user_visited_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  note text,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_visited_locations_user_location_unique UNIQUE (user_id, location_id),
  -- Composite reference keys prevent visits/stops from mixing owners or locations.
  CONSTRAINT user_visited_locations_identity_unique UNIQUE (id, user_id, location_id),
  CONSTRAINT user_visited_locations_note_length CHECK (note IS NULL OR char_length(note) <= 1000)
);
CREATE INDEX user_visited_locations_user_created_idx ON user_visited_locations (user_id, created_at DESC, id DESC);
CREATE INDEX user_visited_locations_public_user_idx ON user_visited_locations (user_id, created_at DESC, id DESC) WHERE visibility = 'public';
CREATE INDEX user_visited_locations_location_idx ON user_visited_locations (location_id);
CREATE TRIGGER user_visited_locations_set_updated_at BEFORE UPDATE ON user_visited_locations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A mark without a date needs no visit row. At date precision the MVP records
-- at most one visit per location per day; repeat visits on other days are valid.
CREATE TABLE user_location_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visited_location_id uuid NOT NULL,
  user_id uuid NOT NULL,
  location_id uuid NOT NULL,
  visited_at date NOT NULL CHECK (isfinite(visited_at)),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_location_visits_mark_fk FOREIGN KEY (visited_location_id, user_id, location_id)
    REFERENCES user_visited_locations (id, user_id, location_id) ON DELETE CASCADE,
  CONSTRAINT user_location_visits_mark_date_unique UNIQUE (visited_location_id, visited_at),
  CONSTRAINT user_location_visits_identity_unique UNIQUE (id, user_id, location_id),
  CONSTRAINT user_location_visits_note_length CHECK (note IS NULL OR char_length(note) <= 1000)
);
CREATE INDEX user_location_visits_user_date_idx ON user_location_visits (user_id, visited_at DESC, id DESC);
CREATE INDEX user_location_visits_location_idx ON user_location_visits (location_id);
CREATE TRIGGER user_location_visits_set_updated_at BEFORE UPDATE ON user_location_visits FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  cover_image_url text,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  style_config jsonb NOT NULL DEFAULT '{"version":1,"line_color":"#22c55e","line_style":"solid","show_labels":true,"show_order":true,"map_style":"outdoors-v12"}'::jsonb,
  -- The API uses compare-and-swap on revision for every aggregate mutation.
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journeys_owner_identity_unique UNIQUE (id, user_id),
  CONSTRAINT journeys_title_length CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT journeys_description_length CHECK (description IS NULL OR char_length(description) <= 5000),
  CONSTRAINT journeys_cover_url_length CHECK (cover_image_url IS NULL OR char_length(cover_image_url) <= 2048),
  CONSTRAINT journeys_style_object CHECK (jsonb_typeof(style_config) = 'object')
);
CREATE INDEX journeys_user_created_idx ON journeys (user_id, created_at DESC, id DESC);
CREATE INDEX journeys_public_created_idx ON journeys (created_at DESC, id DESC) WHERE visibility = 'public' AND status = 'published';
CREATE TRIGGER journeys_set_updated_at BEFORE UPDATE ON journeys FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE journey_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL,
  user_id uuid NOT NULL,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  visit_id uuid,
  stop_order integer NOT NULL CHECK (stop_order >= 1),
  -- Minimal history, captured by the service from authoritative rows, never
  -- accepted as client-supplied location/visit metadata. Geometry stays in locations.
  location_name_snapshot text NOT NULL,
  visited_at_snapshot date CHECK (visited_at_snapshot IS NULL OR isfinite(visited_at_snapshot)),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journey_stops_owner_fk FOREIGN KEY (journey_id, user_id)
    REFERENCES journeys (id, user_id) ON DELETE CASCADE,
  -- PostgreSQL 16 supports SET NULL for only the optional part of a composite FK.
  CONSTRAINT journey_stops_visit_fk FOREIGN KEY (visit_id, user_id, location_id)
    REFERENCES user_location_visits (id, user_id, location_id) ON DELETE SET NULL (visit_id),
  CONSTRAINT journey_stops_location_unique UNIQUE (journey_id, location_id),
  CONSTRAINT journey_stops_order_unique UNIQUE (journey_id, stop_order) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT journey_stops_name_length CHECK (char_length(btrim(location_name_snapshot)) BETWEEN 1 AND 200)
);
CREATE INDEX journey_stops_location_idx ON journey_stops (location_id);
CREATE INDEX journey_stops_visit_idx ON journey_stops (visit_id, user_id, location_id) WHERE visit_id IS NOT NULL;

-- Serialize stop writes with publication/other stop writes on the aggregate.
-- Services must also lock the journey and compare revision before making changes.
CREATE FUNCTION journey_stops_lock_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM id FROM journeys WHERE id = NEW.journey_id FOR UPDATE;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM id FROM journeys WHERE id = OLD.journey_id FOR UPDATE;
  ELSE
    PERFORM id FROM journeys WHERE id IN (OLD.journey_id, NEW.journey_id) ORDER BY id FOR UPDATE;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER journey_stops_lock_parent BEFORE INSERT OR UPDATE OR DELETE ON journey_stops FOR EACH ROW EXECUTE FUNCTION journey_stops_lock_parent();

CREATE FUNCTION validate_journey_stops(target_journey_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  journey_status text;
  stop_count integer;
  first_order integer;
  last_order integer;
BEGIN
  SELECT status INTO journey_status FROM journeys WHERE id = target_journey_id;
  IF NOT FOUND THEN RETURN; END IF; -- Aggregate was deleted (including cascading stops).
  SELECT count(*)::integer, min(stop_order), max(stop_order)
    INTO stop_count, first_order, last_order FROM journey_stops WHERE journey_id = target_journey_id;
  IF stop_count > 0 AND (first_order <> 1 OR last_order <> stop_count) THEN
    RAISE EXCEPTION 'journey stop order must be contiguous starting at 1'
      USING ERRCODE = '23514', CONSTRAINT = 'journey_stops_contiguous_order';
  END IF;
  IF journey_status = 'published' AND stop_count < 2 THEN
    RAISE EXCEPTION 'a published journey requires at least two stops'
      USING ERRCODE = '23514', CONSTRAINT = 'journeys_published_min_stops';
  END IF;
END; $$;

-- Validate the final transaction state, allowing atomic reorder/replace operations.
CREATE FUNCTION journey_stops_validate_aggregate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM validate_journey_stops(OLD.journey_id); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM validate_journey_stops(NEW.journey_id); END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER journey_stops_validate_aggregate AFTER INSERT OR UPDATE OR DELETE ON journey_stops
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journey_stops_validate_aggregate();

CREATE FUNCTION journeys_validate_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM validate_journey_stops(NEW.id);
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER journeys_validate_publication AFTER INSERT OR UPDATE ON journeys
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journeys_validate_publication();
