import assert from "node:assert/strict";
import test from "node:test";
import { InfiniteQueryObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { createNotificationSync, parseNotificationChanged, refreshNotificationQueries } from "../src/lib/realtime/notifications.ts";
import { useRealtimeStore } from "../src/stores/realtimeStore.ts";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const event = (patch = {}) => ({
  notification_id: "20000000-0000-4000-8000-000000000001",
  recipient_id: owner,
  type: "like",
  change: "created",
  ...patch,
});

test("new/read events refresh every loaded infinite-query page and preserve page parameters", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ["notifications", "list", owner];
  let version = 0;
  const observer = new InfiniteQueryObserver(client, {
    queryKey: key, initialPageParam: 1, staleTime: Infinity,
    queryFn: async ({ pageParam }) => ({
      data: (pageParam === 1 ? (version ? [0, 1] : [1, 2]) : (version ? [2, 3] : [3, 4]))
        .map((id) => ({ id, is_unread: version < 2 })),
      hasMore: pageParam < 2,
    }),
    getNextPageParam: (last, pages) => last.hasMore ? pages.length + 1 : undefined,
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await observer.refetch();
    await observer.fetchNextPage();
    version = 1; // Created: a new item shifts the boundary between loaded pages.
    await refreshNotificationQueries(client, [key], () => true);
    assert.deepEqual(client.getQueryData(key).pageParams, [1, 2]);
    assert.deepEqual(client.getQueryData(key).pages.flatMap((page) => page.data.map((item) => item.id)), [0, 1, 2, 3]);
    version = 2; // Read: server is authoritative for every loaded row.
    await refreshNotificationQueries(client, [key], () => true);
    assert.ok(client.getQueryData(key).pages.flatMap((page) => page.data).every((item) => !item.is_unread));
    assert.deepEqual(client.getQueryData(key).pageParams, [1, 2]);
  } finally { unsubscribe(); client.clear(); }
});

test("notification payloads accept only known types/changes and valid identities", () => {
  assert.deepEqual(parseNotificationChanged(event()), event());
  for (const type of ["comment_like", "reply"]) {
    for (const change of ["created", "read", "deleted"]) {
      assert.deepEqual(parseNotificationChanged(event({ type, change })), event({ type, change }));
    }
  }
  for (const payload of [null, [], event({ notification_id: "like:post-id" }), event({ recipient_id: "bad" }), event({ type: "message" }), event({ change: "unknown" })]) {
    assert.equal(parseNotificationChanged(payload), null);
  }
});

test("bursts are batched, duplicate delivery is bounded, and read/delete remain distinct changes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const invalidated = [];
  const sync = createNotificationSync({ getUserId: () => owner, invalidate: (id) => invalidated.push(id) });
  assert.equal(sync.receive(owner, event()), true);
  assert.equal(sync.receive(owner, event()), false);
  assert.equal(sync.receive(owner, event({ change: "read" })), true);
  assert.equal(sync.receive(owner, event({ change: "deleted" })), true);
  assert.deepEqual(invalidated, []);
  t.mock.timers.tick(100);
  assert.deepEqual(invalidated, [owner]);
  for (let i = 2; i <= 260; i++) sync.receive(owner, event({ notification_id: `20000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}` }));
  assert.equal(sync.receive(owner, event()), true, "old entries are evicted instead of growing without bound");
  t.mock.timers.tick(100);
  assert.equal(invalidated.length, 2);
  t.mock.timers.tick(60_000);
  assert.equal(sync.receive(owner, event()), true, "dedup entries expire after 60 seconds");
  sync.dispose();
});

test("cross-account events, pending batches after logout, and disposed listeners cannot touch caches", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let viewer = owner;
  const invalidated = [];
  const sync = createNotificationSync({ getUserId: () => viewer, invalidate: (id) => invalidated.push(id) });
  assert.equal(sync.receive(owner, event({ recipient_id: other })), false);
  sync.receive(owner, event());
  viewer = null;
  t.mock.timers.tick(100);
  assert.deepEqual(invalidated, []);
  sync.clear();
  viewer = other;
  assert.equal(sync.receive(owner, event()), false);
  sync.refresh(other);
  t.mock.timers.tick(100);
  assert.deepEqual(invalidated, [other]);
  sync.refresh(other);
  sync.dispose();
  t.mock.timers.tick(100);
  assert.deepEqual(invalidated, [other]);
  assert.equal(sync.receive(other, event({ recipient_id: other })), false);
});

