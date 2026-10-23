-- Existing domain triggers remain the only notification writers. PostgreSQL delivers
-- NOTIFY after the surrounding transaction commits; rolled-back writes deliver nothing.
CREATE FUNCTION notifications_realtime_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  notification notifications%ROWTYPE;
  change_kind text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.read_at IS NOT DISTINCT FROM OLD.read_at THEN RETURN NEW; END IF;
    notification := NEW;
    change_kind := 'read';
  ELSIF TG_OP = 'INSERT' THEN
    notification := NEW;
    change_kind := 'created';
  ELSE
    notification := OLD;
    change_kind := 'deleted';
  END IF;

  -- IDs and type only: notification content/private profile fields stay behind REST authorization.
  PERFORM pg_notify('wandermap_notifications', json_build_object(
    'notification_id', notification.id,
    'recipient_id', notification.recipient_id,
    'type', notification.type,
    'change', change_kind
  )::text);
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER notifications_realtime_insert_delete
AFTER INSERT OR DELETE ON notifications
FOR EACH ROW EXECUTE FUNCTION notifications_realtime_change();

CREATE TRIGGER notifications_realtime_read
AFTER UPDATE OF read_at ON notifications
FOR EACH ROW EXECUTE FUNCTION notifications_realtime_change();
