import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { InfiniteQueryObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { createMessagingSync, parseMessagingEvent, reconcileMessageCache } from "../src/lib/realtime/messaging.ts";
import { createRealtimeLifecycle } from "../src/lib/realtime/lifecycle.ts";

const owner = randomUUID(), other = randomUUID(), conversation = randomUUID();
const time = "2026-10-23T12:00:00.000Z";
const keys = {
  viewer: (id) => ["messaging", id],
  conversations: (id) => ["messaging", id, "conversations"],
  conversation: (id, chat) => ["messaging", id, "conversation", chat],
  messages: (id, chat) => ["messaging", id, "messages", chat],
  unreadCount: (id) => ["messaging", id, "unread-count"],
};
const message = (sequence = "1", extra = {}) => ({ id: randomUUID(), conversation_id: conversation, sender_id: other,
  client_message_id: randomUUID(), sequence, message_type: "text", content: "Xin chào Việt Nam 🗺️", shared_resource: null,
  created_at: time, updated_at: time, deleted_at: null, ...extra });
const page = (data, hasMore = false) => ({ data, hasMore, next_cursor: hasMore ? data.at(-1)?.sequence ?? null : null });
const change = (row, recipient = owner) => ({ event_id: row.id, conversation_id: row.conversation_id, recipient_id: recipient,
  message_id: row.id, sender_id: row.sender_id, client_message_id: row.client_message_id,
  message_type: row.message_type, sequence: row.sequence, created_at: row.created_at });
const updated = (row, recipient = owner) => ({ event_id: row.id, conversation_id: row.conversation_id, recipient_id: recipient, reason: "message", message_id: row.id });
const pause = (milliseconds = 5) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await pause();
  assert.ok(predicate(), "expected asynchronous reconciliation to finish");
}

function harness(t, { loadMessage = async () => message(), getUserId = () => owner } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  const sync = createMessagingSync({ client, keys, loadMessage, getUserId });
  const stops = [];
  const observe = (queryKey, initialData, queryFn) => {
    const observer = new QueryObserver(client, { queryKey, initialData, queryFn });
    stops.push(observer.subscribe(() => {}));
    return observer;
  };
  t.after(() => { sync.dispose(); stops.forEach((stop) => stop()); client.clear(); });
  return { client, sync, observe, stops };
}

test("messaging event parsing rejects malformed/oversized cursors and allowlists metadata", () => {
  const row = message("9007199254740993");
  const value = change(row);
  assert.deepEqual(parseMessagingEvent("message:new", { ...value, token: "forged", content: "untrusted" }).payload, value);
  for (const bad of [null, [], {}, { ...value, sequence: 9007199254740993 }, { ...value, sequence: "9223372036854775808" },
    { ...value, sequence: "01" }, { ...value, created_at: "bad" }, { ...value, message_type: { toString: null } }]) {
    assert.equal(parseMessagingEvent("message:new", bad), null);
  }
  assert.equal(parseMessagingEvent("conversation:updated", { ...updated(row), message_id: null }), null);
  assert.equal(parseMessagingEvent("conversation:updated", { ...updated(row), reason: "policy", message_id: null }).payload.reason, "policy");
});

test("optimistic, REST and socket copies reconcile to one bubble across pages using server ID and sender/client key", () => {
  const row = message("9007199254740993");
  const older = message("9007199254740992");
  const cache = { pages: [page([{ ...row, id: "pending-local-id" }], true), page([row, older])], pageParams: [undefined, "9007199254740993"] };
  const merged = reconcileMessageCache(cache, row);
  assert.deepEqual(merged.pages.flatMap((item) => item.data.map((row) => row.id)), [row.id, older.id]);
  assert.equal(merged.pageParams, cache.pageParams);
  assert.equal(merged.pages[0].next_cursor, cache.pages[0].next_cursor);
  const newer = message("9007199254740994");
  const reordered = reconcileMessageCache(merged, newer);
  assert.deepEqual(reordered.pages[0].data.map((row) => row.sequence), ["9007199254740994", "9007199254740993"]);
  assert.equal(cache.pages[0].data[0].id, "pending-local-id", "input cache is not mutated");
  const sameKeyOtherSender = { ...row, id: randomUUID(), sender_id: owner };
  assert.equal(reconcileMessageCache(page([row]), sameKeyOtherSender).data.length, 2);
});

