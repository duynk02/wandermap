-- Optional request keys prevent HTTP retries from creating duplicate comments/notifications.
-- Existing comments and clients keep their behavior because NULL keys are unrestricted.
ALTER TABLE comments ADD COLUMN client_request_id uuid;
CREATE UNIQUE INDEX comments_author_request_uniq ON comments (author_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
