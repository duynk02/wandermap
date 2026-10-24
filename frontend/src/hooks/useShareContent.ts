"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/constants";
import { ApiError, getAuthSessionVersion } from "@/lib/api/client";
import {
  getConversation,
  sendConversationMessage,
  startDirectConversation,
} from "@/lib/api/messaging";
import { messageTextLength, MESSAGE_MAX_LENGTH } from "@/lib/messaging/model";
import {
  prepareSharedMessage,
  shareAttemptKey,
  type ShareDestination,
  type ShareTarget,
} from "@/lib/messaging/share";
import {
  reconcileMessageCache,
  type MessageCache,
} from "@/lib/realtime/messaging";
import { useAuthStore } from "@/stores/authStore";
import {
  updateShareAttempt,
  useMessageDraftStore,
} from "@/stores/messageDraftStore";
import type { SendMessageInput } from "@/types/messaging";

interface ShareOperation {
  key: string;
  destination: ShareDestination;
  input: SendMessageInput;
}

export function useShareContent(
  viewer: string,
  session: number,
  target: ShareTarget,
) {
  const client = useQueryClient();
  const current = () =>
    useAuthStore.getState().user?.id === viewer &&
    getAuthSessionVersion() === session;
  const assertCurrent = () => {
    if (!current())
      throw new ApiError(
        401,
        "AUTH_SESSION_CHANGED",
        "Phiên đăng nhập đã thay đổi. Vui lòng mở lại hộp chia sẻ.",
      );
  };
  const mutation = useMutation({
    retry: false,
    mutationFn: async (operation: ShareOperation) => {
      assertCurrent();
      const conversation =
        operation.destination.kind === "conversation"
          ? await getConversation(operation.destination.id)
          : (await startDirectConversation(operation.destination.id))
              .conversation;
      assertCurrent();
      if (!conversation.can_send)
        throw new ApiError(
          403,
          "MESSAGING_BLOCKED",
          "Hiện không thể gửi tin nhắn cho người nhận này.",
        );
      const result = await sendConversationMessage(
        conversation.id,
        operation.input,
      );
      assertCurrent();
      return { conversation, message: result.message };
    },
    onSuccess: async ({ conversation, message }, operation) => {
      if (!current()) return;
      const queryKey = QUERY_KEYS.messaging.messages(viewer, conversation.id);
      await client.cancelQueries({ queryKey, exact: true });
      if (!current()) return;
      client.setQueryData<MessageCache>(queryKey, (cache) =>
        cache ? reconcileMessageCache(cache, message) : undefined,
      );
      // Never insert the sender's local resource preview into another viewer's cache.
      if (
        useMessageDraftStore.getState().shareAttempts[operation.key]?.input
          .client_message_id === operation.input.client_message_id
      )
        updateShareAttempt(viewer, operation.key, null);
      void Promise.all([
        client.invalidateQueries({
          queryKey: QUERY_KEYS.messaging.conversation(viewer, conversation.id),
        }),
        client.invalidateQueries({
          queryKey: QUERY_KEYS.messaging.conversations(viewer),
        }),
        client.invalidateQueries({
          queryKey: QUERY_KEYS.messaging.unreadCount(viewer),
        }),
      ]);
    },
    onError: (_error, operation) => {
      if (!current()) return;
      if (
        useMessageDraftStore.getState().shareAttempts[operation.key]?.input
          .client_message_id === operation.input.client_message_id
      )
        updateShareAttempt(viewer, operation.key, {
          input: operation.input,
          status: "failed",
        });
    },
  });
  const send = async (destination: ShareDestination, caption: string) => {
    assertCurrent();
    if (target.restriction)
      throw new ApiError(403, "RESOURCE_UNAVAILABLE", target.restriction);
    if (messageTextLength(caption) > MESSAGE_MAX_LENGTH)
      throw new ApiError(
        400,
        "MESSAGE_TOO_LONG",
        `Lời nhắn tối đa ${MESSAGE_MAX_LENGTH} ký tự.`,
      );
    const key = shareAttemptKey(target, destination);
    const previous = useMessageDraftStore.getState().shareAttempts[key];
    if (mutation.isPending || previous?.status === "pending")
      throw new ApiError(409, "MESSAGE_PENDING", "Nội dung này đang được gửi.");
    const input = prepareSharedMessage(target, caption, previous?.input);
    updateShareAttempt(viewer, key, { input, status: "pending" });
    return mutation.mutateAsync({ key, destination, input });
  };
  return { ...mutation, send };
}
