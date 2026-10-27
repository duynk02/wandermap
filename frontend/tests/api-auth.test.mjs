// node --experimental-transform-types --test tests/api-auth.test.mjs
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  getAccessToken,
  getAccessTokenVersion,
  apiFetch,
  refreshAccessToken,
  runAuthTransition,
  setAccessToken,
  setSessionExpiredHandler,
  settleAccessTokenRefresh,
  subscribeAccessToken,
  withSessionCookieLock,
  subscribeSessionChange,
  announceSessionChange,
} from "../src/lib/api/client.ts";

test("cross-tab cookie operations are serialized without sharing access tokens", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  globalThis.window = {};
  let tail = Promise.resolve();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: {
    request(name, operation) {
      assert.equal(name, "wandermap-session-cookie");
      const current = tail.then(operation); tail = current.catch(() => {}); return current;
    },
  } } });
  const operations = [];
  let finish;
  try {
    const first = withSessionCookieLock(async () => { operations.push("refresh"); await new Promise(resolve => { finish = resolve; }); operations.push("cookie-rotated"); });
    const second = withSessionCookieLock(async () => { operations.push("logout"); });
    await Promise.resolve();
    assert.deepEqual(operations, ["refresh"]);
    finish(); await Promise.all([first, second]);
    assert.deepEqual(operations, ["refresh", "cookie-rotated", "logout"]);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor); else delete globalThis.navigator;
  }
});

test("cross-tab channel accepts only session lifecycle signals and closes on cleanup", () => {
  const Original = globalThis.BroadcastChannel;
  globalThis.window = {};
  let channel;
  globalThis.BroadcastChannel = class {
    constructor() { channel = this; this.sent = []; this.closed = false; }
    postMessage(data) { this.sent.push(data); }
    close() { this.closed = true; }
  };
  const received = [];
  const stop = subscribeSessionChange(change => received.push(change));
  try {
    channel.onmessage({ data: { token: "must-not-be-accepted" } });
    channel.onmessage({ data: "signed-out" });
    announceSessionChange("signed-in");
    assert.deepEqual(received, ["signed-out"]);
    assert.deepEqual(channel.sent, ["signed-in"]);
  } finally { stop(); globalThis.BroadcastChannel = Original; }
  assert.equal(channel.closed, true);
});

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

test("a timed-out refresh releases the shared request so a later recovery can succeed", async () => {
  const timeout = AbortSignal.timeout;
  const failure = new Error("Auth request timeout");
  try {
    AbortSignal.timeout = milliseconds => {
      assert.equal(milliseconds, 15_000);
      return AbortSignal.abort(failure);
    };
    globalThis.fetch = async (_url, options) => { assert.equal(options.signal.aborted, true); throw options.signal.reason; };
    await assert.rejects(refreshAccessToken(), failure);
    globalThis.fetch = async () => Response.json({ accessToken: "recovered-after-timeout" });
    assert.equal(await refreshAccessToken(), "recovered-after-timeout");
  } finally { AbortSignal.timeout = timeout; }
});

test("a shared-cookie account switch cannot publish another owner's token before the tab signal", async () => {
  const jwt = sub => `header.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.signature`;
  setAccessToken(jwt("account-a"));
  let expired = 0;
  setSessionExpiredHandler(() => expired++);
  globalThis.fetch = async () => Response.json({ accessToken: jwt("account-b") });
  assert.equal(await refreshAccessToken(), null);
  assert.equal(getAccessToken(), null);
  assert.equal(expired, 1);
});
beforeEach(() => { setAccessToken(null); });
afterEach(async () => {
  await settleAccessTokenRefresh();
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  setSessionExpiredHandler(null);
  setAccessToken(null);
});

test("REST and socket callers share one rotating refresh request and token subscribers", async () => {
  let resolveFetch;
  let fetchCount = 0;
  const notifications = [];
  const unsubscribe = subscribeAccessToken((token) => notifications.push(token));
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Promise((resolve) => { resolveFetch = resolve; });
  };
  const first = refreshAccessToken();
  const second = refreshAccessToken();
  assert.equal(first, second);
  assert.equal(fetchCount, 1);
  resolveFetch(Response.json({ accessToken: "refreshed" }));
  assert.equal(await first, "refreshed");
  assert.deepEqual(notifications, ["refreshed"]);
  unsubscribe();
});

test("a late refresh cannot restore credentials after logout or overwrite a new account", async () => {
  for (const replacement of [null, "new-account-token"]) {
    setAccessToken("old-account-token");
    let resolveFetch;
    globalThis.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });
    const pending = refreshAccessToken();
    setAccessToken(replacement);
    resolveFetch(Response.json({ accessToken: "stale-old-account-token" }));
    assert.equal(await pending, null);
    assert.equal(getAccessToken(), replacement);
  }
});

test("an invalid refresh cookie expires the session for socket callers too", async () => {
  setAccessToken("expired-token");
  let expiredCalls = 0;
  setSessionExpiredHandler(() => { expiredCalls += 1; });
  globalThis.fetch = async () => new Response(null, { status: 401 });
  assert.equal(await refreshAccessToken(), null);
  assert.equal(getAccessToken(), null);
  assert.equal(expiredCalls, 1);
});

