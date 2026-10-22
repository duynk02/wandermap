/** Use with a posts alias named p. Viewer is a SQL placeholder, never user input. */
export function journeyPostAccess(viewer = 'NULL::uuid'): string {
  return `EXISTS (SELECT 1 FROM users pu WHERE pu.id = p.author_id AND pu.is_active = true)
    AND (p.post_type = 'location' OR EXISTS (SELECT 1 FROM journeys pj WHERE pj.id = p.journey_id
      AND (p.author_id = ${viewer} OR (pj.visibility = 'public' AND pj.status = 'published'))))`;
}

export function postAccess(viewer = '$1'): string {
  return `(${journeyPostAccess(viewer)}) AND (p.visibility = 'public' OR p.author_id = ${viewer}
    OR (p.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${viewer} AND f.following_id = p.author_id)))`;
}
