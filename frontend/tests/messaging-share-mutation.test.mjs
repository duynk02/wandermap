import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { ApiError } from "../src/lib/api/client.ts";
import { prepareSharedMessage, shareAttemptKey } from "../src/lib/messaging/share.ts";
import { messageTextLength, MESSAGE_MAX_LENGTH } from "../src/lib/messaging/model.ts";
import { reconcileMessageCache } from "../src/lib/realtime/messaging.ts";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("../src/hooks/useShareContent.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const owner = randomUUID(), other = randomUUID(), chatId = randomUUID(), resourceId = randomUUID();
const target = { type: "shared_post", id: resourceId, restriction: null, preview: { available: true, id: resourceId, title: "Never cache this local snapshot", image_url: "https://example.test/local-secret.webp" } };
const destination = { kind: "conversation", id: chatId, recipient_id: other };
const keys = { messages: (viewer, id) => ["messaging", viewer, "messages", id], conversation: (viewer, id) => ["messaging", viewer, "conversation", id], conversations: (viewer) => ["messaging", viewer, "conversations"], unreadCount: (viewer) => ["messaging", viewer, "unread-count"] };
const message = (input, extra = {}) => ({ id: randomUUID(), conversation_id: chatId, sender_id: owner, sequence: "9007199254740993", client_message_id: input.client_message_id, message_type: input.message_type, content: input.content, created_at: "2026-10-24T00:00:00Z", updated_at: "2026-10-24T00:00:00Z", deleted_at: null,
  shared_resource: { available: false, id: null, title: null, image_url: null, author: null, location: null, address: null, category: null }, ...extra });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

/** Real MutationObserver and query cache execute production hook options; React hook binding,
 * HTTP transport, and auth identity are isolated here. Browser tests cover rendering. */
function harness(t, options = {}) {
  let viewer = owner, version = 1, state = { owner, session: 1, shareAttempts: {} };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  const calls = [];
  const chat = { id: chatId, can_send: options.canSend ?? true };
  const api = {
    getConversation: async (id) => { calls.push({ kind: "get", id }); return options.lookup ? options.lookup() : chat; },
    startDirectConversation: async (id) => { calls.push({ kind: "direct", id }); return { conversation: chat, created: false }; },
    sendConversationMessage: async (id, input) => { calls.push({ kind: "send", id, input }); return options.send ? options.send(input) : { message: message(input), created: true }; },
  };
  const load = (name) => {
    if (name === "@tanstack/react-query") return { useQueryClient: () => client, useMutation: (config) => { const observer = new MutationObserver(client, config); return { mutateAsync: (value) => observer.mutate(value), get isPending() { return observer.getCurrentResult().isPending; } }; } };
    if (name === "@/constants") return { QUERY_KEYS: { messaging: keys } };
    if (name === "@/lib/api/client") return { ApiError, getAuthSessionVersion: () => version };
    if (name === "@/lib/api/messaging") return api;
    if (name === "@/lib/messaging/model") return { messageTextLength, MESSAGE_MAX_LENGTH };
    if (name === "@/lib/messaging/share") return { prepareSharedMessage, shareAttemptKey };
    if (name === "@/lib/realtime/messaging") return { reconcileMessageCache };
    if (name === "@/stores/authStore") return { useAuthStore: { getState: () => ({ user: viewer ? { id: viewer } : null }) } };
    if (name === "@/stores/messageDraftStore") return { useMessageDraftStore: { getState: () => state }, updateShareAttempt: (_viewer, key, attempt) => { if (attempt) state.shareAttempts[key] = attempt; else delete state.shareAttempts[key]; } };
    return require(name);
  };
  const moduleValue = { exports: {} }; new Function("require", "module", "exports", compiled)(load, moduleValue, moduleValue.exports);
  t.after(() => client.clear());
  return { client, calls, state: () => state, hook: (value = target) => moduleValue.exports.useShareContent(owner, 1, value), switchOwner: (id) => { viewer = id; version += 1; state = { owner: id, session: version, shareAttempts: {} }; } };
}

test("REST-authoritative share reconciliation never caches the source preview and never invents a partial history", async (t) => {
  const h = harness(t); await h.hook().send(destination, "");
  assert.equal(h.client.getQueryData(keys.messages(owner, chatId)), undefined);
  assert.equal(h.calls.find((row) => row.kind === "send").input.content, null);
  assert.deepEqual(h.state().shareAttempts, {});
});

test("an authoritative unavailable share wins overlapping REST/socket copies without duplicating its bubble", async (t) => {
  const input = prepareSharedMessage(target, "Cùng đi nhé"); const row = message(input);
  const h = harness(t, { send: async (variables) => ({ message: { ...row, client_message_id: variables.client_message_id }, created: false }) });
  const cache = { pages: [{ data: [row], hasMore: false, next_cursor: null }], pageParams: [undefined] };
  h.client.setQueryData(keys.messages(owner, chatId), cache);
  h.state().shareAttempts[shareAttemptKey(target, destination)] = { input, status: "failed" };
  await h.hook().send(destination, input.content);
  const rows = h.client.getQueryData(keys.messages(owner, chatId)).pages.flatMap((page) => page.data);
  assert.equal(rows.length, 1); assert.equal(rows[0].shared_resource.available, false);
  assert.ok(!JSON.stringify(rows).includes(target.preview.title));
  assert.equal(h.client.getQueryData(keys.messages(owner, chatId)).pageParams, cache.pageParams);
});

test("a failed operation remains retryable after dialog remount with the exact original key/body", async (t) => {
  let attempts = 0;
  const h = harness(t, { send: async (input) => { if (++attempts === 1) throw new Error("lost response"); return { message: message(input), created: false }; } });
  await assert.rejects(h.hook().send(destination, "  Hẹn Đà Lạt 🌿  "), /lost response/);
  assert.equal(Object.values(h.state().shareAttempts)[0].status, "failed");
  await h.hook().send(destination, "Hẹn Đà Lạt 🌿");
  const sent = h.calls.filter((row) => row.kind === "send");
  assert.deepEqual(sent[1].input, sent[0].input); assert.deepEqual(h.state().shareAttempts, {});
  await h.hook().send(destination, "Hẹn Đà Lạt 🌿");
  assert.notEqual(h.calls.filter((row) => row.kind === "send").at(-1).input.client_message_id, sent[0].input.client_message_id);
});

test("switching from a recent conversation to the same username reuses a failed share operation", async (t) => {
  let attempts = 0;
  const h = harness(t, { send: async (input) => { if (++attempts === 1) throw new Error("offline"); return { message: message(input), created: true }; } });
  await assert.rejects(h.hook().send(destination, "Cùng đi"));
  await h.hook().send({ kind: "user", id: other }, "Cùng đi");
  const sent = h.calls.filter((row) => row.kind === "send");
  assert.deepEqual(sent[0].input, sent[1].input); assert.ok(h.calls.some((row) => row.kind === "direct"));
});

test("private sources, captions over the limit and unavailable recipients are rejected before message POST", async (t) => {
  const h = harness(t, { canSend: false });
  await assert.rejects(h.hook({ ...target, restriction: "Riêng tư" }).send(destination, ""), /Riêng tư/);
  await assert.rejects(h.hook().send(destination, "a".repeat(4001)), /4000/);
  assert.equal(h.calls.length, 0);
  await assert.rejects(h.hook().send(destination, ""), /không thể gửi/);
  assert.equal(h.calls.some((row) => row.kind === "send"), false);
});

test("account replacement while resolving a conversation prevents the subsequent message POST", async (t) => {
  const gate = deferred(); const h = harness(t, { lookup: () => gate.promise });
  const pending = h.hook().send(destination, "Private old draft");
  await new Promise((done) => setTimeout(done, 0)); h.switchOwner(other); gate.resolve({ id: chatId, can_send: true });
  await assert.rejects(pending, /Phiên đăng nhập đã thay đổi/);
  assert.equal(h.calls.some((row) => row.kind === "send"), false); assert.deepEqual(h.state().shareAttempts, {});
});

test("a late committed response from the previous account cannot populate cache or restore its failed share", async (t) => {
  const gate = deferred(); let sentInput;
  const h = harness(t, { send: (input) => { sentInput = input; return gate.promise; } });
  const pending = h.hook().send(destination, "Old account draft");
  while (!sentInput) await new Promise((done) => setTimeout(done, 0));
  h.switchOwner(other); gate.resolve({ message: message(sentInput), created: true });
  await assert.rejects(pending, /Phiên đăng nhập đã thay đổi/);
  assert.equal(h.client.getQueryData(keys.messages(owner, chatId)), undefined);
  assert.equal(h.client.getQueryData(keys.messages(other, chatId)), undefined); assert.deepEqual(h.state().shareAttempts, {});
});
