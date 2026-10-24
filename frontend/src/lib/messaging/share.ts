import type { Journey, Location, Post } from "@/types";
import type {
  MessageType,
  SendMessageInput,
  SharedMessageResource,
} from "@/types/messaging";

export type SharedContentType = Exclude<MessageType, "text">;
export interface ShareTarget {
  type: SharedContentType;
  id: string;
  preview: SharedMessageResource;
  restriction: string | null;
}
const resource = (id: string, title: string): SharedMessageResource => ({
  available: true,
  id,
  title,
  image_url: null,
  author: null,
  location: null,
  address: null,
  category: null,
});

export function postShareTarget(post: Post): ShareTarget {
  return {
    type: "shared_post",
    id: post.id,
    preview: {
      ...resource(post.id, post.content.slice(0, 180)),
      image_url: post.images[0] ?? null,
      author: post.author
        ? {
            id: post.author.id,
            username: post.author.username,
            display_name: post.author.display_name,
            avatar_url: post.author.avatar_url,
          }
        : null,
      location: post.location
        ? { id: post.location.id, name: post.location.name }
        : null,
    },
    restriction:
      post.visibility === "private"
        ? "Bài viết riêng tư chỉ có bạn xem được. Hãy thay đổi quyền xem trước khi chia sẻ."
        : post.post_type === "journey" &&
            (post.journey.visibility !== "public" ||
              post.journey.status !== "published")
          ? "Hành trình của bài viết cần được xuất bản công khai trước khi chia sẻ."
          : null,
  };
}
export function locationShareTarget(location: Location): ShareTarget {
  return {
    type: "shared_location",
    id: location.id,
    restriction: null,
    preview: {
      ...resource(location.id, location.name),
      location: { id: location.id, name: location.name },
      address:
        location.address ??
        [location.city, location.country].filter(Boolean).join(", "),
      category: location.category,
    },
  };
}
export function journeyShareTarget(journey: Journey): ShareTarget {
  return {
    type: "shared_journey",
    id: journey.id,
    preview: {
      ...resource(journey.id, journey.title),
      image_url: journey.cover_image_url,
      author: journey.author,
    },
    restriction:
      journey.visibility !== "public" || journey.status !== "published"
        ? "Hãy xuất bản hành trình công khai trước khi gửi cho bạn đồng hành."
        : null,
  };
}

export type ShareDestination = {
  kind: "conversation" | "user";
  id: string;
  recipient_id?: string;
};
export interface ShareAttempt {
  input: SendMessageInput;
  status: "pending" | "failed";
}
export function shareAttemptKey(
  target: Pick<ShareTarget, "type" | "id">,
  destination: ShareDestination,
): string {
  const recipient =
    destination.kind === "user" ? destination.id : destination.recipient_id;
  return `${target.type}:${target.id}:${recipient ? `user:${recipient}` : `conversation:${destination.id}`}`;
}
/** Freeze one idempotency payload for a retry; deliberate edits create a new operation. */
export function prepareSharedMessage(
  target: Pick<ShareTarget, "type" | "id">,
  content: string,
  previous?: SendMessageInput,
): SendMessageInput {
  const caption = content.trim() || null;
  if (
    previous &&
    previous.message_type === target.type &&
    previous.shared_resource_id === target.id &&
    previous.content === caption
  )
    return previous;
  return {
    client_message_id: crypto.randomUUID(),
    message_type: target.type,
    shared_resource_id: target.id,
    content: caption,
  };
}
