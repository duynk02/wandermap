-- Phase 4 / Feature 1. REST owns durable writes; these tables emit no socket events.
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'direct' CHECK (type = 'direct'),
  direct_user_low_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  direct_user_high_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_message_id uuid,
  last_message_at timestamptz,
  -- Allocation high-water mark, not a count: ON CONFLICT may leave gaps.
  message_sequence bigint NOT NULL DEFAULT 0 CHECK (message_sequence >= 0),
  CONSTRAINT conversations_direct_pair_order CHECK (direct_user_low_id < direct_user_high_id),
  CONSTRAINT conversations_direct_pair_unique UNIQUE (direct_user_low_id, direct_user_high_id),
  CONSTRAINT conversations_last_message_shape CHECK ((last_message_id IS NULL) = (last_message_at IS NULL))
);
CREATE INDEX conversations_direct_high_idx ON conversations (direct_user_high_id);
CREATE INDEX conversations_activity_idx ON conversations (COALESCE(last_message_at, created_at) DESC, id DESC);

CREATE TABLE conversation_participants (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) DEFERRABLE INITIALLY DEFERRED,
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- NULL means nothing read. This is the only read cursor; timestamps are informational.
  last_read_sequence bigint CHECK (last_read_sequence > 0),
  last_read_at timestamptz,
  archived_at timestamptz,
  PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT conversation_participants_read_shape CHECK ((last_read_sequence IS NULL) = (last_read_at IS NULL))
);
CREATE INDEX conversation_participants_user_idx ON conversation_participants (user_id, conversation_id);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  message_type text NOT NULL CHECK (message_type IN ('text', 'shared_post', 'shared_location', 'shared_journey')),
  content text,
  -- Immutable original resource identity supports retries after resource deletion.
  -- Only the typed, live FK may become NULL; no copied private preview metadata.
  shared_resource_id uuid,
  shared_post_id uuid REFERENCES posts(id) ON DELETE SET NULL,
  shared_location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  shared_journey_id uuid REFERENCES journeys(id) ON DELETE SET NULL,
  client_message_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT messages_sender_participant_fk FOREIGN KEY (conversation_id, sender_id)
    REFERENCES conversation_participants(conversation_id, user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT messages_sender_client_unique UNIQUE (sender_id, client_message_id),
  CONSTRAINT messages_conversation_sequence_unique UNIQUE (conversation_id, sequence),
  CONSTRAINT messages_conversation_identity_unique UNIQUE (conversation_id, id),
  CONSTRAINT messages_content_valid CHECK (content IS NULL OR (
    char_length(content) BETWEEN 1 AND 4000
    AND length(btrim(content, E' \t\n\r\f\013' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) > 0
  )),
  -- NULL live references are tombstones following resource deletion. The INSERT
  -- trigger always fills the applicable FK, so a new share must reference a real row.
  CONSTRAINT messages_payload_shape CHECK (
    (message_type = 'text' AND content IS NOT NULL AND shared_resource_id IS NULL
      AND shared_post_id IS NULL AND shared_location_id IS NULL AND shared_journey_id IS NULL)
    OR (message_type = 'shared_post' AND shared_resource_id IS NOT NULL
      AND (shared_post_id IS NULL OR shared_post_id = shared_resource_id)
      AND shared_location_id IS NULL AND shared_journey_id IS NULL)
    OR (message_type = 'shared_location' AND shared_resource_id IS NOT NULL
      AND (shared_location_id IS NULL OR shared_location_id = shared_resource_id)
      AND shared_post_id IS NULL AND shared_journey_id IS NULL)
    OR (message_type = 'shared_journey' AND shared_resource_id IS NOT NULL
      AND (shared_journey_id IS NULL OR shared_journey_id = shared_resource_id)
      AND shared_post_id IS NULL AND shared_location_id IS NULL)
  )
);
CREATE INDEX messages_shared_post_idx ON messages (shared_post_id) WHERE shared_post_id IS NOT NULL;
CREATE INDEX messages_shared_location_idx ON messages (shared_location_id) WHERE shared_location_id IS NOT NULL;
CREATE INDEX messages_shared_journey_idx ON messages (shared_journey_id) WHERE shared_journey_id IS NOT NULL;
-- The unique (conversation_id, sequence) B-tree supports older/newer cursor scans
-- in both directions, including unread counts and soft-deleted tombstones.
ALTER TABLE conversations ADD CONSTRAINT conversations_last_message_fk
  FOREIGN KEY (id, last_message_id) REFERENCES messages(conversation_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE conversation_participants ADD CONSTRAINT conversation_participants_read_message_fk
  FOREIGN KEY (conversation_id, last_read_sequence) REFERENCES messages(conversation_id, sequence) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION conversations_guard_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  first_user uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    first_user := LEAST(NEW.direct_user_low_id, NEW.direct_user_high_id);
    NEW.direct_user_high_id := GREATEST(NEW.direct_user_low_id, NEW.direct_user_high_id);
    NEW.direct_user_low_id := first_user;
    NEW.message_sequence := 0;
    NEW.last_message_id := NULL;
    NEW.last_message_at := NULL;
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
  ELSIF ROW(NEW.id, NEW.type, NEW.direct_user_low_id, NEW.direct_user_high_id, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.type, OLD.direct_user_low_id, OLD.direct_user_high_id, OLD.created_at) THEN
    RAISE EXCEPTION 'direct conversation identity is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'conversations_identity_immutable';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER conversations_guard_identity BEFORE INSERT OR UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION conversations_guard_identity();

CREATE FUNCTION conversation_participants_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Conversation/profile deletion may cascade; removing one participant alone may not.
    IF EXISTS (SELECT 1 FROM conversations WHERE id = OLD.conversation_id) THEN
      RAISE EXCEPTION 'direct participants cannot be removed'
        USING ERRCODE = '23514', CONSTRAINT = 'conversation_participants_immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM conversations WHERE id = NEW.conversation_id
      AND NEW.user_id IN (direct_user_low_id, direct_user_high_id)) THEN
      RAISE EXCEPTION 'participant must belong to the canonical direct pair'
        USING ERRCODE = '23514', CONSTRAINT = 'conversation_participants_direct_pair';
    END IF;
    NEW.joined_at := clock_timestamp();
    NEW.last_read_sequence := NULL;
    NEW.last_read_at := NULL;
  ELSE
    IF ROW(NEW.conversation_id, NEW.user_id, NEW.joined_at)
      IS DISTINCT FROM ROW(OLD.conversation_id, OLD.user_id, OLD.joined_at) THEN
      RAISE EXCEPTION 'direct participant identity is immutable'
        USING ERRCODE = '23514', CONSTRAINT = 'conversation_participants_immutable';
    END IF;
    -- Validate the requested target before clamping a stale device's read cursor.
    IF NEW.last_read_sequence IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM messages WHERE conversation_id = NEW.conversation_id AND sequence = NEW.last_read_sequence
    ) THEN
      RAISE EXCEPTION 'read cursor must reference a message in this conversation'
        USING ERRCODE = '23503', CONSTRAINT = 'conversation_participants_read_message_fk';
    END IF;
    NEW.last_read_sequence := GREATEST(OLD.last_read_sequence, NEW.last_read_sequence);
    IF NEW.last_read_sequence IS DISTINCT FROM OLD.last_read_sequence THEN
      NEW.last_read_at := clock_timestamp();
    ELSE
      NEW.last_read_at := OLD.last_read_at;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER conversation_participants_guard BEFORE INSERT OR UPDATE OR DELETE ON conversation_participants
  FOR EACH ROW EXECUTE FUNCTION conversation_participants_guard();

