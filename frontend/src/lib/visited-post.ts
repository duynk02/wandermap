import type { VisitPostSource } from "../types";
import { isTravelDate } from "./validations/visited-locations";

/** Copy the travel date, never the post creation date or a timezone-shifted date. */
export function visitFieldsFromPost(post: Pick<VisitPostSource, "visited_at" | "content">) {
  const date = post.visited_at.slice(0, 10);
  const content = post.content.trim();
  // Match the form/API's UTF-16 length limit without cutting an emoji in half.
  const note = content.slice(0, 1000).replace(/[\uD800-\uDBFF]$/, "");
  return { visited_at: isTravelDate(date) ? date : "", note, truncated: content.length > note.length };
}
