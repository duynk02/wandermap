-- Comments with a single reply level, plus comment likes. Counters are maintained by triggers
-- (same approach as likes/saves in 001) so they stay exact under concurrent requests.

ALTER TABLE posts ADD COLUMN comments_count integer NOT NULL DEFAULT 0 CHECK (comments_count >= 0);

CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES comments(id) ON DELETE CASCADE,
  content text NOT NULL,
  likes_count integer NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
  reply_count integer NOT NULL DEFAULT 0 CHECK (reply_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comments_content_length CHECK (length(btrim(content)) BETWEEN 1 AND 2000),
  CONSTRAINT comments_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
-- Top-level comments of a post, newest first.
CREATE INDEX comments_post_top_level_idx ON comments (post_id, created_at DESC, id DESC) WHERE parent_id IS NULL;
-- Replies of a comment, oldest first.
CREATE INDEX comments_parent_idx ON comments (parent_id, created_at ASC, id ASC) WHERE parent_id IS NOT NULL;

CREATE TABLE comment_likes (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, comment_id)
);
CREATE INDEX comment_likes_comment_idx ON comment_likes (comment_id);

-- One reply level only, enforced in the database as well as in the API: a parent must be a
-- top-level comment of the SAME post.
CREATE OR REPLACE FUNCTION comments_validate_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_row comments%ROWTYPE;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO parent_row FROM comments WHERE id = NEW.parent_id;
  IF NOT FOUND OR parent_row.post_id <> NEW.post_id THEN
    RAISE EXCEPTION 'parent comment must belong to the same post' USING ERRCODE = '23514';
  END IF;
  IF parent_row.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'replies can only target top-level comments' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER comments_validate_parent BEFORE INSERT ON comments FOR EACH ROW EXECUTE FUNCTION comments_validate_parent();

-- posts.comments_count counts every comment (top-level + replies); comments.reply_count counts replies.
CREATE OR REPLACE FUNCTION comments_count_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
    IF NEW.parent_id IS NOT NULL THEN
      UPDATE comments SET reply_count = reply_count + 1 WHERE id = NEW.parent_id;
    END IF;
    RETURN NEW;
  ELSE
    UPDATE posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.post_id;
    IF OLD.parent_id IS NOT NULL THEN
      UPDATE comments SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = OLD.parent_id;
    END IF;
    RETURN OLD;
  END IF;
END; $$;
CREATE TRIGGER comments_count_change AFTER INSERT OR DELETE ON comments FOR EACH ROW EXECUTE FUNCTION comments_count_trigger();

CREATE OR REPLACE FUNCTION comment_likes_count_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE comments SET likes_count = likes_count + 1 WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSE
    UPDATE comments SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
END; $$;
CREATE TRIGGER comment_likes_count_change AFTER INSERT OR DELETE ON comment_likes FOR EACH ROW EXECUTE FUNCTION comment_likes_count_trigger();