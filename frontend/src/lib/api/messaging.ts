import type { ChatMessage, Conversation, CursorPage, MessagingUnreadCount, ReadConversationResult, SendMessageInput, SendMessageResult } from "@/types/messaging";
import { apiFetch } from "./client";

export const getConversations = (query: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) =>
  apiFetch<CursorPage<Conversation>>("/conversations", { query: { ...query }, signal });

export const getConversation = (id: string, signal?: AbortSignal) =>
  apiFetch<Conversation>(`/conversations/${id}`, { signal });

export const startDirectConversation = (recipientId: string) =>
  apiFetch<{ conversation: Conversation; created: boolean }>("/conversations/direct", { method: "POST", body: { recipient_id: recipientId } });

export const getConversationMessages = (id: string, query: { before_sequence?: string; limit?: number } = {}, signal?: AbortSignal) =>
  apiFetch<CursorPage<ChatMessage>>(`/conversations/${id}/messages`, { query: { ...query }, signal });

/** Generate client_message_id once at submission; reuse it for every retry. */
export const sendConversationMessage = (id: string, input: SendMessageInput) =>
  apiFetch<SendMessageResult>(`/conversations/${id}/messages`, { method: "POST", body: input });

export const markConversationRead = (id: string, lastReadSequence: string) =>
  apiFetch<ReadConversationResult>(`/conversations/${id}/read`, { method: "PATCH", body: { last_read_sequence: lastReadSequence } });

export const getMessagingUnreadCount = (signal?: AbortSignal) =>
  apiFetch<MessagingUnreadCount>("/conversations/unread-count", { signal });

export const setUserMessageBlocked = (id: string, blocked: boolean) =>
  apiFetch<{ user_id: string; blocked: boolean }>(`/users/me/message-blocks/${id}`, { method: blocked ? "PUT" : "DELETE" });