test("a stale refresh rejection cannot expire a newly signed-in account", async () => {
  let resolveFetch;
  let expiredCalls = 0;
  setSessionExpiredHandler(() => { expiredCalls += 1; });
  globalThis.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });
  const pending = refreshAccessToken();
  setAccessToken("new-account-token");
  resolveFetch(new Response(null, { status: 401 }));
  assert.equal(await pending, null);
  assert.equal(getAccessToken(), "new-account-token");
  assert.equal(expiredCalls, 0);
});

test("late REST 401 after logout/account switch cannot rotate cookies or replay under a different session", async () => {
  globalThis.window = {};
  for (const replacement of [null, "new-account-token"]) {
    setAccessToken("old-account-token");
    let resolveRequest;
    const calls = [];
    globalThis.fetch = (url) => {
      calls.push(url);
      return new Promise((resolve) => { resolveRequest = resolve; });
    };
    const pending = apiFetch("/notifications/unread-count");
    setAccessToken(replacement);
    resolveRequest(new Response(null, { status: 401 }));
    await assert.rejects(pending, { status: 401 });
    assert.equal(calls.length, 1, "no refresh or retry after the session changes");
    assert.equal(getAccessToken(), replacement);
  }
});

test("an unchanged browser session refreshes and retries the REST request exactly once", async () => {
  globalThis.window = {};
  setAccessToken("expired-token");
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, token: options.headers?.Authorization });
    if (url.endsWith("/auth/refresh")) return Response.json({ accessToken: "refreshed-token" });
    return calls.length === 1 ? new Response(null, { status: 401 }) : Response.json({ count: 7 });
  };
  assert.deepEqual(await apiFetch("/notifications/unread-count"), { count: 7 });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].token, "Bearer refreshed-token");
});

test("credential versions also change for identical JWT replacements", () => {
  setAccessToken("same-token");
  const before = getAccessTokenVersion();
  setAccessToken("same-token");
  assert.equal(getAccessTokenVersion(), before + 1);
});


test("late concurrent REST 401 reuses the token already refreshed by the same session", async () => {
  globalThis.window = {};
  setAccessToken("expired-token");
  let resolveLateRequest;
  let lateCalls = 0;
  let countCalls = 0;
  let refreshCalls = 0;
  const tokens = [];
  globalThis.fetch = async (url, options) => {
    tokens.push({ url, authorization: options.headers?.Authorization });
    if (url.endsWith("/auth/refresh")) {
      refreshCalls += 1;
      return Response.json({ accessToken: "fresh-token" });
    }
    if (url.endsWith("/notifications/unread-count")) {
      countCalls += 1;
      return countCalls === 1 ? new Response(null, { status: 401 }) : Response.json({ count: 3 });
    }
    lateCalls += 1;
    if (lateCalls === 1) return new Promise((resolve) => { resolveLateRequest = resolve; });
    return Response.json({ data: ["same-user-notification"] });
  };
  const late = apiFetch("/notifications");
  assert.deepEqual(await apiFetch("/notifications/unread-count"), { count: 3 });
  resolveLateRequest(new Response(null, { status: 401 }));
  assert.deepEqual(await late, { data: ["same-user-notification"] });
  assert.equal(refreshCalls, 1, "the delayed 401 must reuse the successful refresh");
  assert.equal(lateCalls, 2);
  assert.equal(tokens.at(-1).authorization, "Bearer fresh-token");
});

test("replacing a session with identical JWT bytes still prevents replay after a pending refresh", async () => {
  globalThis.window = {};
  setAccessToken("same-token");
  let resolveRefresh;
  let refreshStarted;
  const started = new Promise((resolve) => { refreshStarted = resolve; });
  let resourceCalls = 0;
  globalThis.fetch = async (url) => {
    if (url.endsWith("/auth/refresh")) {
      refreshStarted();
      return new Promise((resolve) => { resolveRefresh = resolve; });
    }
    resourceCalls += 1;
    return new Response(null, { status: 401 });
  };
  const pending = apiFetch("/notifications/unread-count");
  await started;
  setAccessToken("same-token");
  resolveRefresh(Response.json({ accessToken: "stale-refreshed-token" }));
  await assert.rejects(pending, { status: 401 });
  assert.equal(resourceCalls, 1);
  assert.equal(getAccessToken(), "same-token");
});


test("authentication changes wait for pending cookie rotation and block new refreshes", async () => {
  setAccessToken("account-a");
  let resolveRefresh;
  let fetchCalls = 0;
  const cookieOperations = [];
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Promise((resolve) => { resolveRefresh = resolve; });
  };
  const rotation = refreshAccessToken();
  const login = runAuthTransition(async (commitToken) => {
    cookieOperations.push("login-cookie-b");
    commitToken("account-b");
    return "user-b";
  });
  assert.equal(getAccessToken(), null, "private transports lose credentials immediately");
  const blockedRefresh = refreshAccessToken();
  await Promise.resolve();
  assert.deepEqual(cookieOperations, [], "login must wait for the old rotation's response cookie");
  assert.equal(fetchCalls, 1);
  cookieOperations.push("refresh-cookie-a");
  resolveRefresh(Response.json({ accessToken: "stale-account-a" }));
  assert.equal(await rotation, null);
  assert.equal(await blockedRefresh, null);
  assert.equal(await login, "user-b");
  assert.deepEqual(cookieOperations, ["refresh-cookie-a", "login-cookie-b"]);
  assert.equal(getAccessToken(), "account-b");
});

