// node --experimental-transform-types --test tests/realtime-lifecycle.test.mjs tests/api-auth.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { accessTokenSubject, createRealtimeLifecycle } from "../src/lib/realtime/lifecycle.ts";

class FakeSocket {
  handlers = new Map();
  connectCount = 0;
  disconnectCount = 0;
  on(event, callback) { this.handlers.set(event, callback); return this; }
  connect() { this.connectCount += 1; }
  disconnect() { this.disconnectCount += 1; }
  removeAllListeners() { this.handlers.clear(); }
  emitServer(event, payload) { this.handlers.get(event)?.(payload); }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const expired = { data: { code: "TOKEN_EXPIRED" } };
const jwt = (label, sub = "user-a") => `header.${Buffer.from(JSON.stringify({ sub, label })).toString("base64url")}.signature`;

function setup(refreshToken = async () => null, callbacks = {}) {
  let token = jwt("token-a");
  const sockets = [];
  const lifecycle = createRealtimeLifecycle({
    createSocket: (credential) => {
      const socket = new FakeSocket();
      sockets.push({ socket, credential: JSON.parse(atob(credential.split(".")[1])).label });
      return socket;
    },
    getToken: () => token,
    refreshToken,
    ...callbacks,
  });
  return {
    sockets,
    lifecycle,
    setToken(value, sub = "user-a") { token = value === null ? null : jwt(value, sub); lifecycle.tokenChanged(); },
  };
}

test("only an authenticated owner connects; token replacement and disposal remove old listeners", () => {
  const harness = setup();
  assert.equal(harness.sockets.length, 0);
  harness.lifecycle.setUser("user-a");
  const first = harness.sockets[0].socket;
  assert.equal(first.connectCount, 1);
  harness.lifecycle.setUser("user-a");
  assert.equal(harness.sockets.length, 1);
  harness.setToken("rotated-token");
  assert.equal(first.disconnectCount, 1);
  assert.equal(first.handlers.size, 0);
  assert.equal(harness.sockets[1].credential, "rotated-token");
  harness.setToken(null);
  assert.equal(harness.sockets[1].socket.disconnectCount, 1);
  harness.lifecycle.dispose();
  harness.setToken("too-late");
  assert.equal(harness.sockets.length, 2);
});

test("connection health and notifications reach only the current socket's owner", () => {
  const connections = [];
  const received = [];
  const statuses = [];
  const harness = setup(async () => null, {
    onConnectionChange: (userId, connected) => connections.push({ userId, connected }),
    onNotification: (userId, payload) => received.push({ userId, payload }),
    onNotificationStatus: (userId, payload) => statuses.push({ userId, payload }),
  });
  harness.lifecycle.setUser("user-a");
  const socket = harness.sockets[0].socket;
  socket.emitServer("connect");
  socket.emitServer("notification:changed", { notification_id: "notification-a" });
  socket.emitServer("notifications:status", { available: true });
  assert.deepEqual(connections.at(-1), { userId: "user-a", connected: true });
  assert.equal(received[0].userId, "user-a");
  assert.deepEqual(statuses[0], { userId: "user-a", payload: { available: true } });
  const staleNotification = socket.handlers.get("notification:changed");
  socket.emitServer("disconnect");
  assert.deepEqual(connections.at(-1), { userId: "user-a", connected: false });
  harness.setToken("token-b", "user-b");
  harness.lifecycle.setUser("user-b");
  staleNotification({ notification_id: "stale-event" });
  assert.equal(received.length, 1);
  harness.lifecycle.dispose();
  assert.deepEqual(connections.at(-1), { userId: "user-b", connected: false });
});

test("an expired handshake shares one refresh and never loops when the new JWT is rejected", async () => {
  let resolveRefresh;
  let refreshCalls = 0;
  const harness = setup(() => {
    refreshCalls += 1;
    return new Promise((resolve) => { resolveRefresh = resolve; });
  });
  harness.lifecycle.setUser("user-a");
  const first = harness.sockets[0].socket;
  first.emitServer("connect_error", expired);
  first.emitServer("auth:expired");
  assert.equal(refreshCalls, 1);
  assert.equal(first.disconnectCount, 1);
  harness.setToken("refreshed-token");
  assert.equal(harness.sockets.length, 1, "wait for the shared refresh to finish");
  resolveRefresh("refreshed-token");
  await tick();
  assert.equal(harness.sockets.length, 2);
  harness.sockets[1].socket.emitServer("connect_error", expired);
  await tick();
  assert.equal(refreshCalls, 1);
  assert.equal(harness.sockets[1].socket.disconnectCount, 1);
  harness.setToken("externally-replaced-token");
  assert.equal(harness.sockets.length, 3);
  harness.lifecycle.dispose();
});

test("an established socket expires, refreshes, and allows a later independent expiry", async () => {
  let refreshCalls = 0;
  const harness = setup(async () => {
    refreshCalls += 1;
    const token = `refreshed-${refreshCalls}`;
    harness.setToken(token);
    return token;
  });
  harness.lifecycle.setUser("user-a");
  harness.sockets[0].socket.emitServer("connect");
  harness.sockets[0].socket.emitServer("auth:expired", {});
  await tick();
  harness.sockets[1].socket.emitServer("connect");
  harness.sockets[1].socket.emitServer("auth:expired", {});
  await tick();
  assert.equal(refreshCalls, 2);
  assert.equal(harness.sockets[2].credential, "refreshed-2");
  harness.lifecycle.dispose();
});

test("invalid credentials and revoked accounts fail closed without refreshing", () => {
  for (const event of ["auth:invalidated", "connect_error"]) {
    let refreshCalls = 0;
    const harness = setup(async () => { refreshCalls += 1; return "unexpected"; });
    harness.lifecycle.setUser("user-a");
    const first = harness.sockets[0].socket;
    first.emitServer(event, { data: { code: "UNAUTHORIZED" } });
    assert.equal(first.disconnectCount, 1);
    assert.equal(refreshCalls, 0);
    harness.lifecycle.setUser("user-a");
    assert.equal(harness.sockets.length, 1);
    harness.setToken("external-new-session");
    assert.equal(harness.sockets.length, 2);
    harness.lifecycle.dispose();
  }
});

test("logout or account switch during refresh cannot reconnect the old session", async () => {
  let resolveRefresh;
  const harness = setup(() => new Promise((resolve) => { resolveRefresh = resolve; }));
  harness.lifecycle.setUser("user-a");
  harness.sockets[0].socket.emitServer("auth:expired");
  harness.setToken(null);
  harness.lifecycle.setUser(null);
  harness.setToken("token-b", "user-b");
  harness.lifecycle.setUser("user-b");
  resolveRefresh(null);
  await tick();
  assert.equal(harness.sockets.length, 2);
  assert.equal(harness.sockets[1].credential, "token-b");
  assert.equal(harness.sockets[1].socket.disconnectCount, 0);
  harness.lifecycle.dispose();
});

test("an account switch cannot authenticate a new owner's socket using the previous owner's token", () => {
  const harness = setup();
  harness.lifecycle.setUser("user-a");
  harness.lifecycle.setUser("user-b");
  assert.equal(harness.sockets[0].socket.disconnectCount, 1);
  assert.equal(harness.sockets.length, 1);
  harness.setToken("token-b", "user-b");
  assert.equal(harness.sockets.length, 2);
  assert.equal(harness.sockets[1].credential, "token-b");
  harness.lifecycle.dispose();
});

test("owner consistency rejects malformed claims; decoding grants no authentication", () => {
  assert.equal(accessTokenSubject("not-a-jwt"), null);
  assert.equal(accessTokenSubject("header.not-json.signature"), null);
  assert.equal(accessTokenSubject(`header.${Buffer.from('{"sub":123}').toString("base64url")}.signature`), null);
  assert.equal(accessTokenSubject(jwt("valid-owner")), "user-a");
});

test("expired refresh cookie or refresh network error leaves the socket closed", async () => {
  for (const refresh of [async () => null, async () => { throw new Error("offline"); }]) {
    const harness = setup(refresh);
    harness.lifecycle.setUser("user-a");
    harness.sockets[0].socket.emitServer("auth:expired");
    await tick();
    assert.equal(harness.sockets.length, 1);
    assert.equal(harness.sockets[0].socket.disconnectCount, 1);
    harness.lifecycle.dispose();
  }
});

test("temporary namespace failure retries with backoff and logout cancels pending retries", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const harness = setup();
  harness.lifecycle.setUser("user-a");
  harness.sockets[0].socket.emitServer("connect_error", { data: { code: "SERVICE_UNAVAILABLE" } });
  assert.equal(harness.sockets.length, 1);
  t.mock.timers.tick(999);
  assert.equal(harness.sockets.length, 1);
  t.mock.timers.tick(501);
  assert.equal(harness.sockets.length, 2);
  harness.sockets[1].socket.emitServer("auth:unavailable");
  harness.setToken(null); harness.lifecycle.setUser(null);
  t.mock.timers.tick(60_000);
  assert.equal(harness.sockets.length, 2);
  harness.lifecycle.dispose();
});