test("a delayed event never inserts past an unloaded gap in older history", () => {
  const cache = { pages: [page([message("8"), message("7")], true), page([message("5"), message("4")], true)], pageParams: [undefined, "7"] };
  assert.equal(reconcileMessageCache(cache, message("2")), cache);
  const between = message("6");
  assert.equal(reconcileMessageCache(cache, between).pages[1].data[0].id, between.id);
});

test("message hints resolve one REST row, dedup paired events and preserve older pages without refetching history", async (t) => {
  const newest = message("3"), previous = message("2"), oldest = message("1");
  let loads = 0, historyFetches = 0, unreadFetches = 0;
  const h = harness(t, { loadMessage: async () => { loads++; return newest; } });
  const cache = { pages: [page([previous], true), page([oldest])], pageParams: [undefined, previous.sequence] };
  h.observe(keys.messages(owner, conversation), cache, async () => { historyFetches++; return cache; });
  h.observe(keys.unreadCount(owner), { unread_messages: 0 }, async () => { unreadFetches++; return { unread_messages: 5, unread_conversations: 1 }; });
  assert.equal(h.sync.receive(owner, "message:new", change(newest)), true);
  assert.equal(h.sync.receive(owner, "message:new", change(newest)), false);
  assert.equal(h.sync.receive(owner, "conversation:updated", updated(newest)), true);
  await until(() => h.client.getQueryData(keys.messages(owner, conversation)).pages[0].data[0].id === newest.id);
  assert.equal(loads, 1);
  assert.equal(historyFetches, 0);
  assert.equal(unreadFetches, 1);
  assert.equal(h.client.getQueryData(keys.unreadCount(owner)).unread_messages, 5, "count comes from REST, not event increments");
  assert.deepEqual(h.client.getQueryData(keys.messages(owner, conversation)).pages[1].data, [oldest]);
});

test("policy hints refresh contacts and sending permission for the current viewer", async (t) => {
  const h = harness(t);
  const contactKey = [...keys.viewer(owner), "contacts", ""];
  let contactLoads = 0, detailLoads = 0;
  h.observe(contactKey, { data: [other] }, async () => { contactLoads++; return { data: [] }; });
  h.observe(keys.conversation(owner, conversation), { can_send: true }, async () => { detailLoads++; return { can_send: false }; });
  const row = message();
  h.sync.receive(owner, "conversation:updated", { ...updated(row), reason: "policy", message_id: null });
  await until(() => contactLoads === 1 && detailLoads === 1);
  assert.deepEqual(h.client.getQueryData(contactKey), { data: [] });
  assert.equal(h.client.getQueryData(keys.conversation(owner, conversation)).can_send, false);
});

test("conversation message hints alone recover a message if the paired message:new hint was missed", async (t) => {
  const row = message("2");
  const h = harness(t, { loadMessage: async () => row });
  h.observe(keys.messages(owner, conversation), page([message()]), async () => { throw new Error("history must not be refetched"); });
  h.sync.receive(owner, "conversation:updated", updated(row));
  await until(() => h.client.getQueryData(keys.messages(owner, conversation)).data.some((item) => item.id === row.id));
});

test("multi-tab caches reconcile independently and do not duplicate authoritative messages or counts", async (t) => {
  const row = message("2");
  const tabs = [harness(t, { loadMessage: async () => row }), harness(t, { loadMessage: async () => row })];
  for (const h of tabs) {
    h.observe(keys.messages(owner, conversation), page([]), async () => page([]));
    h.observe(keys.unreadCount(owner), { unread_messages: 10 }, async () => ({ unread_messages: 1, unread_conversations: 1 }));
    h.sync.receive(owner, "message:new", change(row));
    h.sync.receive(owner, "message:new", change(row));
    h.sync.receive(owner, "conversation:updated", updated(row));
  }
  await until(() => tabs.every((h) => h.client.getQueryData(keys.messages(owner, conversation)).data.length === 1));
  for (const h of tabs) {
    assert.equal(h.client.getQueryData(keys.messages(owner, conversation)).data[0].id, row.id);
    assert.equal(h.client.getQueryData(keys.unreadCount(owner)).unread_messages, 1);
  }
});

