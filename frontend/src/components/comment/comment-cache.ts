import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";
import type { PaginatedResponse, PostComment } from "@/types";

export type CommentPages = InfiniteData<PaginatedResponse<PostComment>, unknown>;

/**
 * Flattens loaded pages. Offset pagination can return the same comment twice when new ones are
 * posted while the user is paging, so duplicates are dropped (first occurrence wins).
 */
export function flattenComments(data?: CommentPages): PostComment[] {
  const seen = new Set<string>();
  const result: PostComment[] = [];
  for (const page of data?.pages ?? []) {
    for (const comment of page.data) {
      if (!seen.has(comment.id)) {
        seen.add(comment.id);
        result.push(comment);
      }
    }
  }
  return result;
}

/** Updates one comment in an already loaded list (no-op when the list is not in the cache). */
export function patchComment(
  queryClient: QueryClient,
  key: QueryKey,
  commentId: string,
  update: (comment: PostComment) => PostComment
) {
  queryClient.setQueryData<CommentPages>(key, (data) =>
    data && {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        data: page.data.map((comment) => (comment.id === commentId ? update(comment) : comment)),
      })),
    }
  );
}

/** Puts a new top-level comment at the top of a loaded list (newest first). */
export function prependComment(queryClient: QueryClient, key: QueryKey, comment: PostComment) {
  queryClient.setQueryData<CommentPages>(key, (data) => {
    if (!data || data.pages.length === 0) return data;
    const [first, ...rest] = data.pages;
    return { ...data, pages: [{ ...first, count: first.count + 1, data: [comment, ...first.data] }, ...rest] };
  });
}