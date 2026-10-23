import type { ChatMessage, Conversation } from "@/types/messaging";

export const MESSAGE_MAX_LENGTH = 4000;

/** Match the backend's trim transform and validator.js MaxLength Unicode rules. */
export function messageTextLength(text: string): number {
  const content = text.trim();
  const presentationSequences =
    content.match(/[^\uFE0F\uFE0E][\uFE0F\uFE0E]/g)?.length ?? 0;
  const surrogatePairs =
    content.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0;
  return content.length - presentationSequences - surrogatePairs;
}

export function validateMessageText(text: string): string | null {
  if (!text.trim()) return "Vui lòng nhập nội dung tin nhắn.";
  if (messageTextLength(text) > MESSAGE_MAX_LENGTH) {
    return `Tin nhắn không được vượt quá ${MESSAGE_MAX_LENGTH} ký tự.`;
  }
  return null;
}

export interface LocalMessage {
  client_message_id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  status: "pending" | "failed";
  error?: string;
}

export type DisplayMessage =
  | { kind: "server"; key: string; message: ChatMessage }
  | { kind: "local"; key: string; message: LocalMessage };

const messageKey = (
  message: Pick<ChatMessage, "sender_id" | "client_message_id">,
) => `${message.sender_id}:${message.client_message_id}`;

/** Keep the newest authoritative version when overlapping pages include the same row. */
function preferredMessage(
  previous: ChatMessage,
  incoming: ChatMessage,
): ChatMessage {
  const previousTime = Date.parse(previous.updated_at);
  const incomingTime = Date.parse(incoming.updated_at);
  if (previousTime !== incomingTime)
    return incomingTime > previousTime ? incoming : previous;
  if (previous.deleted_at && !incoming.deleted_at) return previous;
  return incoming;
}

/**
 * REST responses, socket lookups and optimistic submissions share a sender/client key.
 * Only committed messages have a sequence. Pending rows follow those rows without
 * inventing a cursor that could accidentally be sent as an acknowledged read state.
 */
export function mergeDisplayMessages(
  server: readonly ChatMessage[],
  local: readonly LocalMessage[],
): DisplayMessage[] {
  type Group = { message: ChatMessage; ids: Set<string>; keys: Set<string> };
  const groups = new Set<Group>();
  const byId = new Map<string, Group>();
  const byKey = new Map<string, Group>();
  for (const message of server) {
    const key = messageKey(message);
    const idGroup = byId.get(message.id),
      keyGroup = byKey.get(key);
    const group = idGroup ??
      keyGroup ?? { message, ids: new Set<string>(), keys: new Set<string>() };
    // Keep both aliases when overlapping cache copies connect two identity groups.
    if (idGroup && keyGroup && idGroup !== keyGroup) {
      group.message = preferredMessage(group.message, keyGroup.message);
      for (const id of keyGroup.ids) {
        group.ids.add(id);
        byId.set(id, group);
      }
      for (const alias of keyGroup.keys) {
        group.keys.add(alias);
        byKey.set(alias, group);
      }
      groups.delete(keyGroup);
    }
    group.message = preferredMessage(group.message, message);
    group.ids.add(message.id);
    group.keys.add(key);
    byId.set(message.id, group);
    byKey.set(key, group);
    groups.add(group);
  }
  const committed = [...groups].map((group) => group.message);
  committed.sort((a, b) => {
    const first = BigInt(a.sequence),
      second = BigInt(b.sequence);
    return first < second ? -1 : first > second ? 1 : a.id.localeCompare(b.id);
  });

  const committedKeys = new Set(byKey.keys());
  const drafts = new Map<string, LocalMessage>();
  for (const message of local) {
    const key = messageKey(message);
    if (!committedKeys.has(key)) drafts.set(key, message);
  }
  const pending = [...drafts.values()].sort(
    (a, b) =>
      Date.parse(a.created_at) - Date.parse(b.created_at) ||
      messageKey(a).localeCompare(messageKey(b)),
  );
  return [
    ...committed.map((message): DisplayMessage => ({
      kind: "server",
      key: messageKey(message),
      message,
    })),
    ...pending.map((message): DisplayMessage => ({
      kind: "local",
      key: messageKey(message),
      message,
    })),
  ];
}

const validSequence = (sequence: string): boolean =>
  /^[1-9][0-9]{0,18}$/.test(sequence) &&
  BigInt(sequence) <= BigInt("9223372036854775807");

/** Read receipts are based exclusively on the server-confirmed recipient cursor. */
export function isMessageRead(
  message: ChatMessage,
  readSequence: string | null,
): boolean {
  return (
    readSequence !== null &&
    validSequence(readSequence) &&
    validSequence(message.sequence) &&
    BigInt(message.sequence) <= BigInt(readSequence)
  );
}

export function conversationPreview(conversation: Conversation): string {
  const message = conversation.last_message;
  if (!message) return "Bắt đầu cuộc trò chuyện";
  if (message.deleted_at) return "Tin nhắn đã được xóa";
  if (message.message_type === "text")
    return message.content?.trim() || "Tin nhắn";
  if (!message.shared_resource?.available)
    return "Nội dung chia sẻ không còn khả dụng";
  if (message.content?.trim()) return message.content.trim();
  switch (message.message_type) {
    case "shared_post":
      return "Đã chia sẻ một bài viết";
    case "shared_location":
      return "Đã chia sẻ một địa điểm";
    case "shared_journey":
      return "Đã chia sẻ một hành trình";
  }
}

function normalizeSearch(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("vi")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ");
}

export function matchesConversation(
  conversation: Conversation,
  search: string,
): boolean {
  const term = normalizeSearch(search);
  return (
    !term ||
    normalizeSearch(
      `${conversation.recipient.display_name} ${conversation.recipient.username}`,
    ).includes(term)
  );
}

/** Return a browser-safe absolute web link; user content is still rendered as text. */
export function safeMessageHref(value: string): string | null {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return null;
  const candidate = value.trim();
  if (
    !/^https?:\/\//i.test(candidate) ||
    /^https?:\/\/[^/?#]*@/i.test(candidate)
  )
    return null;
  try {
    const url = new URL(candidate);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