CREATE FUNCTION conversations_add_direct_participants() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (NEW.id, NEW.direct_user_low_id), (NEW.id, NEW.direct_user_high_id);
  RETURN NULL;
END; $$;
CREATE TRIGGER conversations_add_direct_participants AFTER INSERT ON conversations
  FOR EACH ROW EXECUTE FUNCTION conversations_add_direct_participants();

CREATE FUNCTION messages_prepare_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Serialize allocation until COMMIT/ROLLBACK, not merely sequence assignment.
  -- A later committed message can never appear below an already observed cursor.
  UPDATE conversations SET message_sequence = message_sequence + 1 WHERE id = NEW.conversation_id
    RETURNING message_sequence INTO NEW.sequence;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation does not exist'
      USING ERRCODE = '23503', CONSTRAINT = 'messages_conversation_id_fkey';
  END IF;
  NEW.created_at := clock_timestamp();
  NEW.updated_at := NEW.created_at;
  NEW.deleted_at := NULL;
  NEW.shared_post_id := CASE WHEN NEW.message_type = 'shared_post' THEN NEW.shared_resource_id END;
  NEW.shared_location_id := CASE WHEN NEW.message_type = 'shared_location' THEN NEW.shared_resource_id END;
  NEW.shared_journey_id := CASE WHEN NEW.message_type = 'shared_journey' THEN NEW.shared_resource_id END;
  RETURN NEW;
