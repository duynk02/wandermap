-- WanderMap independent PostgreSQL schema.
-- The application owns authentication; this migration intentionally has no Supabase auth/RLS dependency.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text,
  google_subject text UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  email_verified_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_not_blank CHECK (length(trim(email)) > 3)
);
CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email));

CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username text NOT NULL,
  display_name text NOT NULL,
  avatar_url text,
  bio text,
  country_count integer NOT NULL DEFAULT 0 CHECK (country_count >= 0),
  total_posts integer NOT NULL DEFAULT 0 CHECK (total_posts >= 0),
  followers_count integer NOT NULL DEFAULT 0 CHECK (followers_count >= 0),
  following_count integer NOT NULL DEFAULT 0 CHECK (following_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_username_format CHECK (username ~ '^[a-zA-Z0-9_]{3,30}$'),
  CONSTRAINT profiles_display_name_not_blank CHECK (length(trim(display_name)) > 0)
);
CREATE UNIQUE INDEX profiles_username_lower_unique ON profiles (lower(username));

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  coordinates geometry(Point, 4326) NOT NULL,
  country text,
  city text,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('camping','cafe','heritage','beach','mountain','street_food','waterfall','village','other')),
  google_place_id text UNIQUE,
  post_count integer NOT NULL DEFAULT 0 CHECK (post_count >= 0),
  avg_rating numeric(2,1) CHECK (avg_rating IS NULL OR avg_rating BETWEEN 1 AND 5),
  trending_score double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locations_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT locations_coordinate_srid CHECK (ST_SRID(coordinates) = 4326)
);
CREATE INDEX locations_coordinates_gist_idx ON locations USING GIST (coordinates);
CREATE INDEX locations_trending_idx ON locations (trending_score DESC, post_count DESC);
CREATE INDEX locations_category_idx ON locations (category);
CREATE INDEX locations_country_city_idx ON locations (country, city);
CREATE INDEX locations_name_search_idx ON locations USING GIN (to_tsvector('simple', name));

CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  content text NOT NULL,
  images text[] NOT NULL DEFAULT '{}',
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  visited_at date NOT NULL,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','followers','private')),
  likes_count integer NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
  saves_count integer NOT NULL DEFAULT 0 CHECK (saves_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT posts_content_not_blank CHECK (length(trim(content)) > 0),
  CONSTRAINT posts_images_limit CHECK (cardinality(images) <= 20)
);
CREATE INDEX posts_author_created_idx ON posts (author_id, created_at DESC, id DESC);
CREATE INDEX posts_location_created_idx ON posts (location_id, created_at DESC, id DESC);
CREATE INDEX posts_public_created_idx ON posts (created_at DESC, id DESC) WHERE visibility = 'public';
CREATE INDEX posts_visibility_created_idx ON posts (visibility, created_at DESC, id DESC);

CREATE TABLE itineraries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  cover_image text,
  is_public boolean NOT NULL DEFAULT true,
  total_days integer NOT NULL DEFAULT 1 CHECK (total_days >= 1 AND total_days <= 365),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT itineraries_title_not_blank CHECK (length(trim(title)) > 0)
);
CREATE INDEX itineraries_author_created_idx ON itineraries (author_id, created_at DESC);
CREATE INDEX itineraries_public_created_idx ON itineraries (created_at DESC) WHERE is_public = true;

CREATE TABLE itinerary_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_id uuid NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  day_number integer NOT NULL DEFAULT 1 CHECK (day_number >= 1),
  order_in_day integer NOT NULL DEFAULT 1 CHECK (order_in_day >= 1),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT itinerary_stop_order_unique UNIQUE (itinerary_id, day_number, order_in_day)
);
CREATE INDEX itinerary_stops_itinerary_idx ON itinerary_stops (itinerary_id, day_number, order_in_day);

