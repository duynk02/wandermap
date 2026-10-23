-- Extend existing notifications without changing historical rows or replaying old interactions.
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('follow', 'like', 'comment', 'comment_like', 'reply'));
ALTER TABLE notifications DROP CONSTRAINT notifications_shape;
ALTER TABLE notifications ADD CONSTRAINT notifications_shape CHECK (
  (type = 'follow' AND post_id IS NULL AND comment_id IS NULL) OR
  (type = 'like' AND post_id IS NOT NULL AND comment_id IS NULL) OR
  (type IN ('comment', 'comment_like', 'reply') AND post_id IS NOT NULL AND comment_id IS NOT NULL)
);

CREATE UNIQUE INDEX notifications_comment_like_uniq ON notifications (actor_id, comment_id)
  WHERE type = 'comment_like';
CREATE UNIQUE INDEX notifications_reply_uniq ON notifications (comment_id) WHERE type = 'reply';

CREATE FUNCTION notify_on_comment_like() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO notifications (recipient_id, actor_id, type, post_id, comment_id)
    SELECT c.author_id, NEW.user_id, 'comment_like', c.post_id, c.id FROM comments c
    WHERE c.id = NEW.comment_id AND c.author_id <> NEW.user_id
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;
  DELETE FROM notifications
  WHERE type = 'comment_like' AND actor_id = OLD.user_id AND comment_id = OLD.comment_id;
  RETURN OLD;
END; $$;
CREATE TRIGGER comment_likes_notify AFTER INSERT OR DELETE ON comment_likes
FOR EACH ROW EXECUTE FUNCTION notify_on_comment_like();

CREATE OR REPLACE FUNCTION notify_on_comment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_author uuid;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT author_id INTO parent_author FROM comments WHERE id = NEW.parent_id;
    INSERT INTO notifications (recipient_id, actor_id, type, post_id, comment_id)
    SELECT parent_author, NEW.author_id, 'reply', NEW.post_id, NEW.id
    WHERE parent_author <> NEW.author_id
    ON CONFLICT DO NOTHING;
  END IF;

  -- Preserve post-owner notifications, but send only the reply when the owner is also
  -- the parent author. Self replies can still notify a different post owner.
  INSERT INTO notifications (recipient_id, actor_id, type, post_id, comment_id)
  SELECT p.author_id, NEW.author_id, 'comment', NEW.post_id, NEW.id FROM posts p
  WHERE p.id = NEW.post_id AND p.author_id <> NEW.author_id
    AND p.author_id IS DISTINCT FROM parent_author
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
