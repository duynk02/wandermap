import type { MessageType } from './dto/messaging.dto';

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

export interface MessageDto {
  id: string;
  conversation_id: string;
  sender_id: string;
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

export interface ConversationDto {
  id: string;
  type: 'direct';
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  recipient: MessagingProfile & { is_active: boolean };
  can_send: boolean;
  blocked_by_me: boolean;
  read_state: ConversationReadState;
  recipient_read_state: ConversationReadState;
  unread_count: number;
  last_message: MessageDto | null;
}

export interface CursorPage<T> {
  data: T[];
  next_cursor: string | null;
  hasMore: boolean;
}

export interface MessagingUnreadCount { unread_messages: number; unread_conversations: number; }
export interface ReadConversationResult extends ConversationReadState { conversation_id: string; unread_count: number; }
export interface SendMessageResult { message: MessageDto; created: boolean; }
