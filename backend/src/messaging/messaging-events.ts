import type { MessageType } from './dto/messaging.dto';

interface MessagingEventBase {
  event_id: string;
  conversation_id: string;
  recipient_id: string;
}

/** A safe REST resource reference, never a cached copy of shared/private content. */
export interface MessageNewEvent extends MessagingEventBase {
  message_id: string;
  sender_id: string;
  client_message_id: string;
  message_type: MessageType;
  sequence: string;
  created_at: string;
}

export interface MessageReadEvent extends MessagingEventBase {
  user_id: string;
  last_read_sequence: string;
  last_read_at: string;
}

export interface ConversationUpdatedEvent extends MessagingEventBase {
  reason: 'created' | 'message' | 'read' | 'policy';
  message_id: string | null;
}

export interface MessagingServerEvents {
  'message:new': (payload: MessageNewEvent) => void;
  'message:read': (payload: MessageReadEvent) => void;
  'conversation:updated': (payload: ConversationUpdatedEvent) => void;
}

export type MessagingEvent =
  | { name: 'message:new'; payload: MessageNewEvent }
  | { name: 'message:read'; payload: MessageReadEvent }
  | { name: 'conversation:updated'; payload: ConversationUpdatedEvent };
