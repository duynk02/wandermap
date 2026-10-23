import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { createStore } from "zustand/vanilla";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/stores/messageDraftStore.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

/**
 * Execute the actual draft store with real Zustand, isolated per test. Only the auth/token
 * source and React's effect registration are replaced. Effect setup/cleanup is driven here;
 * rendering AuthProvider and browser navigation are covered separately by browser tests.
 */
function harness(t, { owner = null, session = 1 } = {}) {
  const auth = createStore(() => ({ user: owner ? { id: owner } : null }));
  let version = session;
  const tokenListeners = new Set();
  const authListeners = new Set();
  const effects = [];
  const authSource = {
    getState: auth.getState,
    subscribe: (listener) => {
      authListeners.add(listener);
      const stop = auth.subscribe(listener);
      return () => { authListeners.delete(listener); stop(); };
    },
  };
  const tokenSource = {
    getAuthSessionVersion: () => version,
    subscribeAccessToken: (listener) => {
      tokenListeners.add(listener);
      return () => tokenListeners.delete(listener);
    },
  };
  const moduleValue = { exports: {} };
  const load = (name) => {
    if (name === "react") return { useEffect: (effect) => effects.push(effect) };
    if (name === "@/lib/api/client") return tokenSource;
    if (name === "@/stores/authStore") return { useAuthStore: authSource };
    return require(name);
  };
  new Function("require", "module", "exports", compiled)(load, moduleValue, moduleValue.exports);
  const api = moduleValue.exports;
  const notifyToken = () => tokenListeners.forEach((listener) => listener("test-only-token"));
  const mount = () => {
    api.useMessageDraftSession();
    const stops = effects.splice(0).map((effect) => effect());
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      stops.forEach((cleanup) => cleanup?.());
    };
    t.after(stop);
    return stop;
  };
  return {
    ...api,
    state: () => api.useMessageDraftStore.getState(),
    auth, authListeners, tokenListeners, mount, notifyToken,
    setUser: (id) => auth.setState({ user: id ? { id } : null }),
    advanceSession: () => { version += 1; return version; },
    replaceSession: () => { version += 1; notifyToken(); return version; },
  };
}

const userA = randomUUID(), userB = randomUUID(), chat = randomUUID();
const localMessage = (sender = userA, status = "pending") => ({
  client_message_id: randomUUID(), conversation_id: chat, sender_id: sender,
  content: "Hẹn nhau ở Đà Nẵng 🗺️", created_at: "2026-10-23T12:00:00.000Z", status,
});
const draft = (sender = userA) => ({ text: "  Chuyến đi tiếp theo 🌿\n  ", messages: [localMessage(sender)] });

test("draft session initializes from the restored user without mounting messaging UI", (t) => {
  const h = harness(t, { owner: userA, session: 41 });
  assert.equal(h.state().owner, null);
  h.mount();
  assert.equal(h.state().owner, userA);
  assert.equal(h.state().session, 41);
  const expected = draft();
  h.updateMessageDraft(userA, chat, (previous) => {
    assert.deepEqual(previous, { text: "", messages: [] });
    return expected;
  });
  assert.deepEqual(h.state().drafts[chat], expected);
  assert.equal(h.authListeners.size, 1);
  assert.equal(h.tokenListeners.size, 1);
});

test("ordinary token refresh and profile changes preserve the draft and pending operation", (t) => {
  const h = harness(t, { owner: userA });
  h.mount();
  const pending = draft();
  h.updateMessageDraft(userA, chat, () => pending);
  const previous = h.state();
  h.notifyToken();
  h.auth.setState({ profile: { display_name: "Tên vừa cập nhật" } });
  h.setUser(userA);
  assert.equal(h.state(), previous);
  assert.equal(h.state().drafts[chat], pending);
  assert.equal(h.state().drafts[chat].messages[0].client_message_id, pending.messages[0].client_message_id);
});

test("logout clears all private drafts while outside messaging and blocks a late mutation updater", (t) => {
  const h = harness(t, { owner: userA });
  h.mount();
  h.updateMessageDraft(userA, chat, () => draft());
  h.updateMessageDraft(userA, "another-chat", () => ({ text: "Bản nháp khác", messages: [localMessage(userA, "failed")] }));
  h.setUser(null);
  assert.equal(h.state().owner, null);
  assert.deepEqual(h.state().drafts, {});
  let called = false;
  h.updateMessageDraft(userA, chat, () => { called = true; return draft(); });
  assert.equal(called, false);
  assert.deepEqual(h.state().drafts, {});
});

test("account switch removes the old outbox and allows only the new owner to write", (t) => {
  const h = harness(t, { owner: userA });
  h.mount();
  h.updateMessageDraft(userA, chat, () => draft());
  h.setUser(userB);
  assert.equal(h.state().owner, userB);
  assert.deepEqual(h.state().drafts, {});
  const next = draft(userB);
  h.updateMessageDraft(userB, chat, () => next);
  const current = h.state();
  let staleUpdaterRan = false;
  h.updateMessageDraft(userA, chat, () => { staleUpdaterRan = true; return draft(); });
  assert.equal(staleUpdaterRan, false);
  assert.equal(h.state(), current);
  assert.equal(h.state().drafts[chat], next);
});

test("replacement login for the same user clears pending messages without an owner change", (t) => {
  const h = harness(t, { owner: userA, session: 8 });
  h.mount();
  h.updateMessageDraft(userA, chat, () => draft());
  const version = h.replaceSession();
  assert.equal(h.state().owner, userA);
  assert.equal(h.state().session, version);
  assert.deepEqual(h.state().drafts, {});
  h.updateMessageDraft(userA, chat, () => ({ text: "Phiên mới", messages: [] }));
  assert.equal(h.state().drafts[chat].text, "Phiên mới");
});

test("session guard rejects a stale updater before token notification synchronizes the store", (t) => {
  const h = harness(t, { owner: userA });
  h.mount();
  h.updateMessageDraft(userA, chat, () => draft());
  const previous = h.state();
  h.advanceSession();
  let called = false;
  h.updateMessageDraft(userA, chat, () => { called = true; return { text: "Kết quả cũ", messages: [] }; });
  assert.equal(called, false);
  assert.equal(h.state(), previous);
  h.notifyToken();
  assert.deepEqual(h.state().drafts, {});
});

test("effect cleanup removes both listeners and remount reconciles the current account", (t) => {
  const h = harness(t, { owner: userA });
  const stop = h.mount();
  h.updateMessageDraft(userA, chat, () => draft());
  const previous = h.state();
  stop();
  assert.equal(h.authListeners.size, 0);
  assert.equal(h.tokenListeners.size, 0);
  h.setUser(userB);
  h.replaceSession();
  assert.equal(h.state(), previous, "cleaned up listeners cannot update the store");
  h.mount();
  assert.equal(h.state().owner, userB);
  assert.deepEqual(h.state().drafts, {});
  assert.equal(h.authListeners.size, 1);
  assert.equal(h.tokenListeners.size, 1);
});

test("effect replay in the same auth session preserves drafts without duplicate listeners", (t) => {
  const h = harness(t, { owner: userA });
  const stop = h.mount();
  h.updateMessageDraft(userA, chat, () => draft());
  const previous = h.state();
  stop();
  h.mount();
  assert.equal(h.state(), previous);
  assert.equal(h.authListeners.size, 1);
  assert.equal(h.tokenListeners.size, 1);
  h.setUser(null);
  assert.deepEqual(h.state().drafts, {});
});