CREATE TABLE follows (
  follower_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX follows_following_idx ON follows (following_id, created_at DESC);

CREATE TABLE likes (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX likes_post_idx ON likes (post_id, created_at DESC);

CREATE TABLE saves (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX saves_user_idx ON saves (user_id, created_at DESC);

CREATE TABLE user_pins (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('visited', 'wishlist')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, location_id)
);
CREATE INDEX user_pins_location_idx ON user_pins (location_id, status);
CREATE INDEX user_pins_user_status_idx ON user_pins (user_id, status, created_at DESC);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by_session_id uuid REFERENCES auth_sessions(id) ON DELETE SET NULL,
  user_agent text,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id, created_at DESC);
CREATE INDEX auth_sessions_active_idx ON auth_sessions (expires_at) WHERE revoked_at IS NULL;

-- Keep updated_at consistent across mutable domain records.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER locations_set_updated_at BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER posts_set_updated_at BEFORE UPDATE OF author_id, location_id, content, images, rating, visited_at, visibility ON posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER itineraries_set_updated_at BEFORE UPDATE ON itineraries FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_pins_set_updated_at BEFORE UPDATE ON user_pins FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Maintain denormalized location and profile counters in the database so every write path stays consistent.
CREATE OR REPLACE FUNCTION refresh_location_post_stats(target_location_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF target_location_id IS NULL THEN RETURN; END IF;
  UPDATE locations l SET
    post_count = stats.post_count,
    avg_rating = stats.avg_rating
  FROM (
    SELECT COUNT(*)::integer AS post_count, AVG(rating)::numeric(2,1) AS avg_rating
    FROM posts WHERE location_id = target_location_id
  ) stats
  WHERE l.id = target_location_id;
END; $$;

CREATE OR REPLACE FUNCTION posts_stats_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_location_post_stats(OLD.location_id);
    UPDATE profiles SET total_posts = (SELECT COUNT(*)::integer FROM posts WHERE author_id = OLD.author_id) WHERE id = OLD.author_id;
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM refresh_location_post_stats(NEW.location_id);
    UPDATE profiles SET total_posts = (SELECT COUNT(*)::integer FROM posts WHERE author_id = NEW.author_id) WHERE id = NEW.author_id;
    RETURN NEW;
  ELSE
    -- Like/save counter updates also update posts; avoid recomputing aggregate stats unless a relevant field changed.
    IF OLD.location_id IS NOT DISTINCT FROM NEW.location_id
       AND OLD.author_id IS NOT DISTINCT FROM NEW.author_id
       AND OLD.rating IS NOT DISTINCT FROM NEW.rating THEN
      RETURN NEW;
    END IF;
    IF OLD.location_id IS DISTINCT FROM NEW.location_id THEN
      PERFORM refresh_location_post_stats(OLD.location_id);
      PERFORM refresh_location_post_stats(NEW.location_id);
    ELSE
      PERFORM refresh_location_post_stats(NEW.location_id);
    END IF;
    IF OLD.author_id IS DISTINCT FROM NEW.author_id THEN
      UPDATE profiles SET total_posts = (SELECT COUNT(*)::integer FROM posts WHERE author_id = OLD.author_id) WHERE id = OLD.author_id;
      UPDATE profiles SET total_posts = (SELECT COUNT(*)::integer FROM posts WHERE author_id = NEW.author_id) WHERE id = NEW.author_id;
    ELSE
      UPDATE profiles SET total_posts = (SELECT COUNT(*)::integer FROM posts WHERE author_id = NEW.author_id) WHERE id = NEW.author_id;
    END IF;
    RETURN NEW;
  END IF;
END; $$;
CREATE TRIGGER posts_refresh_stats AFTER INSERT OR UPDATE OR DELETE ON posts FOR EACH ROW EXECUTE FUNCTION posts_stats_trigger();

CREATE OR REPLACE FUNCTION likes_count_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id; RETURN NEW;
  ELSE UPDATE posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id; RETURN OLD; END IF;
END; $$;
CREATE TRIGGER likes_count_change AFTER INSERT OR DELETE ON likes FOR EACH ROW EXECUTE FUNCTION likes_count_trigger();

CREATE OR REPLACE FUNCTION saves_count_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN UPDATE posts SET saves_count = saves_count + 1 WHERE id = NEW.post_id; RETURN NEW;
  ELSE UPDATE posts SET saves_count = GREATEST(saves_count - 1, 0) WHERE id = OLD.post_id; RETURN OLD; END IF;
END; $$;
CREATE TRIGGER saves_count_change AFTER INSERT OR DELETE ON saves FOR EACH ROW EXECUTE FUNCTION saves_count_trigger();

CREATE OR REPLACE FUNCTION follows_count_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    UPDATE profiles SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
    RETURN NEW;
  ELSE
    UPDATE profiles SET following_count = GREATEST(following_count - 1, 0) WHERE id = OLD.follower_id;
    UPDATE profiles SET followers_count = GREATEST(followers_count - 1, 0) WHERE id = OLD.following_id;
    RETURN OLD;
  END IF;
END; $$;
CREATE TRIGGER follows_count_change AFTER INSERT OR DELETE ON follows FOR EACH ROW EXECUTE FUNCTION follows_count_trigger();

CREATE OR REPLACE FUNCTION refresh_profile_country_count(target_user_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE profiles p SET country_count = (
    SELECT COUNT(DISTINCT NULLIF(trim(l.country), ''))::integer
    FROM user_pins up JOIN locations l ON l.id = up.location_id
    WHERE up.user_id = target_user_id AND up.status = 'visited'
  ) WHERE p.id = target_user_id;
END; $$;
CREATE OR REPLACE FUNCTION user_pins_country_count_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM refresh_profile_country_count(OLD.user_id); RETURN OLD;
  ELSE
    PERFORM refresh_profile_country_count(NEW.user_id);
    IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN PERFORM refresh_profile_country_count(OLD.user_id); END IF;
    RETURN NEW;
  END IF;
END; $$;
CREATE TRIGGER user_pins_refresh_country_count AFTER INSERT OR UPDATE OR DELETE ON user_pins FOR EACH ROW EXECUTE FUNCTION user_pins_country_count_trigger();

CREATE OR REPLACE FUNCTION get_locations_in_viewport(
  min_lng double precision, min_lat double precision,
  max_lng double precision, max_lat double precision,
  result_limit integer DEFAULT 200
) RETURNS SETOF locations LANGUAGE sql STABLE AS $$
  SELECT l.* FROM locations l
  WHERE l.coordinates && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
  ORDER BY l.trending_score DESC, l.post_count DESC
  LIMIT LEAST(GREATEST(result_limit, 1), 500);
$$;

CREATE OR REPLACE FUNCTION refresh_trending_scores() RETURNS void LANGUAGE sql AS $$
  UPDATE locations l SET trending_score =
    COALESCE((SELECT COUNT(*) * 3 FROM posts p WHERE p.location_id = l.id AND p.created_at > now() - INTERVAL '7 days'), 0)
    + COALESCE(l.avg_rating * 10, 0)
    + LEAST(l.post_count, 50);
$$;
