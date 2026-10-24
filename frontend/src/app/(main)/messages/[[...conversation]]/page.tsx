import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MessagingWorkspace } from "@/components/messaging/MessagingWorkspace";

export const metadata: Metadata = { title: "Tin nhắn" };

export default async function MessagesPage({
  params,
}: {
  params: Promise<{ conversation?: string[] }>;
}) {
  const { conversation } = await params;
  if (
    conversation &&
    (conversation.length !== 1 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        conversation[0],
      ))
  )
    notFound();
  return <MessagingWorkspace conversationId={conversation?.[0]} />;
}
