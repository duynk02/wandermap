-- Comments can be edited; edited_at is shown as "đã chỉnh sửa". Deleting needs no schema change:
-- replies, likes and notifications go away through ON DELETE CASCADE and the counters are kept
-- exact by the triggers from migrations 003 and 004.
ALTER TABLE comments ADD COLUMN edited_at timestamptz;