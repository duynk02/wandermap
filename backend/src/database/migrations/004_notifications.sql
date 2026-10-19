-- Notifications: one row per interaction (follow / like / comment on one of your posts).
-- Rows are created and removed by triggers on follows, likes and comments, so every code path is
-- covered and a notification always matches a real interaction (un-like / un-follow removes it).
-- Grouping ("A và B", "A và n người khác") is done when listing, not when storing.
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('follow', 'like', 'comment')),
  post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES comments(id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_not_self CHECK (recipient_id <> actor_id),
  CONSTRAINT notifications_shape CHECK (
    (type = 'follow' AND post_id IS NULL AND comment_id IS NULL) OR
    (type = 'like' AND post_id IS NOT NULL AND comment_id IS NULL) OR
    (type = 'comment' AND post_id IS NOT NULL AND comment_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX notifications_follow_uniq ON notifications (recipient_id, actor_id) WHERE type = 'follow';
CREATE UNIQUE INDEX notifications_like_uniq ON notifications (actor_id, post_id) WHERE type = 'like';
CREATE UNIQUE INDEX notifications_comment_uniq ON notifications (comment_id) WHERE type = 'comment';
CREATE INDEX notifications_recipient_idx ON notifications (recipient_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (recipient_id) WHERE read_at IS NULL;

CREATE OR REPLACE FUNCTION notify_on_follow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO notifications (recipient_id, actor_id, type) VALUES (NEW.following_id, NEW.follower_id, 'follow') ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;
  DELETE FROM notifications WHERE type = 'follow' AND recipient_id = OLD.following_id AND actor_id = OLD.follower_id;
  RETURN OLD;
END; $$;
CREATE TRIGGER follows_notify AFTER INSERT OR DELETE ON follows FOR EACH ROW EXECUTE FUNCTION notify_on_follow();

CREATE OR REPLACE FUNCTION notify_on_like() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO notifications (recipient_id, actor_id, type, post_id)
    SELECT p.author_id, NEW.user_id, 'like', NEW.post_id FROM posts p
    WHERE p.id = NEW.post_id AND p.author_id <> NEW.user_id
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;
  DELETE FROM notifications WHERE type = 'like' AND actor_id = OLD.user_id AND post_id = OLD.post_id;
  RETURN OLD;
END; $$;
CREATE TRIGGER likes_notify AFTER INSERT OR DELETE ON likes FOR EACH ROW EXECUTE FUNCTION notify_on_like();

-- Every comment on a post (replies included) notifies the post's author. Comments cannot be
-- deleted by users, so there is no delete trigger: rows disappear with the comment/post (FK cascade).
CREATE OR REPLACE FUNCTION notify_on_comment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notifications (recipient_id, actor_id, type, post_id, comment_id)
  SELECT p.author_id, NEW.author_id, 'comment', NEW.post_id, NEW.id FROM posts p
  WHERE p.id = NEW.post_id AND p.author_id <> NEW.author_id
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER comments_notify AFTER INSERT ON comments FOR EACH ROW EXECUTE FUNCTION notify_on_comment();