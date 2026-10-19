import { create } from "zustand";

/**
 * What the signed-in user changed during this session, as "<viewerId>:<authorId>" -> following.
 * It overrides post.author.is_following (which is a snapshot from when the feed was loaded), so
 * every post by the same author updates at once after a follow/unfollow. Keyed by viewer so a
 * different account on the same tab never inherits it. Not persisted: the API is the source of
 * truth on the next load.
 */
interface FollowState {
  overrides: Readonly<Record<string, boolean>>;
  setFollowing: (key: string, following: boolean) => void;
}

export const useFollowStore = create<FollowState>()((set) => ({
  overrides: {},
  setFollowing: (key, following) =>
    set((state) => ({ overrides: { ...state.overrides, [key]: following } })),
}));