test("REST remains authoritative when one event represents several unread interactions", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ["notifications", "unread-count", owner];
  const foreignKey = ["notifications", "unread-count", other];
  let serverCount = 4;
  const observer = new QueryObserver(client, { queryKey: key, queryFn: async () => serverCount, staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => {});
  await observer.refetch();
  client.setQueryData(foreignKey, 23);
  const sync = createNotificationSync({
    getUserId: () => owner,
    invalidate: () => { void refreshNotificationQueries(client, [key], () => true); },
  });
  serverCount = 9;
  sync.receive(owner, event());
  sync.receive(owner, event());
  t.mock.timers.tick(100);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(client.getQueryData(key), 9, "count comes from REST rather than incrementing by one");
  assert.equal(client.getQueryData(foreignKey), 23);
  sync.dispose();
  unsubscribe();
  client.clear();
});

test("an event cancels a pending initial snapshot before fetching the authoritative unread count", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ["notifications", "unread-count", owner];
  let resolveOld;
  let requests = 0;
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: () => {
      requests += 1;
      return requests === 1 ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve(9);
    },
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  assert.equal(requests, 1);
  assert.equal(client.getQueryData(key), undefined);
  const sync = createNotificationSync({
    getUserId: () => owner,
    invalidate: () => { void refreshNotificationQueries(client, [key], () => true); },
  });
  sync.receive(owner, event());
  sync.receive(owner, event());
  t.mock.timers.tick(100);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 2, "one fresh request after cancelling the obsolete initial fetch");
  assert.equal(client.getQueryData(key), 9);
  resolveOld(4);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(client.getQueryData(key), 9, "a late old response cannot replace the post-event count");
  sync.dispose();
  unsubscribe();
  client.clear();
});

test("an owner switch during cancellation prevents a follow-up request for the old account", async () => {
  let current = true;
  let resolveCancellation;
  let invalidations = 0;
  const pending = refreshNotificationQueries({
    cancelQueries: () => new Promise((resolve) => { resolveCancellation = resolve; }),
    invalidateQueries: async () => { invalidations += 1; },
  }, [["notifications", "old-owner"]], () => current);
  current = false;
  resolveCancellation();
  await pending;
  assert.equal(invalidations, 0);
});

test("fallback remains active until both socket and notification listener are healthy for this owner", () => {
  const state = useRealtimeStore.getState();
  state.setConnection(owner, true);
  assert.equal(useRealtimeStore.getState().notificationsAvailable, false);
  state.setNotificationsAvailable(owner, true);
  assert.equal(useRealtimeStore.getState().notificationsAvailable, true);
  state.setConnection(owner, false);
  assert.equal(useRealtimeStore.getState().notificationsAvailable, false);
  state.setConnection(other, true);
  state.setNotificationsAvailable(owner, true);
  assert.equal(useRealtimeStore.getState().notificationsAvailable, false, "old owner status is ignored");
  state.setNotificationsAvailable(other, true);
  state.setNotificationsAvailable(other, false);
  assert.equal(useRealtimeStore.getState().notificationsAvailable, false, "listener failure restores fallback while the socket stays connected");
  state.setConnection(null, false);
});

test("all tabs of an owner invalidate independently without multiplying the stored count", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tabs = [[], []];
  const listeners = tabs.map((invalidated) => createNotificationSync({
    getUserId: () => owner,
    invalidate: (id) => invalidated.push(id),
  }));
  for (const listener of listeners) {
    listener.receive(owner, event());
    listener.receive(owner, event());
  }
  t.mock.timers.tick(100);
  assert.deepEqual(tabs, [[owner], [owner]]);
  listeners.forEach((listener) => listener.dispose());
});
