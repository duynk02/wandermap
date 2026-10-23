"use client";

import { useEffect } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { QUERY_KEYS } from "@/constants";
import { ApiError, getAuthSessionVersion } from "@/lib/api/client";
import {
  getConversation,
  getConversationMessages,
  getConversations,
  markConversationRead,
  sendConversationMessage,
} from "@/lib/api/messaging";
import { reconcileMessageCache } from "@/lib/realtime/messaging";
import { validateMessageText, type LocalMessage } from "@/lib/messaging/model";
import { useAuthStore } from "@/stores/authStore";
import { useRealtimeStore } from "@/stores/realtimeStore";
import {
  useMessageDraftStore,
  updateMessageDraft,
} from "@/stores/messageDraftStore";
import type { ChatMessage, Conversation, CursorPage } from "@/types/messaging";

const retry = (count: number, error: Error) =>
  !(error instanceof ApiError && error.status < 500) && count < 2;
const usePolling = (viewer: string) =>
  useRealtimeStore((state) => state.connected && state.userId === viewer)
    ? (false as const)
    : 30_000;
function assertViewer(viewer: string, session?: number) {
  if (
    useAuthStore.getState().user?.id !== viewer ||
    (session !== undefined && session !== getAuthSessionVersion())
  ) {
    throw new ApiError(
      401,
      "AUTH_SESSION_CHANGED",
      "Phiên đăng nhập đã thay đổi.",
    );
  }
}

