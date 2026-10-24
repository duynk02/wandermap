export type MessageType = "text" | "shared_post" | "shared_location" | "shared_journey";

export interface MessagingProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export interface SharedMessageResource {
  available: boolean;
  id: string | null;
  title: string | null;
  image_url: string | null;
  author: MessagingProfile | null;
  location: { id: string; name: string } | null;
  address: string | null;
  category: string | null;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  /** Keep bigint cursors as strings; Number would lose precision. */
  sequence: string;
  client_message_id: string;
  message_type: MessageType;
  content: string | null;
  shared_resource: SharedMessageResource | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ConversationReadState {
  last_read_sequence: string | null;
  last_read_at: string | null;
}

export interface Conversation {
  id: string;
  type: "direct";
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  recipient: MessagingProfile & { is_active: boolean };
  can_send: boolean;
  is_mutual: boolean;
  blocked_by_me: boolean;
  read_state: ConversationReadState;
  recipient_read_state: ConversationReadState;
  unread_count: number;
  last_message: ChatMessage | null;
}

export interface CursorPage<T> {
  data: T[];
  next_cursor: string | null;
  hasMore: boolean;
}

export interface MessagingContact extends MessagingProfile { conversation_id: string | null; }
export type MessagingContactsKind = "friends" | "followers";
export interface MessagingContactsPage { data: MessagingContact[]; hasMore: boolean; next_page: number | null; }

export type SendMessageInput = { client_message_id: string } & (
  | { message_type: "text"; content: string; shared_resource_id?: never }
  | { message_type: Exclude<MessageType, "text">; content?: string | null; shared_resource_id: string }
);

export interface SendMessageResult { message: ChatMessage; created: boolean; }
export interface MessagingUnreadCount { unread_messages: number; unread_conversations: number; }
export interface ReadConversationResult extends ConversationReadState { conversation_id: string; unread_count: number; }
