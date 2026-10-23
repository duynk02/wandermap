import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createRealtimeSessionRegistry } from "../src/lib/realtime/session.ts";
import { createSocketClient } from "../src/lib/realtime/socket-client.ts";
import { createRealtimeLifecycle } from "../src/lib/realtime/lifecycle.ts";

const originalWindow = globalThis.window;
afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});
const flush = () => new Promise((resolve) => queueMicrotask(resolve));

test("SSR acquisition and module imports never initialize a transport", async () => {
  delete globalThis.window;
  let starts = 0;
  createRealtimeSessionRegistry().acquire({}, () => { starts++; return () => {}; })();
  const client = createSocketClient("http://localhost:4000");
  assert.throws(() => client("secret"), /browser/);
  await flush();
  assert.equal(starts, 0);
});

test("Strict Mode setup/cleanup/setup starts one shared resource and cleans it once", async () => {
  globalThis.window = {};
  const registry = createRealtimeSessionRegistry(), owner = {};
  let starts = 0, stops = 0;
  const start = () => { starts++; return () => { stops++; }; };
  registry.acquire(owner, start)();
  const release = registry.acquire(owner, start);
  await flush();
  assert.equal(starts, 1);
  assert.equal(stops, 0);
  release(); release();
  await flush();
  assert.equal(stops, 1);
});

test("multiple mounted consumers and same-tick remount share the existing lifecycle", async () => {
  globalThis.window = {};
  const registry = createRealtimeSessionRegistry(), owner = {};
  let starts = 0, stops = 0;
  const start = () => { starts++; return () => { stops++; }; };
  const first = registry.acquire(owner, start), second = registry.acquire(owner, start);
  await flush(); first(); await flush();
  assert.equal(starts, 1); assert.equal(stops, 0);
  second();
  const remounted = registry.acquire(owner, start);
  await flush();
  assert.equal(starts, 1); assert.equal(stops, 0);
  remounted(); await flush();
  assert.equal(stops, 1);
});

test("mount then immediate removal does not create a Manager", async () => {
  globalThis.window = {};
  let starts = 0;
  createRealtimeSessionRegistry().acquire({}, () => { starts++; return () => {}; })();
  await flush(); assert.equal(starts, 0);
});

test("a second QueryClient cannot own a concurrent private session", async () => {
  globalThis.window = {};
  const registry = createRealtimeSessionRegistry();
  const release = registry.acquire({}, () => () => {});
  assert.throws(() => registry.acquire({}, () => () => {}), /QueryClient/);
  release(); await flush();
  const next = registry.acquire({}, () => () => {});
  await flush(); next(); await flush();
});

test("token changes reuse the same Socket.IO Manager and discard buffered old events", () => {
  globalThis.window = {};
  const factory = createSocketClient("http://127.0.0.1:4000");
  const socket = factory("token-a"), manager = socket.io;
  assert.equal(socket.connected, false);
  socket.receiveBuffer.push(["notification:changed", { recipient_id: "old-owner" }]);
  assert.equal(factory("token-b"), socket);
  assert.equal(socket.io, manager);
  assert.deepEqual(socket.auth, { token: "token-b" });
  assert.deepEqual(socket.receiveBuffer, []);
  socket.disconnect();
});

test("reused socket rejects callbacks from previous credentials, clears auth and stops on logout", () => {
  const callbacks = new Map(), received = [];
  const socket = {
    auth: {}, connects: 0, disconnects: 0,
    on(event, handler) { callbacks.set(event, handler); return this; },
    connect() { this.connects++; }, disconnect() { this.disconnects++; },
    removeAllListeners() { callbacks.clear(); },
  };
  const jwt = (sub) => `header.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.signature`;
  let token = jwt("a");
  const lifecycle = createRealtimeLifecycle({
    createSocket: (credential) => { socket.auth = { token: credential }; return socket; },
    getToken: () => token, refreshToken: async () => null,
    onNotification: (user, payload) => received.push({ user, payload }),
  });
  lifecycle.setUser("a");
  const stale = callbacks.get("notification:changed");
  token = jwt("b"); lifecycle.tokenChanged(); lifecycle.setUser("b");
  stale("old-event");
  callbacks.get("notification:changed")("current-event");
  assert.deepEqual(received, [{ user: "b", payload: "current-event" }]);
  token = null; lifecycle.tokenChanged(); lifecycle.setUser(null);
  assert.deepEqual(socket.auth, {});
  assert.equal(callbacks.size, 0);
  assert.equal(socket.connects, 2);
  lifecycle.dispose();
});
