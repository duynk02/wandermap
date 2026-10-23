import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { ChatMessage, CursorPage, MessageType } from "@/types/messaging";

export type MessagingEventName = "message:new" | "message:read" | "conversation:updated";
interface EventBase { event_id: string; conversation_id: string; recipient_id: string; }
export interface MessageNewEvent extends EventBase {
  message_id: string;
  sender_id: string;
  client_message_id: string;
  message_type: MessageType;
  sequence: string;
  created_at: string;
}
export interface MessageReadEvent extends EventBase { user_id: string; last_read_sequence: string; last_read_at: string; }
export interface ConversationUpdatedEvent extends EventBase { reason: "created" | "message" | "read" | "policy"; message_id: string | null; }
export type MessagingEvent =
  | { name: "message:new"; payload: MessageNewEvent }
  | { name: "message:read"; payload: MessageReadEvent }
  | { name: "conversation:updated"; payload: ConversationUpdatedEvent };

const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const date = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const sequence = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= BigInt("9223372036854775807");

export function parseMessagingEvent(name: MessagingEventName, value: unknown): MessagingEvent | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!uuid(item.event_id) || !uuid(item.conversation_id) || !uuid(item.recipient_id)) return null;
  const base = { event_id: item.event_id, conversation_id: item.conversation_id, recipient_id: item.recipient_id };
  if (name === "message:new") {
    if (!uuid(item.message_id) || !uuid(item.sender_id) || !uuid(item.client_message_id) || !sequence(item.sequence)
      || !date(item.created_at) || typeof item.message_type !== "string" || !["text", "shared_post", "shared_location", "shared_journey"].includes(item.message_type)) return null;
    return { name, payload: { ...base, message_id: item.message_id, sender_id: item.sender_id,
      client_message_id: item.client_message_id, message_type: item.message_type as MessageType, sequence: item.sequence, created_at: item.created_at } };
  }
  if (name === "message:read") {
    if (!uuid(item.user_id) || !sequence(item.last_read_sequence) || !date(item.last_read_at)) return null;
    return { name, payload: { ...base, user_id: item.user_id, last_read_sequence: item.last_read_sequence, last_read_at: item.last_read_at } };
  }
  if (name === "conversation:updated") {
    if (typeof item.reason !== "string" || !["created", "message", "read", "policy"].includes(item.reason)
      || (item.reason === "message" ? !uuid(item.message_id) : item.message_id !== null)) return null;
    return { name, payload: { ...base, reason: item.reason as ConversationUpdatedEvent["reason"], message_id: item.message_id as string | null } };
  }
  return null;
}

export type MessageCache = CursorPage<ChatMessage> | InfiniteData<CursorPage<ChatMessage>>;
const sameMessage = (a: ChatMessage, b: ChatMessage) => a.id === b.id || (a.sender_id === b.sender_id && a.client_message_id === b.client_message_id);

/** Shared by REST/optimistic reconciliation and event resolution; never count bubbles by arrival source. */
export function reconcileMessageCache(cache: MessageCache, message: ChatMessage): MessageCache {
  const pages = "pages" in cache ? cache.pages : [cache];
  if (!pages.length) return cache;
  let target = pages.findIndex((page) => page.data.some((row) => sameMessage(row, message)));
  if (target === -1) target = pages.findIndex((page) => !page.data.length || BigInt(message.sequence) >= BigInt(page.data.at(-1)!.sequence));
  if (target === -1) {
    if (pages.at(-1)!.hasMore) return cache;
    target = pages.length - 1;
  }
  const merged = pages.map((page, index) => {
    const data = page.data.filter((row) => !sameMessage(row, message));
    if (index === target) data.push(message);
    data.sort((a, b) => BigInt(a.sequence) > BigInt(b.sequence) ? -1 : BigInt(a.sequence) < BigInt(b.sequence) ? 1 : b.id.localeCompare(a.id));
    return { ...page, data };
  });
  return "pages" in cache ? { ...cache, pages: merged } : merged[0];
}

export interface MessagingQueryKeys {
  viewer: (viewer: string) => readonly unknown[];
  conversations: (viewer: string) => readonly unknown[];
  conversation: (viewer: string, id: string) => readonly unknown[];
  messages: (viewer: string, id: string) => readonly unknown[];
  unreadCount: (viewer: string) => readonly unknown[];
}

async function refreshQueries(client: QueryClient, keys: readonly (readonly unknown[])[], isCurrent: () => boolean) {
  if (!isCurrent()) return;
  await Promise.all(keys.map((queryKey) => client.cancelQueries({ queryKey })));
  if (!isCurrent()) return;
  await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey, refetchType: "active" })));
}

