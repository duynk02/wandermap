"use client";

import { useRouter } from "next/navigation";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/constants";
import { useStartConversation } from "@/hooks/useMessagingNavigation";
import { getAuthSessionVersion } from "@/lib/api/client";
import { useAuthStore } from "@/stores/authStore";
import { messagingButtonClass } from "./MessagingPrimitives";

export function MessageUserButton({
  recipientId,
  name,
}: {
  recipientId: string;
  name: string;
}) {
  const start = useStartConversation();
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label={`Nhắn tin cho ${name}`}
      title="Nhắn tin"
      disabled={start.isPending}
      className={messagingButtonClass}
      onClick={() => {
        const owner = useAuthStore.getState().user?.id;
        const version = getAuthSessionVersion();
        const current = () =>
          !!owner &&
          useAuthStore.getState().user?.id === owner &&
          getAuthSessionVersion() === version;
        start.mutate(recipientId, {
          onSuccess: ({ conversation }) => {
            if (current()) router.push(ROUTES.conversation(conversation.id));
          },
          onError: (error) => {
            if (current())
              toast.error(error.message || "Chưa thể mở cuộc trò chuyện.");
          },
        });
      }}
    >
      {start.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <MessageCircle className="h-4 w-4" />
      )}
      <span className="sr-only">Nhắn tin</span>
    </button>
  );
}