export function useConversations(viewer: string) {
  const interval = usePolling(viewer);
  return useInfiniteQuery({
    queryKey: QUERY_KEYS.messaging.conversations(viewer),
    queryFn: ({ pageParam, signal }) => {
      assertViewer(viewer);
      return getConversations({ limit: 20, cursor: pageParam }, signal);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      page.hasMore ? (page.next_cursor ?? undefined) : undefined,
    staleTime: 15_000,
    retry,
    refetchInterval: interval,
  });
}

export function useConversation(viewer: string, id: string) {
  const interval = usePolling(viewer);
  return useQuery({
    queryKey: QUERY_KEYS.messaging.conversation(viewer, id),
    queryFn: ({ signal }) => {
      assertViewer(viewer);
      return getConversation(id, signal);
    },
    staleTime: 15_000,
    retry,
    refetchInterval: interval,
  });
}

export function useConversationMessages(
  viewer: string,
  id: string,
  enabled: boolean,
) {
  const interval = usePolling(viewer);
  return useInfiniteQuery({
    queryKey: QUERY_KEYS.messaging.messages(viewer, id),
    queryFn: ({ pageParam, signal }) => {
      assertViewer(viewer);
      return getConversationMessages(
        id,
        { limit: 30, before_sequence: pageParam },
        signal,
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      page.hasMore ? (page.next_cursor ?? undefined) : undefined,
    enabled,
    staleTime: 15_000,
    retry,
    refetchInterval: interval,
  });
}

export function useReadConversation(viewer: string, id: string) {
  const client = useQueryClient();
  const session = getAuthSessionVersion();
  return useMutation({
    mutationFn: async (sequence: string) => {
      assertViewer(viewer, session);
      const version = getAuthSessionVersion();
      const result = await markConversationRead(id, sequence);
      return { result, version };
    },
    retry: false,
    onSuccess: ({ result, version }) => {
      if (
        useAuthStore.getState().user?.id !== viewer ||
        version !== getAuthSessionVersion()
      )
        return;
      client.setQueryData<Conversation>(
        QUERY_KEYS.messaging.conversation(viewer, id),
        (current) => {
          if (
            !current ||
            BigInt(current.read_state.last_read_sequence ?? "0") >
              BigInt(result.last_read_sequence ?? "0")
          )
            return current;
          return {
            ...current,
            read_state: {
              last_read_sequence: result.last_read_sequence,
              last_read_at: result.last_read_at,
            },
            unread_count: result.unread_count,
          };
        },
      );
      void client.invalidateQueries({
        queryKey: QUERY_KEYS.messaging.conversations(viewer),
      });
      void client.invalidateQueries({
        queryKey: QUERY_KEYS.messaging.unreadCount(viewer),
      });
    },
  });
}

const emptyDraft = { text: "", messages: [] as LocalMessage[] };

/** Drafts/outbox are memory-only. Server rows stay in the shared realtime query cache. */
export function useMessageComposer(
  viewer: string,
  id: string,
  confirmed: readonly ChatMessage[],
) {
  const client = useQueryClient();
  const session = getAuthSessionVersion();
  const draft = useMessageDraftStore((state) =>
    state.owner === viewer ? (state.drafts[id] ?? emptyDraft) : emptyDraft,
  );
  useEffect(() => {
    const delivered = draft.messages.filter((local) =>
      confirmed.some(
        (row) =>
          row.sender_id === local.sender_id &&
          row.client_message_id === local.client_message_id,
      ),
    );
    if (!delivered.length) return;
    updateMessageDraft(viewer, id, (value) => ({
      text: delivered.some((row) => row.content === value.text.trim())
        ? ""
        : value.text,
      messages: value.messages.filter(
        (row) =>
          !delivered.some(
            (sent) => sent.client_message_id === row.client_message_id,
          ),
      ),
    }));
  }, [viewer, id, confirmed, draft.messages]);
  const mutation = useMutation({
    mutationKey: ["send-message", viewer, id],
    retry: false,
    onMutate: () => ({ session }),
    mutationFn: async (local: LocalMessage) => {
      assertViewer(viewer, session);
      const version = getAuthSessionVersion();
      const result = await sendConversationMessage(id, {
        client_message_id: local.client_message_id,
        message_type: "text",
        content: local.content,
      });
      return { result, version };
    },
    onSuccess: async ({ result, version }, local) => {
      const current = () =>
        useAuthStore.getState().user?.id === viewer &&
        version === getAuthSessionVersion();
      if (!current()) return;
      // A snapshot started before POST must not replace the committed REST/socket row.
      await client.cancelQueries({
        queryKey: QUERY_KEYS.messaging.messages(viewer, id),
        exact: true,
      });
      if (!current()) return;
      client.setQueryData<InfiniteData<CursorPage<ChatMessage>>>(
        QUERY_KEYS.messaging.messages(viewer, id),
        (cache) =>
          cache
            ? (reconcileMessageCache(cache, result.message) as InfiniteData<
                CursorPage<ChatMessage>
              >)
            : undefined,
      );
      if (!client.getQueryData(QUERY_KEYS.messaging.messages(viewer, id)))
        void client.invalidateQueries({
          queryKey: QUERY_KEYS.messaging.messages(viewer, id),
        });
      updateMessageDraft(viewer, id, (value) => ({
        text: value.text.trim() === local.content ? "" : value.text,
        messages: value.messages.filter(
          (row) => row.client_message_id !== local.client_message_id,
        ),
      }));
      void client.invalidateQueries({
        queryKey: QUERY_KEYS.messaging.conversation(viewer, id),
      });
      void client.invalidateQueries({
        queryKey: QUERY_KEYS.messaging.conversations(viewer),
      });
      void client.invalidateQueries({
        queryKey: QUERY_KEYS.messaging.unreadCount(viewer),
      });
    },
    onError: (error, local, context) => {
      if (
        useAuthStore.getState().user?.id !== viewer ||
        context?.session !== getAuthSessionVersion()
      )
        return;
      updateMessageDraft(viewer, id, (value) => ({
        ...value,
        messages: value.messages.map((row) =>
          row.client_message_id === local.client_message_id
            ? {
                ...row,
                status: "failed",
                error:
                  error instanceof ApiError
                    ? error.message
                    : "Chưa gửi được tin nhắn. Hãy thử lại.",
              }
            : row,
        ),
      }));
      if (error instanceof ApiError && [403, 404].includes(error.status))
        void client.invalidateQueries({
          queryKey: QUERY_KEYS.messaging.conversation(viewer, id),
        });
    },
  });
  const send = (existing?: LocalMessage) => {
    const state = useMessageDraftStore.getState();
    if (
      useAuthStore.getState().user?.id !== viewer ||
      state.owner !== viewer ||
      session !== getAuthSessionVersion()
    )
      return;
    const value =
      state.owner === viewer ? (state.drafts[id] ?? emptyDraft) : emptyDraft;
    if (
      value.messages.some((row) => row.status === "pending") ||
      mutation.isPending
    )
      return;
    const content = existing?.content ?? value.text.trim();
    if (validateMessageText(content)) return;
    // Submitting an unchanged failed draft is also a retry of the original operation.
    const previous =
      existing ??
      value.messages.findLast(
        (row) => row.status === "failed" && row.content === content,
      );
    const local: LocalMessage = {
      conversation_id: id,
      sender_id: viewer,
      client_message_id: previous?.client_message_id ?? crypto.randomUUID(),
      created_at: previous?.created_at ?? new Date().toISOString(),
      content,
      status: "pending",
    };
    updateMessageDraft(viewer, id, (current) => ({
      ...current,
      messages: [
        ...current.messages.filter(
          (row) => row.client_message_id !== local.client_message_id,
        ),
        local,
      ],
    }));
    mutation.mutate(local);
  };
  return {
    ...draft,
    send,
    isPending:
      mutation.isPending ||
      draft.messages.some((row) => row.status === "pending"),
    setText: (text: string) =>
      updateMessageDraft(viewer, id, (current) => ({ ...current, text })),
  };
}