/** One instance per shared tab lifecycle. Events carry references; REST supplies content and counts. */
export function createMessagingSync({ client, keys, getUserId, loadMessage }: {
  client: QueryClient;
  keys: MessagingQueryKeys;
  getUserId: () => string | null;
  loadMessage: (conversation: string, message: string, signal: AbortSignal) => Promise<ChatMessage>;
}) {
  const seen = new Map<string, number>();
  let pending = new Map<string, Set<string>>();
  let full = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: number | null = null;
  let generation = 0;
  let disposed = false;
  const controllers = new Set<AbortController>();

  const current = (owner: string, version: number) => !disposed && generation === version && getUserId() === owner;
  const schedule = () => {
    if (disposed || timer || running !== null || !getUserId()) return;
    timer = setTimeout(() => { timer = undefined; void flush(); }, 100);
  };

  async function resolveMessages(owner: string, conversation: string, ids: Set<string>, version: number) {
    const isCurrent = () => current(owner, version);
    const queryKey = keys.messages(owner, conversation);
    const query = client.getQueryCache().find({ queryKey, exact: true });
    if (!query?.isActive()) {
      if (isCurrent()) await client.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
      return;
    }
    if (!client.getQueryData<MessageCache>(queryKey)) {
      await refreshQueries(client, [queryKey], isCurrent);
      return;
    }
    // Cancel an older in-flight snapshot before merging committed rows into its cache.
    await client.cancelQueries({ queryKey, exact: true });
    if (!isCurrent()) return;
    const controller = new AbortController();
    controllers.add(controller);
    try {
      // Bounded batches avoid opening one request per historical page or unlimited fanout.
      const list = [...ids];
      for (let offset = 0; offset < list.length && isCurrent(); offset += 4) {
        await Promise.all(list.slice(offset, offset + 4).map(async (id) => {
          try {
            const message = await loadMessage(conversation, id, controller.signal);
            if (!isCurrent() || message.id !== id || message.conversation_id !== conversation) return;
            client.setQueryData<MessageCache>(queryKey, (cache) => cache ? reconcileMessageCache(cache, message) : undefined);
          } catch (error) {
            if (!isCurrent()) return;
            if (error && typeof error === "object" && "status" in error && error.status === 404) {
              client.removeQueries({ queryKey, exact: true });
              client.removeQueries({ queryKey: keys.conversation(owner, conversation), exact: true });
            } else await client.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
          }
        }));
      }
    } finally { controllers.delete(controller); }
  }

  async function flush() {
    const owner = getUserId();
    if (disposed || running !== null || !owner) return;
    const version = generation;
    const batch = pending;
    const reconcile = full;
    pending = new Map();
    full = false;
    running = version;
    const isCurrent = () => current(owner, version);
    try {
      if (reconcile) await refreshQueries(client, [keys.viewer(owner)], isCurrent);
      else {
        await refreshQueries(client, [keys.conversations(owner), keys.unreadCount(owner),
          ...[...batch.keys()].map((id) => keys.conversation(owner, id))], isCurrent);
        if (isCurrent()) for (const [conversation, ids] of batch) {
          if (!isCurrent()) break;
          if (ids.size) await resolveMessages(owner, conversation, ids, version);
        }
      }
    } catch {
      // An outage leaves queries stale. Reconnect/foreground retries via the same REST path.
    } finally {
      if (running === version) running = null;
      if (!disposed && (full || pending.size)) schedule();
    }
  }

  const clear = () => {
    generation += 1;
    running = null;
    if (timer) clearTimeout(timer);
    timer = undefined;
    pending.clear();
    full = false;
    seen.clear();
    controllers.forEach((controller) => controller.abort());
    controllers.clear();
  };
  return {
    refresh(owner: string) {
      if (disposed || getUserId() !== owner) return;
      full = true;
      schedule();
    },
    receive(owner: string, name: MessagingEventName, payload: unknown): boolean {
      const event = parseMessagingEvent(name, payload);
      if (disposed || getUserId() !== owner || !event || event.payload.recipient_id !== owner) return false;
      const now = Date.now();
      for (const [id, expires] of seen) if (expires <= now) seen.delete(id);
      const key = `${name}:${event.payload.event_id}`;
      if (seen.has(key)) return false;
      seen.set(key, now + 60_000);
      if (seen.size > 512) seen.delete(seen.keys().next().value!);
      let ids = pending.get(event.payload.conversation_id);
      if (!ids) { ids = new Set(); pending.set(event.payload.conversation_id, ids); }
      if (event.name === "message:new" || (event.name === "conversation:updated" && event.payload.reason === "message")) {
        ids.add(event.payload.message_id!);
      }
      // A burst is reconciled through bounded REST pages, never an unbounded ID queue.
      if (pending.size > 64 || [...pending.values()].reduce((count, items) => count + items.size, 0) > 256) {
        full = true;
        pending.clear();
      }
      schedule();
      return true;
    },
    clear,
    dispose() { disposed = true; clear(); },
  };
}
