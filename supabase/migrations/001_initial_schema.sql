-- ═══════════════════════════════════════════════════════════════
--  WanderMap — Initial Database Migration
--  Run: supabase db push  (or paste into Supabase SQL editor)
-- ═══════════════════════════════════════════════════════════════

-- Enable PostGIS for geospatial queries
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Profiles ─────────────────────────────────────────────────────────────────
CREATE TABLE profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      text UNIQUE NOT NULL,
  display_name  text NOT NULL,
  avatar_url    text,
  bio           text,
  country_count int  NOT NULL DEFAULT 0,
  total_posts   int  NOT NULL DEFAULT 0,
  followers_count int NOT NULL DEFAULT 0,
  following_count int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Locations ─────────────────────────────────────────────────────────────────
CREATE TABLE locations (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            text NOT NULL,
  address         text,
  coordinates     geometry(Point, 4326) NOT NULL,  -- SRID 4326 = WGS84 lat/lng
  country         text,
  city            text,
  category        text NOT NULL DEFAULT 'other'
                    CHECK (category IN ('camping','cafe','heritage','beach','mountain','street_food','waterfall','village','other')),
  google_place_id text UNIQUE,
  post_count      int  NOT NULL DEFAULT 0,
  avg_rating      decimal(2,1),
  trending_score  float NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Spatial index — critical for viewport queries
CREATE INDEX locations_coordinates_idx ON locations USING GIST(coordinates);
CREATE INDEX locations_trending_idx    ON locations (trending_score DESC);
CREATE INDEX locations_category_idx    ON locations (category);

-- ── Posts ─────────────────────────────────────────────────────────────────────
CREATE TABLE posts (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  content     text NOT NULL,
  images      text[] NOT NULL DEFAULT '{}',
  rating      int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  visited_at  date NOT NULL,
  visibility  text NOT NULL DEFAULT 'public'
                CHECK (visibility IN ('public','followers','private')),
  likes_count int NOT NULL DEFAULT 0,
  saves_count int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX posts_author_idx   ON posts (author_id, created_at DESC);
CREATE INDEX posts_location_idx ON posts (location_id, created_at DESC);

-- ── Itineraries ───────────────────────────────────────────────────────────────
CREATE TABLE itineraries (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  cover_image text,
  is_public   boolean NOT NULL DEFAULT true,
  total_days  int NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE itinerary_stops (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  itinerary_id  uuid NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
  location_id   uuid NOT NULL REFERENCES locations(id),
  day_number    int NOT NULL DEFAULT 1,
  order_in_day  int NOT NULL DEFAULT 1,
  note          text
);

-- ── Social tables ─────────────────────────────────────────────────────────────
CREATE TABLE follows (
  follower_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE TABLE likes (
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE saves (
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

-- User pins (visited vs wishlist on personal map)
CREATE TABLE user_pins (
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  status      text NOT NULL CHECK (status IN ('visited', 'wishlist')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, location_id)
);

-- ── Functions ─────────────────────────────────────────────────────────────────

-- 1. Fetch locations visible in current map viewport
CREATE OR REPLACE FUNCTION get_locations_in_viewport(
  min_lng float, min_lat float,
  max_lng float, max_lat float,
  result_limit int DEFAULT 200
)
RETURNS SETOF locations
LANGUAGE sql STABLE AS $$
  SELECT * FROM locations
  WHERE coordinates && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
  ORDER BY trending_score DESC
  LIMIT result_limit;
$$;

-- 2. Feed from followed users
CREATE OR REPLACE FUNCTION get_following_feed(
  viewer_id uuid,
  page_from int DEFAULT 0,
  page_to   int DEFAULT 11
)
RETURNS SETOF posts
LANGUAGE sql STABLE AS $$
  SELECT p.* FROM posts p
  JOIN follows f ON f.following_id = p.author_id
  WHERE f.follower_id = viewer_id
    AND p.visibility IN ('public', 'followers')
  ORDER BY p.created_at DESC
  OFFSET page_from LIMIT (page_to - page_from + 1);
$$;

-- 3. Update trending_score — call this from a cron job (pg_cron or Edge Function)
CREATE OR REPLACE FUNCTION refresh_trending_scores()
RETURNS void LANGUAGE sql AS $$
  UPDATE locations l
  SET trending_score = (
    -- Posts in last 7 days × recency weight
    COALESCE((
      SELECT COUNT(*) * 3 FROM posts p
      WHERE p.location_id = l.id
        AND p.created_at > now() - INTERVAL '7 days'
    ), 0)
    -- Avg rating boost
    + COALESCE(l.avg_rating * 10, 0)
    -- Total post volume (mild signal)
    + LEAST(l.post_count, 50)
  );
$$;

-- ── Triggers ──────────────────────────────────────────────────────────────────

-- Auto-create profile row on Supabase Auth signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    LOWER(REPLACE(SPLIT_PART(NEW.email, '@', 1), '.', '_')),  -- email prefix as username
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Keep post_count + avg_rating up to date on locations
CREATE OR REPLACE FUNCTION update_location_stats()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE locations
  SET
    post_count = (SELECT COUNT(*) FROM posts WHERE location_id = COALESCE(NEW.location_id, OLD.location_id)),
    avg_rating = (SELECT AVG(rating)::decimal(2,1) FROM posts WHERE location_id = COALESCE(NEW.location_id, OLD.location_id))
  WHERE id = COALESCE(NEW.location_id, OLD.location_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER on_post_change
  AFTER INSERT OR UPDATE OR DELETE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_location_stats();

-- Keep likes_count denormalized
CREATE OR REPLACE FUNCTION update_likes_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER on_like_change
  AFTER INSERT OR DELETE ON likes
  FOR EACH ROW EXECUTE FUNCTION update_likes_count();

-- Keep followers/following counts in sync
CREATE OR REPLACE FUNCTION update_follow_counts()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    UPDATE profiles SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE profiles SET following_count = GREATEST(following_count - 1, 0) WHERE id = OLD.follower_id;
    UPDATE profiles SET followers_count = GREATEST(followers_count - 1, 0) WHERE id = OLD.following_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER on_follow_change
  AFTER INSERT OR DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION update_follow_counts();

-- ── Row Level Security (RLS) ──────────────────────────────────────────────────

ALTER TABLE profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE itineraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows     ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE saves       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_pins   ENABLE ROW LEVEL SECURITY;

-- Profiles: public read, owner write
CREATE POLICY "profiles_public_read"  ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_owner_update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Locations: public read, authenticated write
CREATE POLICY "locations_public_read"  ON locations FOR SELECT USING (true);
CREATE POLICY "locations_auth_insert"  ON locations FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Posts: visibility-aware read, owner write
CREATE POLICY "posts_public_read" ON posts FOR SELECT USING (
  visibility = 'public'
  OR author_id = auth.uid()
  OR (visibility = 'followers' AND EXISTS (
    SELECT 1 FROM follows WHERE follower_id = auth.uid() AND following_id = author_id
  ))
);
CREATE POLICY "posts_owner_insert" ON posts FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "posts_owner_update" ON posts FOR UPDATE USING (auth.uid() = author_id);
CREATE POLICY "posts_owner_delete" ON posts FOR DELETE USING (auth.uid() = author_id);

-- Social: owner only
CREATE POLICY "likes_owner"    ON likes    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "saves_owner"    ON saves    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "follows_read"   ON follows  FOR SELECT USING (true);
CREATE POLICY "follows_owner"  ON follows  FOR INSERT WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "follows_delete" ON follows  FOR DELETE USING (auth.uid() = follower_id);
CREATE POLICY "pins_owner"     ON user_pins FOR ALL USING (auth.uid() = user_id);
