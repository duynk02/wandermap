/** SQL fragments accept trusted aliases/placeholders only, never request values. */
export const mutualFollow = (viewer: string, recipient: string) => `(
  EXISTS (SELECT 1 FROM follows mf WHERE mf.follower_id = ${viewer} AND mf.following_id = ${recipient})
  AND EXISTS (SELECT 1 FROM follows mf WHERE mf.follower_id = ${recipient} AND mf.following_id = ${viewer}))`;

export const messagingUnblocked = (viewer: string, recipient: string) => `NOT EXISTS (SELECT 1 FROM messaging_blocks mb
    WHERE (mb.blocker_id = ${viewer} AND mb.blocked_id = ${recipient})
       OR (mb.blocker_id = ${recipient} AND mb.blocked_id = ${viewer}))`;

export const messagingAllowed = (viewer: string, recipient: string) => `(${mutualFollow(viewer, recipient)}
  AND ${messagingUnblocked(viewer, recipient)})`;

export const relationshipFields = (viewer: string, recipient: string) => `
  EXISTS (SELECT 1 FROM follows rf WHERE rf.follower_id = ${viewer} AND rf.following_id = ${recipient}) AS is_following,
  EXISTS (SELECT 1 FROM follows rf WHERE rf.follower_id = ${recipient} AND rf.following_id = ${viewer}) AS follows_you,
  ${mutualFollow(viewer, recipient)} AS is_mutual,
  ${messagingAllowed(viewer, recipient)} AS can_message`;
