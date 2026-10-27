-- New assets only. No existing URL/file is changed or deleted.
CREATE TABLE media_assets (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('local', 'cloudinary')),
  storage_key text NOT NULL,
  version bigint,
  canonical_url text NOT NULL UNIQUE,
  width integer NOT NULL CHECK (width BETWEEN 1 AND 2048),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 2048),
  bytes integer NOT NULL CHECK (bytes BETWEEN 1 AND 10485760),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, storage_key),
  CHECK ((provider = 'local' AND version IS NULL) OR (provider = 'cloudinary' AND version > 0))
);
CREATE INDEX media_assets_owner_idx ON media_assets (owner_id, created_at DESC);
CREATE INDEX posts_media_urls_idx ON posts USING gin (images);
CREATE INDEX journeys_media_url_idx ON journeys (cover_image_url) WHERE cover_image_url IS NOT NULL;
CREATE INDEX profiles_media_url_idx ON profiles (avatar_url) WHERE avatar_url IS NOT NULL;
CREATE INDEX itineraries_media_url_idx ON itineraries (cover_image) WHERE cover_image IS NOT NULL;

-- A URL copy must not let a different owner publish another user's private asset.
CREATE FUNCTION assert_owned_media(urls text[], resource_owner uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE media_url text;
BEGIN
  FOREACH media_url IN ARRAY urls LOOP
    IF media_url LIKE '%/api/v1/media/%' THEN
      PERFORM 1 FROM media_assets WHERE canonical_url = media_url AND owner_id = resource_owner FOR KEY SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Invalid media reference.' USING ERRCODE = '23514'; END IF;
    END IF;
  END LOOP;
END; $$;

CREATE FUNCTION resource_media_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'posts' THEN PERFORM assert_owned_media(NEW.images, NEW.author_id);
  ELSIF TG_TABLE_NAME = 'journeys' THEN PERFORM assert_owned_media(ARRAY[NEW.cover_image_url], NEW.user_id);
  ELSIF TG_TABLE_NAME = 'profiles' THEN PERFORM assert_owned_media(ARRAY[NEW.avatar_url], NEW.id);
  ELSIF TG_TABLE_NAME = 'itineraries' THEN PERFORM assert_owned_media(ARRAY[NEW.cover_image], NEW.author_id);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER posts_media_ownership BEFORE INSERT OR UPDATE OF images, author_id ON posts
  FOR EACH ROW EXECUTE FUNCTION resource_media_ownership();
CREATE TRIGGER journeys_media_ownership BEFORE INSERT OR UPDATE OF cover_image_url, user_id ON journeys
  FOR EACH ROW EXECUTE FUNCTION resource_media_ownership();
CREATE TRIGGER profiles_media_ownership BEFORE INSERT OR UPDATE OF avatar_url, id ON profiles
  FOR EACH ROW EXECUTE FUNCTION resource_media_ownership();
CREATE TRIGGER itineraries_media_ownership BEFORE INSERT OR UPDATE OF cover_image, author_id ON itineraries
  FOR EACH ROW EXECUTE FUNCTION resource_media_ownership();
