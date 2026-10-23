-- Messaging-only blocks. History/membership remain intact; no changes to follows.
CREATE TABLE messaging_blocks (
  blocker_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT messaging_blocks_not_self CHECK (blocker_id <> blocked_id)
);
CREATE INDEX messaging_blocks_blocked_idx ON messaging_blocks (blocked_id, blocker_id);
COMMENT ON TABLE messaging_blocks IS 'Either direction prevents new direct conversations/messages. REST serializes block/send decisions with a canonical pair advisory transaction lock.';
