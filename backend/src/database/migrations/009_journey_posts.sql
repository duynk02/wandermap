-- Keep location posts intact while allowing a single, owner-linked post per Journey.
ALTER TABLE posts
  ADD COLUMN post_type text NOT NULL DEFAULT 'location',
  ADD COLUMN journey_id uuid,
  ADD COLUMN preview_revision integer,
  ALTER COLUMN location_id DROP NOT NULL,
  ALTER COLUMN rating DROP NOT NULL,
  ALTER COLUMN visited_at DROP NOT NULL,
  DROP CONSTRAINT posts_content_not_blank;

ALTER TABLE posts
  ADD CONSTRAINT posts_content_not_blank CHECK (post_type = 'journey' OR length(trim(content)) > 0),
  ADD CONSTRAINT posts_content_type CHECK (
    (post_type = 'location' AND location_id IS NOT NULL AND rating IS NOT NULL AND visited_at IS NOT NULL
      AND journey_id IS NULL AND preview_revision IS NULL)
    OR
    (post_type = 'journey' AND journey_id IS NOT NULL AND preview_revision IS NOT NULL AND preview_revision > 0
      AND location_id IS NULL AND rating IS NULL AND visited_at IS NULL)
  ),
  ADD CONSTRAINT posts_journey_owner_fk FOREIGN KEY (journey_id, author_id)
    REFERENCES journeys(id, user_id) ON DELETE CASCADE,
  ADD CONSTRAINT posts_one_per_journey UNIQUE (journey_id);

COMMENT ON COLUMN posts.preview_revision IS 'Journey revision when the static preview image was shared; Journey data remains live.';
