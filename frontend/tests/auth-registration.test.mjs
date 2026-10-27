import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".")) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });
const { register } = await import("../src/lib/api/auth.ts");
const { getAccessToken, refreshAccessToken, setAccessToken, subscribeAccessToken, subscribeSessionChange } = await import("../src/lib/api/client.ts");
hooks.deregister();

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalChannel = globalThis.BroadcastChannel;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const input = { display_name: "Du khách", username: "traveler", email: "traveler@example.test", password: "registration-fixture-only" };
const registrationResponse = () => Response.json({ accessToken: "must-not-be-published", user: { id: "fixture-user" } }, { status: 201 });

beforeEach(() => {
  globalThis.window = {};
  setAccessToken(null);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.BroadcastChannel = originalChannel;
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else delete globalThis.navigator;
  setAccessToken(null);
});

test("registration clears the server-created cookie without publishing a login or access token", async () => {
  let channel;
  globalThis.BroadcastChannel = class {
    constructor() { channel = this; this.signals = []; }
    postMessage(signal) { this.signals.push(signal); }
    close() {}
  };
  const stopChannel = subscribeSessionChange(() => {});
  const tokens = [];
  const stopTokens = subscribeAccessToken((token) => tokens.push(token));
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return url.endsWith("/auth/register") ? registrationResponse() : Response.json({ success: true });
  };
  try {
    assert.deepEqual(await register(input), { sessionCleared: true });
    assert.deepEqual(calls.map(({ url }) => url), ["/api/v1/auth/register", "/api/v1/auth/logout"]);
    assert.deepEqual(JSON.parse(calls[0].options.body), input);
    for (const call of calls) {
      assert.equal(call.options.method, "POST");
      assert.equal(call.options.credentials, "include");
      assert.equal(call.options.headers.Authorization, undefined);
    }
    assert.equal(getAccessToken(), null);
    assert.ok(tokens.every((token) => token === null));
    assert.deepEqual(channel.signals, ["signed-out"]);
  } finally { stopTokens(); stopChannel(); }
});

test("registration and session cleanup share one cookie lock and suppress refresh until cleanup finishes", async () => {
  let locks = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: {
    async request(name, operation) { assert.equal(name, "wandermap-session-cookie"); locks++; return operation(); },
  } } });
  let finishLogout;
  let enteredLogout;
  const entered = new Promise((resolve) => { enteredLogout = resolve; });
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.endsWith("/auth/register")) return registrationResponse();
    enteredLogout();
    return new Promise((resolve) => { finishLogout = resolve; });
  };
  const pending = register(input);
  await entered;
  assert.equal(await refreshAccessToken(), null);
  assert.equal(locks, 1);
  assert.equal(calls.length, 2);
  finishLogout(Response.json({ success: true }));
  assert.deepEqual(await pending, { sessionCleared: true });
});

test("duplicate account errors remain registration failures and do not send logout", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return Response.json({ code: "CONFLICT", message: "Email này đã được đăng ký." }, { status: 409 });
  };
  await assert.rejects(register(input), { status: 409, message: "Email này đã được đăng ký." });
  assert.deepEqual(calls, ["/api/v1/auth/register"]);
  assert.equal(getAccessToken(), null);
});

test("a network failure during account creation is reported without retrying registration", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError("Fixture network failure"); };
  await assert.rejects(register(input), { message: "Fixture network failure" });
  assert.equal(calls, 1);
});

test("cleanup failure preserves the successful account result so the UI can show a login warning", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return url.endsWith("/auth/register") ? registrationResponse() : Response.json({ message: "Unavailable" }, { status: 503 });
  };
  assert.deepEqual(await register(input), { sessionCleared: false });
  assert.equal(calls.length, 2);
  assert.equal(getAccessToken(), null);
});
