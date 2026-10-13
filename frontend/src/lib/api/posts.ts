import { DEFAULT_PAGE_SIZE } from "@/constants";
import type { FeedFilters, PaginatedResponse, Post } from "@/types";
import { apiFetch } from "./client";

export const getPostsByLocation = (locationId: string, page = 1) =>
  apiFetch<PaginatedResponse<Post>>(`/posts/by-location/${encodeURIComponent(locationId)}`, {
    query: { page, pageSize: DEFAULT_PAGE_SIZE },
  });

export const getPostsByAuthor = (username: string, page = 1) =>
  apiFetch<PaginatedResponse<Post>>(`/posts/by-author/${encodeURIComponent(username)}`, {
    query: { page, pageSize: DEFAULT_PAGE_SIZE },
  });

/** Public feed, or posts from followed users (requires login) when `following` is set. */
export const getFeed = (filters: FeedFilters = {}, page = 1) =>
  apiFetch<PaginatedResponse<Post>>(filters.following ? "/posts/following" : "/posts/feed", {
    query: {
      page,
      pageSize: DEFAULT_PAGE_SIZE,
      location_id: filters.location_id,
      // /posts/following has no author filter and rejects unknown params
      author_id: filters.following ? undefined : filters.author_id,
    },
  });

/** Like/unlike are idempotent on the API; returns the authoritative counter. */
export const setPostLiked = (postId: string, liked: boolean) =>
  apiFetch<{ liked: boolean; likes_count: number }>(
    `/posts/${encodeURIComponent(postId)}/like`,
    { method: liked ? "POST" : "DELETE" }
  );