END; $$;
CREATE TRIGGER messages_prepare_insert BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION messages_prepare_insert();

CREATE FUNCTION messages_update_conversation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE conversations SET last_message_id = NEW.id, last_message_at = NEW.created_at, updated_at = NEW.created_at
    WHERE id = NEW.conversation_id;
  RETURN NULL;
END; $$;
CREATE TRIGGER messages_update_conversation AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION messages_update_conversation();

CREATE FUNCTION messages_guard_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM conversations WHERE id = OLD.conversation_id) THEN
      RAISE EXCEPTION 'messages must be soft deleted to retain cursors and idempotency keys'
        USING ERRCODE = '23514', CONSTRAINT = 'messages_no_hard_delete';
    END IF;
    RETURN OLD;
  END IF;
  IF ROW(NEW.id, NEW.conversation_id, NEW.sender_id, NEW.sequence, NEW.client_message_id,
    NEW.message_type, NEW.content, NEW.shared_resource_id, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.conversation_id, OLD.sender_id, OLD.sequence, OLD.client_message_id,
    OLD.message_type, OLD.content, OLD.shared_resource_id, OLD.created_at) THEN
    RAISE EXCEPTION 'message identity and request payload are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'messages_payload_immutable';
  END IF;
  -- Live references can only be cleared by deletion of the authoritative resource.
  IF (NEW.shared_post_id IS DISTINCT FROM OLD.shared_post_id AND NOT (
      OLD.shared_post_id IS NOT NULL AND NEW.shared_post_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM posts WHERE id = OLD.shared_post_id)))
    OR (NEW.shared_location_id IS DISTINCT FROM OLD.shared_location_id AND NOT (
      OLD.shared_location_id IS NOT NULL AND NEW.shared_location_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM locations WHERE id = OLD.shared_location_id)))
    OR (NEW.shared_journey_id IS DISTINCT FROM OLD.shared_journey_id AND NOT (
      OLD.shared_journey_id IS NOT NULL AND NEW.shared_journey_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM journeys WHERE id = OLD.shared_journey_id))) THEN
    RAISE EXCEPTION 'shared resource references are immutable until resource deletion'
      USING ERRCODE = '23514', CONSTRAINT = 'messages_resource_immutable';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'deleted messages cannot be restored'
      USING ERRCODE = '23514', CONSTRAINT = 'messages_deletion_monotonic';
  END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN NEW.deleted_at := clock_timestamp(); END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END; $$;
CREATE TRIGGER messages_guard_mutation BEFORE UPDATE OR DELETE ON messages FOR EACH ROW EXECUTE FUNCTION messages_guard_mutation();

COMMENT ON TABLE conversations IS 'Direct pairs are canonical and unique. Participants are created atomically by trigger. Future group support requires a new migration.';
COMMENT ON COLUMN messages.client_message_id IS 'Sender-scoped retry key. REST must compare conversation/type/content/shared_resource_id on conflict and return the original message or HTTP 409.';
COMMENT ON COLUMN messages.sequence IS 'Server-assigned conversation order; expose bigint as decimal string to JavaScript clients.';
COMMENT ON COLUMN conversation_participants.last_read_sequence IS 'Monotonic server-authoritative read cursor. Unread excludes own and soft-deleted messages.';
