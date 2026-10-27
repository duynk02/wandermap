import { DEFAULT_PAGE_SIZE } from "@/constants";
import type { FeedFilters, PaginatedResponse, Post, VisitPostSource } from "@/types";
import type { CreatePostInput } from "@/lib/validations";
import { ApiError, apiFetch } from "./client";
import type { JourneyPost } from "@/types";

export const getSharedJourneyPost = (journeyId: string) =>
  apiFetch<{ post: JourneyPost | null }>(`/posts/journey/${encodeURIComponent(journeyId)}`).then((result) => result.post);

export const shareJourney = (input: {
  journey_id: string;
  revision: number;
  content: string;
  preview_image_url: string;
}) => apiFetch<{ post: JourneyPost; created: boolean }>("/posts/journey", { method: "POST", body: input });

export const setPostSaved = (postId: string, saved: boolean) =>
  apiFetch<{ saved: boolean; saves_count: number }>(`/posts/${encodeURIComponent(postId)}/save`, {
    method: saved ? "POST" : "DELETE",
  });

/** Private bookmarks for the current session, newest saved first. */
export const getSavedPosts = (page = 1, signal?: AbortSignal) =>
  apiFetch<PaginatedResponse<Post>>("/posts/saved", {
    query: { page, pageSize: DEFAULT_PAGE_SIZE },
    signal,
  });

export const getPostsByLocation = (locationId: string, page = 1) =>
  apiFetch<PaginatedResponse<Post>>(`/posts/by-location/${encodeURIComponent(locationId)}`, {
    query: { page, pageSize: DEFAULT_PAGE_SIZE },
  });

/** Authenticated owner-only sources, filtered and paginated by the server. */
export const getMyPostsByLocation = (locationId: string, page = 1, signal?: AbortSignal) =>
  apiFetch<PaginatedResponse<VisitPostSource>>(`/posts/mine/by-location/${encodeURIComponent(locationId)}`, {
    query: { page, pageSize: DEFAULT_PAGE_SIZE },
    signal,
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

/**
 * One post. Resolves null when it does not exist OR is not visible to the caller
 * (the API answers 404), and when the id is not a UUID (the API answers 400).
 */
export async function getPostById(id: string): Promise<Post | null> {
  try {
    return await apiFetch<Post>(`/posts/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return null;
    throw error;
  }
}

/** Requires login. `location_id` must be an existing location (see createLocation). */
export const createPost = (input: CreatePostInput) =>
  apiFetch<Post>("/posts", { method: "POST", body: input });