test("refresh network outage retries, whereas a revoked session remains stopped", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  const harness = setup(async () => { attempts++; throw new Error("offline"); });
  harness.lifecycle.setUser("user-a");
  harness.sockets[0].socket.emitServer("auth:expired");
  await tick();
  assert.equal(attempts, 1);
  assert.equal(harness.sockets.length, 1);
  t.mock.timers.tick(1500);
  assert.equal(harness.sockets.length, 2);
  harness.sockets[1].socket.emitServer("connect_error", expired);
  await tick();
  assert.equal(attempts, 2);
  harness.lifecycle.dispose();
  t.mock.timers.tick(60_000);
  assert.equal(harness.sockets.length, 2);
});

test("network disconnect leaves retry ownership with the existing Manager", () => {
  const phases = [];
  const harness = setup(async () => null, { onPhaseChange: (phase) => phases.push(phase) });
  harness.lifecycle.setUser("user-a");
  const socket = harness.sockets[0].socket;
  socket.emitServer("connect"); socket.emitServer("disconnect", "transport close");
  for (let i = 0; i < 10; i++) harness.lifecycle.resume();
  assert.equal(harness.sockets.length, 1);
  socket.emitServer("connect");
  assert.equal(phases.at(-1), "connected");
  harness.lifecycle.dispose();
});