test("read hints, including out-of-order hints, use REST state and do not refetch history or mark background chats read", async (t) => {
  let reads = 0, historyFetches = 0;
  const h = harness(t);
  h.observe(keys.messages(owner, conversation), page([message()]), async () => { historyFetches++; return page([]); });
  h.observe(keys.conversation(owner, conversation), { read_state: { last_read_sequence: "1" } }, async () => {
    reads++; return { read_state: { last_read_sequence: "8" }, unread_count: 0 };
  });
  const event = { event_id: randomUUID(), conversation_id: conversation, recipient_id: owner, user_id: owner, last_read_sequence: "7", last_read_at: time };
  h.sync.receive(owner, "message:read", event);
  await until(() => reads === 1);
  h.sync.receive(owner, "message:read", { ...event, event_id: randomUUID(), last_read_sequence: "2" });
  await until(() => reads === 2);
  assert.equal(h.client.getQueryData(keys.conversation(owner, conversation)).read_state.last_read_sequence, "8");
  assert.equal(historyFetches, 0);
});

test("reconnect/foreground refetch active bounded history pages and metadata, leaving inactive caches stale", async (t) => {
  const newest = message("3"), first = message("2"), older = message("1");
  let fetchedPages = 0, unreadFetches = 0;
  const h = harness(t);
  const observer = new InfiniteQueryObserver(h.client, {
    queryKey: keys.messages(owner, conversation), initialPageParam: undefined,
    initialData: { pages: [page([first], true), page([older])], pageParams: [undefined, "2"] },
    queryFn: async ({ pageParam }) => { fetchedPages++; return pageParam ? page([older]) : page([newest, first], true); },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  h.stops.push(observer.subscribe(() => {}));
  h.observe(keys.unreadCount(owner), { unread_messages: 0 }, async () => { unreadFetches++; return { unread_messages: 2 }; });
  const inactive = keys.messages(owner, randomUUID());
  h.client.setQueryData(inactive, page([message()]));
  h.sync.refresh(owner);
  h.sync.refresh(owner);
  await until(() => fetchedPages === 2 && unreadFetches === 1);
  assert.equal(h.client.getQueryData(keys.messages(owner, conversation)).pages[0].data[0].id, newest.id);
  assert.equal(h.client.getQueryState(inactive).isInvalidated, true);
});

test("an initial pre-event snapshot is canceled so a missed message is not hidden by a late response", async (t) => {
  const row = message();
  let release, fetches = 0;
  const old = new Promise((resolve) => { release = resolve; });
  const h = harness(t, { loadMessage: async () => { throw new Error("initial recovery uses the page query"); } });
  h.observe(keys.messages(owner, conversation), undefined, async () => { fetches++; return fetches === 1 ? old : page([row]); });
  await until(() => fetches === 1);
  h.sync.receive(owner, "message:new", change(row));
  await until(() => h.client.getQueryData(keys.messages(owner, conversation))?.data.length === 1);
  release(page([]));
  await pause(10);
  assert.equal(h.client.getQueryData(keys.messages(owner, conversation)).data[0].id, row.id);
});

test("inactive histories are marked stale without making per-message REST requests", async (t) => {
  let loads = 0;
  const h = harness(t, { loadMessage: async () => { loads++; return message(); } });
  const key = keys.messages(owner, conversation);
  h.client.setQueryData(key, page([message()]));
  h.sync.receive(owner, "message:new", change(message("2")));
  await until(() => h.client.getQueryState(key).isInvalidated);
  assert.equal(loads, 0);
});

test("malformed/other-owner events are ignored and disposal cancels a scheduled batch", async (t) => {
  let loads = 0;
  const row = message();
  const h = harness(t, { loadMessage: async () => { loads++; return row; } });
  h.observe(keys.messages(owner, conversation), page([]), async () => page([]));
  assert.equal(h.sync.receive(owner, "message:new", change(row, other)), false);
  assert.equal(h.sync.receive(owner, "message:new", { ...change(row), message_id: "bad" }), false);
  assert.equal(h.sync.receive(owner, "message:new", change(row)), true);
  h.sync.dispose();
  await pause(130);
  assert.equal(loads, 0);
  assert.equal(h.client.getQueryData(keys.messages(owner, conversation)).data.length, 0);
});

test("a burst of hints uses bounded REST reconciliation instead of an unbounded message lookup queue", async (t) => {
  let loads = 0, fetches = 0;
  const row = message("400");
  const h = harness(t, { loadMessage: async () => { loads++; return row; } });
  h.observe(keys.messages(owner, conversation), page([]), async () => { fetches++; return page([row]); });
  for (let index = 1; index <= 300; index++) h.sync.receive(owner, "message:new", change(message(String(index))));
  await until(() => fetches === 1);
  assert.equal(loads, 0);
  assert.equal(h.client.getQueryData(keys.messages(owner, conversation)).data[0].id, row.id);
});

test("logout/account replacement aborts event resolution and rejects late writes while the new owner can reconcile", async (t) => {
  let currentOwner = owner, release, signal, newOwnerFetches = 0;
  const row = message("2");
  const deferred = new Promise((resolve) => { release = resolve; });
  const h = harness(t, { getUserId: () => currentOwner, loadMessage: async (_conversation, _id, requestSignal) => { signal = requestSignal; return deferred; } });
  h.observe(keys.messages(owner, conversation), page([message()]), async () => page([]));
  h.sync.receive(owner, "message:new", change(row));
  await until(() => !!signal);
  h.sync.clear();
  await h.client.cancelQueries({ queryKey: keys.viewer(owner) });
  h.client.removeQueries({ queryKey: keys.viewer(owner) });
  currentOwner = other;
  h.observe(keys.unreadCount(other), { unread_messages: 0 }, async () => { newOwnerFetches++; return { unread_messages: 4 }; });
  h.sync.refresh(other);
  await until(() => newOwnerFetches === 1);
  assert.equal(signal.aborted, true);
  assert.equal(h.sync.receive(owner, "message:new", change(row)), false);
  release(row);
  await pause(10);
  assert.equal(h.client.getQueryData(keys.messages(owner, conversation)), undefined);
  assert.equal(h.client.getQueryData(keys.unreadCount(other)).unread_messages, 4);
});

test("REST resolution failures keep cached history stale and a later reconnect recovers", async (t) => {
  const row = message("2");
  let fetches = 0;
  const h = harness(t, { loadMessage: async () => { throw new Error("offline"); } });
  const key = keys.messages(owner, conversation);
  h.observe(key, page([message()]), async () => { fetches++; return page([row]); });
  h.sync.receive(owner, "message:new", change(row));
  await until(() => h.client.getQueryState(key).isInvalidated);
  assert.equal(fetches, 0);
  h.sync.refresh(owner);
  await until(() => fetches === 1);
  assert.equal(h.client.getQueryData(key).data[0].id, row.id);
});

test("a missing authoritative message/conversation removes stale private caches", async (t) => {
  const h = harness(t, { loadMessage: async () => { throw { status: 404 }; } });
  const key = keys.messages(owner, conversation);
  h.observe(key, page([message()]), async () => page([]));
  h.client.setQueryData(keys.conversation(owner, conversation), { id: conversation });
  h.sync.receive(owner, "message:new", change(message("2")));
  await until(() => h.client.getQueryData(key) === undefined);
  assert.equal(h.client.getQueryData(keys.conversation(owner, conversation)), undefined);
});

test("messaging callbacks reuse lifecycle token refresh and ignore old sockets after account changes/dispose", async () => {
  class Socket {
    handlers = new Map();
    on(name, callback) { this.handlers.set(name, callback); return this; }
    connect() {}
    disconnect() {}
    removeAllListeners() { this.handlers.clear(); }
  }
  let token = `h.${Buffer.from(JSON.stringify({ sub: owner })).toString("base64url")}.s`;
  const sockets = [], received = [];
  let refreshed = 0;
  const lifecycle = createRealtimeLifecycle({
    createSocket: () => { const socket = new Socket(); sockets.push(socket); return socket; }, getToken: () => token,
    refreshToken: async () => { refreshed++; token += "new"; lifecycle.tokenChanged(); return token; },
    onMessagingEvent: (user, name) => received.push([user, name]),
  });
  try {
    lifecycle.setUser(owner);
    const stale = ["message:new", "message:read", "conversation:updated"].map((name) => sockets[0].handlers.get(name));
    stale[0]({});
    sockets[0].handlers.get("auth:expired")({});
    await pause();
    assert.equal(refreshed, 1);
    assert.equal(sockets.length, 2);
    token = `h.${Buffer.from(JSON.stringify({ sub: other })).toString("base64url")}.s`;
    lifecycle.tokenChanged(); lifecycle.setUser(other);
    stale.forEach((callback) => callback({}));
    assert.deepEqual(received, [[owner, "message:new"]]);
    sockets.at(-1).handlers.get("message:new")({});
    assert.deepEqual(received.at(-1), [other, "message:new"]);
    lifecycle.dispose();
    assert.equal(sockets.at(-1).handlers.size, 0);
  } finally { lifecycle.dispose(); }
});