test("a new login waits for pending logout so its cookie cannot be cleared afterward", async () => {
  setAccessToken("account-a");
  let cookie = "account-a";
  let completeLogout;
  let logoutEntered;
  const started = new Promise((resolve) => { logoutEntered = resolve; });
  const operations = [];
  const logout = runAuthTransition(async () => {
    operations.push("logout-start");
    logoutEntered();
    await new Promise((resolve) => { completeLogout = resolve; });
    cookie = null;
    operations.push("logout-cookie-cleared");
  });
  const rejectedLogout = assert.rejects(logout, { code: "AUTH_SESSION_CHANGED" });
  await started;
  const login = runAuthTransition(async (commitToken) => {
    cookie = "account-b";
    operations.push("login-cookie-b");
    commitToken("account-b");
    return "user-b";
  });
  await Promise.resolve();
  assert.deepEqual(operations, ["logout-start"]);
  completeLogout();
  await rejectedLogout;
  assert.equal(await login, "user-b");
  assert.deepEqual(operations, ["logout-start", "logout-cookie-cleared", "login-cookie-b"]);
  assert.equal(cookie, "account-b");
  assert.equal(getAccessToken(), "account-b");
});


test("a superseded login cannot publish credentials or return the previous user", async () => {
  let completeFirstLogin;
  let firstLoginEntered;
  const started = new Promise((resolve) => { firstLoginEntered = resolve; });
  const published = [];
  const unsubscribe = subscribeAccessToken((token) => published.push(token));
  try {
    const firstLogin = runAuthTransition(async (commitToken) => {
      firstLoginEntered();
      await new Promise((resolve) => { completeFirstLogin = resolve; });
      commitToken("account-a");
      return "user-a";
    });
    const firstRejected = assert.rejects(firstLogin, { code: "AUTH_SESSION_CHANGED" });
    await started;
    const secondLogin = runAuthTransition(async (commitToken) => {
      commitToken("account-b");
      return "user-b";
    });
    completeFirstLogin();
    await firstRejected;
    assert.equal(await secondLogin, "user-b");
    assert.equal(getAccessToken(), "account-b");
    assert.equal(published.includes("account-a"), false);
  } finally {
    unsubscribe();
  }
});

test("HTTP 401 replay keeps the comment idempotency key and request body unchanged", async () => {
  globalThis.window = {};
  setAccessToken("expired-token");
  const input = { content: "Một kỷ niệm", parent_id: "parent-comment", client_request_id: "30000000-0000-4000-8000-000000000001" };
  const bodies = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/auth/refresh")) return Response.json({ accessToken: "fresh-token" });
    bodies.push(options.body);
    return bodies.length === 1 ? new Response(null, { status: 401 }) : Response.json({ comment: { id: "same-comment" } });
  };
  await apiFetch("/posts/post-id/comments", { method: "POST", body: input });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(JSON.parse(bodies[1]).client_request_id, input.client_request_id);
});

test("private media uses bearer headers, no-store and the shared one-shot refresh", async () => {
  globalThis.window = {};
  setAccessToken("expired-media-fixture");
  const calls = [];
  let refreshes = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url.includes("expired-media-fixture"), false);
    if (url.endsWith("/auth/refresh")) { refreshes++; return Response.json({ accessToken: "fresh-media-fixture" }); }
    calls.push(options);
    return calls.length === 1 ? new Response(null, { status: 401 }) : new Response("webp", { headers: { "content-type": "image/webp" } });
  };
  const blob = await apiFetch("/media/asset-id", { responseType: "blob" });
  assert.equal(await blob.text(), "webp");
  assert.equal(refreshes, 1);
  assert.equal(calls[1].headers.Authorization, "Bearer fresh-media-fixture");
  assert.equal(calls[1].cache, "no-store");
});

test("a media body finishing after account replacement cannot return old private bytes", async () => {
  globalThis.window = {};
  setAccessToken("account-a");
  let finish;
  let bodyStarted;
  const started = new Promise((resolve) => { bodyStarted = resolve; });
  globalThis.fetch = async () => ({ ok: true, status: 200, blob: async () => {
    bodyStarted();
    return new Promise((resolve) => { finish = () => resolve(new Blob(["account-a-private-bytes"])); });
  } });
  const pending = apiFetch("/media/asset-id", { responseType: "blob" });
  const rejected = assert.rejects(pending, { code: "AUTH_SESSION_CHANGED" });
  await started;
  setAccessToken("account-b");
  finish();
  await rejected;
});
