import { COMMENTS_PAGE_SIZE } from "@/constants";
import type { CreateCommentResult, PaginatedResponse, PostComment } from "@/types";
import { apiFetch } from "./client";

/** Top-level comments of a post, newest first. Public for visible posts. */
export const getComments = (postId: string, page = 1, signal?: AbortSignal) =>
  apiFetch<PaginatedResponse<PostComment>>(`/posts/${encodeURIComponent(postId)}/comments`, {
    query: { page, pageSize: COMMENTS_PAGE_SIZE },
    signal,
  });

/** Replies of a top-level comment, oldest first. */
export const getReplies = (commentId: string, page = 1, signal?: AbortSignal) =>
  apiFetch<PaginatedResponse<PostComment>>(`/comments/${encodeURIComponent(commentId)}/replies`, {
    query: { page, pageSize: COMMENTS_PAGE_SIZE },
    signal,
  });

/** Requires login. Pass `parent_id` (a top-level comment of the same post) to reply. */
export const createComment = (postId: string, input: { content: string; parent_id?: string }) =>
  apiFetch<CreateCommentResult>(`/posts/${encodeURIComponent(postId)}/comments`, {
    method: "POST",
    body: input,
  });

/** Requires login. Like/unlike are idempotent on the API; returns the authoritative counter. */
export const setCommentLiked = (commentId: string, liked: boolean) =>
  apiFetch<{ liked: boolean; likes_count: number }>(
    `/comments/${encodeURIComponent(commentId)}/like`,
    { method: liked ? "POST" : "DELETE" }
  );