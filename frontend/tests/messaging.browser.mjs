// Node 22+, Chrome and a local Next server. Every REST mutation and Socket.IO event is a fixture.
// Run: $env:WANDERMAP_TEST_WEB_URL='http://127.0.0.1:3107'; node tests/messaging.browser.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { Server } from "../../backend/node_modules/socket.io/dist/index.js";

const web = process.env.WANDERMAP_TEST_WEB_URL;
assert.ok(web && ["localhost", "127.0.0.1"].includes(new URL(web).hostname), "Explicit local web URL required");
const profile = await mkdtemp(join(tmpdir(), "wandermap-messaging-browser-"));
const artifacts = await mkdtemp(join(tmpdir(), "wandermap-messaging-shots-"));
const userId = "11111111-1111-4111-8111-111111111111";
const recipientId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const secondId = "44444444-4444-4444-8444-444444444444";
const recipient = { id: recipientId, username: "ban_dong_hanh", display_name: "Bạn đồng hành", avatar_url: null, is_active: true, is_following: true, follows_you: true, is_mutual: true, can_message: true };
const user = { id: userId, username: "messaging_test", display_name: "Người khám phá", email: "fixture@example.test", avatar_url: null, bio: null, home_city: null, country_count: 0, total_posts: 0, followers_count: 0, following_count: 0, created_at: "2026-01-01T00:00:00Z" };
const accessToken = `fixture.${Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 900 })).toString("base64url")}.fixture`;
const now = () => new Date().toISOString();
const message = (sequence, content, sender = recipientId, key = randomUUID()) => ({
  id: randomUUID(), conversation_id: conversationId, sender_id: sender, sequence: String(sequence), client_message_id: key,
  message_type: "text", content, shared_resource: null, created_at: now(), updated_at: now(), deleted_at: null,
});
const messages = Array.from({ length: 60 }, (_, index) => message(index + 1, `Chặng đường ${index + 1}: Hẹn gặp ở Đà Lạt, cùng ngắm bình minh và khám phá một góc phố xanh.`, index % 3 === 0 ? userId : recipientId));
const conversation = {
  id: conversationId, type: "direct", created_at: "2026-01-01T00:00:00Z", updated_at: now(), last_message_at: now(),
  recipient, can_send: true, is_mutual: true, blocked_by_me: false, read_state: { last_read_sequence: "56", last_read_at: now() },
  recipient_read_state: { last_read_sequence: "45", last_read_at: now() }, unread_count: 4, last_message: messages.at(-1),
};
const second = {
  ...conversation, id: secondId, recipient: { ...recipient, id: "55555555-5555-4555-8555-555555555555", username: "may_lang_thang", display_name: "Mây lang thang" },
  last_message: null, last_message_at: null, unread_count: 0, read_state: { last_read_sequence: null, last_read_at: null },
  recipient_read_state: { last_read_sequence: null, last_read_at: null },
};
let conversations = [conversation, second];
let listFailure = false, sendMode = "hold", heldSend = null, connected = 0, refuseConnection = false, unfollowMode = "fail", readFailures = 0;
let holdRead = false, heldRead = null, holdDetail = false;
const heldDetails = [];
const requests = [], mutations = [], exceptions = [], checks = [];
const fixtureHttp = createServer();
const fixture = new Server(fixtureHttp, { cors: { origin: new URL(web).origin } });
fixture.of("/realtime").use((_client, next) => {
  if (!refuseConnection) return next();
  const error = new Error("Temporary fixture outage");
  error.data = { code: "SERVICE_UNAVAILABLE" };
  next(error);
});
fixture.of("/realtime").on("connection", (client) => { connected += 1; client.emit("notifications:status", { available: true }); });
await new Promise((done) => fixtureHttp.listen(0, "127.0.0.1", done));
const fixturePort = fixtureHttp.address().port;
const chrome = spawn(process.env.WANDERMAP_BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank",
], { windowsHide: true, stdio: "ignore" });
const pause = (ms = 100) => new Promise((done) => setTimeout(done, ms));
async function until(check, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(); }
  throw new Error(`Timed out: ${label}`);
}
let socket, captureFailure, failureState;
try {
  let port;
  await until(async () => { try { port = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; return !!port; } catch { return false; } }, "Chrome CDP");
  const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, method === "Page.navigate" ? 60000 : 15000);
    pending.set(id, { done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const fulfill = (requestId, result, responseCode = 200) => send("Fetch.fulfillRequest", {
    requestId, responseCode, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(result)).toString("base64"),
  });
  const commit = (input) => {
    const existing = messages.find((item) => item.sender_id === userId && item.client_message_id === input.client_message_id);
    if (existing) return existing;
    const row = message(BigInt(messages.at(-1).sequence) + BigInt(1), input.content, userId, input.client_message_id);
    messages.push(row); conversation.last_message = row; conversation.last_message_at = row.created_at;
    return row;
  };
  const emitMessage = (row) => {
    const payload = { event_id: randomUUID(), conversation_id: conversationId, recipient_id: userId, message_id: row.id, sender_id: row.sender_id,
      client_message_id: row.client_message_id, message_type: "text", sequence: row.sequence, created_at: row.created_at };
    fixture.of("/realtime").emit("message:new", payload);
    fixture.of("/realtime").emit("message:new", payload);
    fixture.of("/realtime").emit("conversation:updated", { event_id: randomUUID(), conversation_id: conversationId, recipient_id: userId, reason: "message", message_id: row.id });
  };
  async function intercept({ requestId, request }) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    const input = request.postData ? JSON.parse(request.postData) : null;
    requests.push({ path, method, query: url.search, input });
    let status = 200;
    let result = { data: [], count: 0, hasMore: false, page: 1, pageSize: 20 };
    if (path.endsWith("/auth/refresh")) result = { accessToken, expiresIn: 900 };
    else if (path.endsWith("/users/me")) result = user;
    else if (path.endsWith(`/users/${recipient.username}/follow`) && method === "DELETE") {
      mutations.push({ path, method, input });
      if (unfollowMode === "fail") { status = 503; result = { message: "Tạm thời chưa thể hủy theo dõi" }; unfollowMode = "success"; }
      else {
        recipient.is_following = false; recipient.is_mutual = false; recipient.can_message = false;
        conversation.can_send = false; conversation.is_mutual = false;
        result = { following: false, changed: true };
      }
    }
    else if (path.endsWith(`/users/${recipient.username}`)) result = { ...user, ...recipient };
    else if (/\/users\/[^/]+$/.test(path)) { status = 404; result = { message: "Không tìm thấy người dùng" }; }
    else if (path.endsWith("/notifications/unread-count")) result = { count: 0 };
    else if (path.endsWith("/conversations/unread-count")) result = { unread_messages: conversation.unread_count, unread_conversations: conversation.unread_count ? 1 : 0 };
    else if (path.endsWith("/conversations/direct") && method === "POST") {
      mutations.push({ path, method, input }); result = { conversation, created: false };
    } else if (path.endsWith("/conversations") && method === "GET") {
      if (listFailure) { status = 503; result = { message: "Không thể tải cuộc trò chuyện" }; }
      else result = { data: conversations, next_cursor: null, hasMore: false };
    } else if (path.endsWith(`/conversations/${conversationId}/read`) && method === "PATCH") {
      mutations.push({ path, method, input });
      if (readFailures > 0) { readFailures--; await fulfill(requestId, { message: "Trạng thái đọc tạm thời chưa lưu được" }, 503); return; }
      if (BigInt(input.last_read_sequence) > BigInt(conversation.read_state.last_read_sequence ?? "0")) conversation.read_state = { last_read_sequence: input.last_read_sequence, last_read_at: now() };
      conversation.unread_count = messages.filter((item) => item.sender_id !== userId && BigInt(item.sequence) > BigInt(conversation.read_state.last_read_sequence)).length;
      result = { conversation_id: conversationId, ...conversation.read_state, unread_count: conversation.unread_count };
      if (holdRead) { heldRead = { requestId, result }; return; }
    } else if (path.endsWith(`/conversations/${conversationId}/messages`) && method === "POST") {
      mutations.push({ path, method, input });
      if (sendMode === "hold") { assert.equal(heldSend, null, "only one pending send"); heldSend = { requestId, input }; return; }
      if (sendMode === "fail") { status = 503; result = { message: "Tạm thời chưa gửi được tin nhắn" }; sendMode = "success"; }
      else result = { message: commit(input), created: true };
    } else if (path.endsWith(`/conversations/${conversationId}/messages`) && method === "GET") {
      const before = BigInt(url.searchParams.get("before_sequence") ?? "9223372036854775807");
      const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 20);
      const eligible = messages.filter((item) => BigInt(item.sequence) < before).toReversed();
      const data = eligible.slice(0, limit), hasMore = eligible.length > data.length;
      result = { data, hasMore, next_cursor: hasMore ? data.at(-1).sequence : null };
    } else if (path.includes(`/conversations/${conversationId}/messages/`)) {
      result = messages.find((item) => item.id === path.split("/").at(-1));
      if (!result) { status = 404; result = { message: "Không tìm thấy tin nhắn" }; }
    } else if (path.endsWith(`/conversations/${conversationId}`)) {
      result = conversation;
      if (holdDetail) { heldDetails.push({ requestId, result: structuredClone(result) }); return; }
    }
    else if (path.endsWith(`/conversations/${secondId}/messages`)) result = { data: [], hasMore: false, next_cursor: null };
    else if (path.endsWith(`/conversations/${secondId}`)) result = second;
    else if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      mutations.push({ path, method, input, blocked: true }); status = 403; result = { message: "Unexpected fixture mutation blocked" };
    }
    await fulfill(requestId, result, status);
  }
  socket.addEventListener("message", ({ data }) => {
    const response = JSON.parse(data);
    if (response.method === "Runtime.exceptionThrown") exceptions.push(response.params.exceptionDetails.exception?.description ?? response.params.exceptionDetails.text);
    if (response.method === "Fetch.requestPaused") void intercept(response.params).catch((error) => {
      if (!error.message.includes("Invalid InterceptionId")) exceptions.push(error.stack ?? error.message);
    });
    const entry = pending.get(response.id);
    if (entry) { pending.delete(response.id); clearTimeout(entry.timer); response.error ? entry.reject(new Error(response.error.message)) : entry.done(response.result); }
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const visible = (selector) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return !!e&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;})()`);
  const textIncludes = (text) => evaluate(`document.body.textContent.includes(${JSON.stringify(text)})`);
  const clickText = (text) => evaluate(`(()=>{const e=Array.from(document.querySelectorAll('button,a')).find(e=>e.getBoundingClientRect().width>0&&e.textContent.includes(${JSON.stringify(text)}));if(!e)throw Error('No visible action: '+${JSON.stringify(text)});e.click();})()`);
  const setComposer = (value) => evaluate(`(()=>{const e=document.querySelector('[data-testid="message-composer"]');e.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const pressEnter = async (shift = false) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r", modifiers: shift ? 8 : 0 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: shift ? 8 : 0 });
  };
  const capture = async (name) => { const shot = await send("Page.captureScreenshot", { format: "png" }); await writeFile(join(artifacts, name), Buffer.from(shot.data, "base64")); };
  captureFailure = () => capture("failure.png");
  failureState = () => evaluate(`({url:location.href,text:document.body.innerText,composer:document.querySelector('[data-testid="message-composer"]')?.value})`);
  const historyState = () => evaluate(`(()=>{const e=document.querySelector('[data-testid="message-history"]');return {top:e.scrollTop,height:e.scrollHeight,client:e.clientHeight,bottom:e.scrollHeight-e.scrollTop-e.clientHeight};})()`);
  const sendCount = () => mutations.filter((entry) => entry.method === "POST" && entry.path.endsWith("/messages")).length;
  const readCount = () => mutations.filter((entry) => entry.method === "PATCH" && entry.path.endsWith("/read")).length;
  const bubbleCount = (key) => evaluate(`document.querySelectorAll('[data-message-key="${userId}:${key}"]').length`);

  await send("Page.enable"); await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/v1/*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    if(location.origin===${JSON.stringify(new URL(web).origin)})localStorage.setItem('wandermap-auth',JSON.stringify({state:{profile:${JSON.stringify(user)}},version:0}));
    window.__fixtureVisibility='visible';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__fixtureVisibility});
    const NativeWebSocket=window.WebSocket;
    window.WebSocket=class extends NativeWebSocket{constructor(url,protocols){const target=new URL(url);if(target.pathname.startsWith('/socket.io')){target.hostname='127.0.0.1';target.port=${JSON.stringify(String(fixturePort))};}super(target.toString(),protocols);}};
  ` });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${web}/messages` });
  await send("Page.bringToFront");
  await until(() => visible('[data-testid="conversation-list"]'), "conversation list");
  await until(() => connected > 0, "authenticated Socket.IO fixture");
  await until(() => textIncludes("Bạn đồng hành"), "real REST conversation data");
  assert.equal(readCount(), 0, "list view does not mark any conversation read");
  await evaluate(`(()=>{const e=document.querySelector('input[aria-label="Tìm cuộc trò chuyện"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'may lang thang');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until(() => evaluate(`!document.querySelector('a[href="/messages/${conversationId}"]')&&!!document.querySelector('a[href="/messages/${secondId}"]')`), "Vietnamese conversation search without accents");
  await evaluate(`(()=>{const e=document.querySelector('input[aria-label="Tìm cuộc trò chuyện"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until(() => evaluate(`!!document.querySelector('a[href="/messages/${conversationId}"]')`), "cleared conversation search");
  await capture("desktop-conversation-list.png");
  await evaluate(`document.querySelector('a[href="/messages/${conversationId}"]').click()`);
  await until(() => visible('[data-testid="message-composer"]'), "selected desktop chat");
  assert.equal(await visible('[data-testid="conversation-list"]'), true, "desktop shows list and detail together");
  await until(async () => (await historyState()).bottom < 12, "initial latest-message scroll");
  await until(() => readCount() > 0, "visible latest page marked read");
  assert.equal(mutations.filter((entry) => entry.path.endsWith("/read")).at(-1).input.last_read_sequence, "60");
  checks.push("desktop list/detail, authoritative unread state and latest-message read cursor");
  await capture("desktop-chat.png");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await until(() => evaluate(`document.documentElement.classList.contains('dark')`), "system dark theme");
  await capture("desktop-chat-dark.png");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await until(() => evaluate(`!document.documentElement.classList.contains('dark')`), "light theme restored");

  const beforeWhitespace = sendCount();
  await setComposer("  \n\t  "); await pressEnter(); await pause(250);
  assert.equal(sendCount(), beforeWhitespace, "whitespace never reaches REST");
  await setComposer("á".repeat(4001)); await pressEnter();
  assert.equal(await evaluate(`document.querySelector('button[aria-label="Gửi tin nhắn"]').disabled`), true, "backend length limit disables send");
  assert.equal(sendCount(), beforeWhitespace, "overlong message never reaches REST");
  await setComposer("Hẹn ở Đà Lạt"); await pressEnter(true);
  assert.equal(sendCount(), beforeWhitespace, "Shift+Enter does not send");
  assert.ok((await evaluate(`document.querySelector('[data-testid="message-composer"]').value`)).includes("\n"), "Shift+Enter inserts a newline");
  const unicode = "Hẹn ở Đà Lạt nhé 🌿\nCùng ngắm bình minh!";
  await setComposer(unicode); await pressEnter();
  await until(() => heldSend !== null, "REST message request held");
  const first = heldSend;
  assert.equal(first.input.content, unicode);
  await until(() => evaluate(`!!document.querySelector('[data-delivery="pending"]')`), "optimistic pending bubble before REST");
  assert.equal(await bubbleCount(first.input.client_message_id), 1);
  assert.equal(await evaluate(`document.querySelector('button[aria-label="Gửi tin nhắn"]').disabled`), true, "send disabled while pending");
  const committed = commit(first.input); emitMessage(committed);
  await until(() => requests.some((entry) => entry.path.endsWith(`/messages/${committed.id}`)), "event resolves authoritative message through REST");
  await fulfill(first.requestId, { message: committed, created: true }); heldSend = null;
  await until(() => evaluate(`!document.querySelector('[data-delivery="pending"]')`), "pending reconciled after response");
  assert.equal(await bubbleCount(first.input.client_message_id), 1, "optimistic, duplicate socket and REST yield one bubble");
  conversation.recipient_read_state = { last_read_sequence: committed.sequence, last_read_at: now() };
  fixture.of("/realtime").emit("message:read", { event_id: randomUUID(), conversation_id: conversationId, recipient_id: userId, user_id: recipientId, last_read_sequence: committed.sequence, last_read_at: now() });
  await until(() => evaluate(`/Đã xem|Đã đọc/.test(document.querySelector('[data-message-key="${userId}:${first.input.client_message_id}"]').textContent)`), "backend-confirmed recipient read status");
  checks.push("Unicode, Enter/Shift+Enter, whitespace guard, pending UI and three-source deduplication");

  sendMode = "fail";
  const failedText = "Một bản nháp có dấu: chuyến đi Hội An 🌼";
  await setComposer(failedText); await pressEnter();
  await until(() => evaluate(`!!document.querySelector('[data-delivery="failed"]')`), "failed bubble and retry");
  const failed = mutations.filter((entry) => entry.method === "POST" && entry.path.endsWith("/messages")).at(-1);
  assert.equal(await evaluate(`document.querySelector('[data-testid="message-composer"]').value`), failedText, "failed request retains draft");
  await capture("desktop-send-error.png");
  await evaluate(`(()=>{const e=document.querySelector('[data-testid="message-history"]');e.scrollTop=0;e.dispatchEvent(new Event('scroll'));})()`);
  await pause(150);
  const withFailedTop = (await historyState()).top, withFailedReads = readCount();
  const whileFailed = message(BigInt(messages.at(-1).sequence) + BigInt(1), "Tin mới xuất hiện trong khi bản nháp gửi trước đó đang thất bại.");
  messages.push(whileFailed); conversation.last_message = whileFailed; conversation.unread_count = 1; emitMessage(whileFailed);
  await until(() => textIncludes("Tin nhắn mới"), "incoming message indicator even when failed local row remains last");
  assert.ok(Math.abs((await historyState()).top - withFailedTop) < 12, "failed local row does not make incoming message autoscroll");
  assert.equal(readCount(), withFailedReads, "failed local row does not falsely acknowledge incoming message");
  await capture("desktop-failed-and-new-message.png");
  await clickText("Tin nhắn mới");
  await until(async () => (await historyState()).bottom < 12, "return to bottom before retry");
  checks.push("failed outbox row cannot hide incoming-message indicator or advance an offscreen read cursor");
  await clickText("Thử gửi lại");
  await until(() => sendCount() > beforeWhitespace + 2, "retry request");
  const retry = mutations.filter((entry) => entry.method === "POST" && entry.path.endsWith("/messages")).at(-1);
  assert.deepEqual(retry.input, failed.input, "retry reuses the same client id and original body");
  await until(() => evaluate(`!document.querySelector('[data-delivery="failed"]')`), "retry resolves failed state");
  assert.equal(await bubbleCount(failed.input.client_message_id), 1);
  checks.push("failed send preserves draft and retry reuses exactly the same idempotency payload");

  const following = message(BigInt(messages.at(-1).sequence) + BigInt(1), "Mình đã chuẩn bị xong lịch trình, cùng lên đường nhé!");
  messages.push(following); conversation.last_message = following; conversation.unread_count = 1; emitMessage(following);
  await until(() => textIncludes(following.content), "incoming message at conversation bottom");
  await until(async () => (await historyState()).bottom < 12, "incoming message follows bottom scroll");
  await until(() => conversation.read_state.last_read_sequence === following.sequence, "visible bottom message acknowledged read");
  checks.push("incoming message follows bottom scroll and advances only the committed read sequence");

  await evaluate(`(()=>{const e=document.querySelector('[data-testid="message-history"]');e.scrollTop=0;e.dispatchEvent(new Event('scroll'));})()`);
  await pause(200);
  const beforeIncoming = await historyState(), readsBeforeIncoming = readCount();
  assert.ok(beforeIncoming.bottom > 100, "fixture creates real history overflow");
  const incoming = message(BigInt(messages.at(-1).sequence) + BigInt(1), "Tin mới: mình đã tìm thấy một cung đường ven hồ rất đẹp!");
  messages.push(incoming); conversation.last_message = incoming; conversation.unread_count = 1; emitMessage(incoming);
  await until(() => textIncludes("Tin nhắn mới"), "new message button when reading old history");
  assert.ok(Math.abs((await historyState()).top - beforeIncoming.top) < 12, "incoming message preserves scroll while reading history");
  assert.equal(readCount(), readsBeforeIncoming, "offscreen message is not marked read");
  await capture("desktop-new-message.png");
  await clickText("Tin nhắn mới");
  await until(async () => (await historyState()).bottom < 12, "new-message button scrolls to latest");
  await until(() => readCount() > readsBeforeIncoming, "new message marked read after reaching bottom");
  checks.push("incoming events preserve historical scroll and wait for explicit bottom visibility before marking read");

  await evaluate(`(()=>{const e=document.querySelector('[data-testid="message-history"]');e.scrollTop=0;e.dispatchEvent(new Event('scroll'));})()`);
  await pause(150);
  const anchor = await evaluate(`(()=>{const h=document.querySelector('[data-testid="message-history"]');const e=h.querySelector('[data-message-key]');return {key:e.getAttribute('data-message-key'),top:e.getBoundingClientRect().top};})()`);
  await clickText("Tải tin nhắn cũ");
  await until(() => requests.some((entry) => entry.path.endsWith("/messages") && entry.method === "GET" && entry.query.includes("before_sequence=")), "older history REST page");
  await until(() => textIncludes("Chặng đường 21:"), "older messages rendered");
  const afterAnchor = await evaluate(`document.querySelector('[data-message-key="${anchor.key}"]').getBoundingClientRect().top`);
  assert.ok(Math.abs(afterAnchor - anchor.top) < 20, `older page preserves anchor (${anchor.top} -> ${afterAnchor})`);
  checks.push("loading older messages preserves the viewport anchor");

  await evaluate(`(()=>{const h=document.querySelector('[data-testid="message-history"]');h.scrollTop=400;h.dispatchEvent(new Event('scroll'));})()`);
  await pause(120);
  const savedViewport = await evaluate(`(()=>{const h=document.querySelector('[data-testid="message-history"]');const n=Array.from(h.querySelectorAll('[data-message-key]')).find(n=>n.getBoundingClientRect().bottom>h.getBoundingClientRect().top);return {key:n.dataset.messageKey,offset:n.getBoundingClientRect().top-h.getBoundingClientRect().top};})()`);
  const readsBeforeLeaving = readCount();
  await evaluate(`document.querySelector('a[href="/messages/${secondId}"]').click()`);
  await until(() => textIncludes("Gửi lời chào đầu tiên"), "other empty conversation");
  const whileAway = message(BigInt(messages.at(-1).sequence) + 1n, "Tin mới trong lúc mình đang xem cuộc trò chuyện khác");
  messages.push(whileAway); conversation.last_message = whileAway; conversation.last_message_at = whileAway.created_at; conversation.unread_count = 1;
  emitMessage(whileAway);
  await until(() => evaluate(`document.querySelector('a[title="Tin nhắn"]')?.getAttribute('aria-label').includes('1 cuộc trò chuyện')`), "unread conversation badge while away");
  await evaluate(`document.querySelector('a[href="/messages/${conversationId}"]').click()`);
  await until(() => visible(`[data-message-key="${savedViewport.key}"]`), "cached history restored");
  await until(() => evaluate(`(()=>{const h=document.querySelector('[data-testid="message-history"]');const n=h.querySelector('[data-message-key="${savedViewport.key}"]');return n&&Math.abs(n.getBoundingClientRect().top-h.getBoundingClientRect().top-(${savedViewport.offset}))<16;})()`), "same viewport anchor restored");
  await until(() => textIncludes("Tin nhắn mới"), "new-message indicator after returning to history");
  assert.equal(readCount(), readsBeforeLeaving, "restoring old history never acknowledges the new tail");
  assert.equal(await evaluate(`document.querySelector('[data-testid="conversation-list"] a[href^="/messages/"]').getAttribute('href')`), `/messages/${conversationId}`);
  checks.push("returning to a chat restores the reading anchor, preserves unread badge and orders recent conversations without marking unseen messages read");

  readFailures = 1;
  const cursorBeforeFailure = conversation.read_state.last_read_sequence;
  await clickText("Tin nhắn mới");
  await until(() => visible('button[aria-label="Thử lại trạng thái đọc"]'), "read error is actionable");
  assert.equal(conversation.read_state.last_read_sequence, cursorBeforeFailure, "failed read keeps authoritative cursor");
  await evaluate(`(()=>{const h=document.querySelector('[data-testid="message-history"]');h.scrollTop=0;h.dispatchEvent(new Event('scroll'));})()`);
  await until(() => evaluate(`document.querySelector('button[aria-label="Thử lại trạng thái đọc"]').disabled`), "read retry disabled away from tail");
  await evaluate(`(()=>{const h=document.querySelector('[data-testid="message-history"]');h.scrollTop=h.scrollHeight;h.dispatchEvent(new Event('scroll'));})()`);
  await until(() => evaluate(`!document.querySelector('button[aria-label="Thử lại trạng thái đọc"]').disabled`), "visible read retry enabled");
  await evaluate(`document.querySelector('button[aria-label="Thử lại trạng thái đọc"]').click()`);
  await until(() => conversation.read_state.last_read_sequence === whileAway.sequence, "manual read retry commits");
  await until(() => evaluate(`document.querySelector('a[title="Tin nhắn"]').getAttribute('aria-label')==='Tin nhắn'`), "read retry clears badge from REST");
  checks.push("read failure preserves unread state; retry works only for a visible tail and clears badges after server confirmation");

  await evaluate(`window.__fixtureVisibility='hidden';document.dispatchEvent(new Event('visibilitychange'))`);
  const readsBeforeHidden = readCount();
  const hiddenMessage = message(BigInt(messages.at(-1).sequence) + BigInt(1), "Tin nhắn khi tab đang ở nền");
  messages.push(hiddenMessage); conversation.last_message = hiddenMessage; conversation.unread_count = 1; emitMessage(hiddenMessage);
  await pause(500);
  assert.equal(readCount(), readsBeforeHidden, "background tab does not advance read state");
  holdRead = true;
  await evaluate(`window.__fixtureVisibility='visible';document.dispatchEvent(new Event('visibilitychange'))`);
  await until(() => !!heldRead, "read confirmation held before policy change");
  checks.push("background tab does not mark incoming messages read");

  holdDetail = true;
  conversation.can_send = false; conversation.recipient.is_active = false;
  fixture.of("/realtime").emit("conversation:updated", { event_id: randomUUID(), conversation_id: conversationId, recipient_id: userId, reason: "policy", message_id: null });
  await until(() => heldDetails.length > 0, "policy detail request overlaps pending read response");
  holdDetail = false; holdRead = false;
  await fulfill(heldRead.requestId, heldRead.result); heldRead = null;
  await until(() => evaluate(`!document.querySelector('[data-testid="message-composer"]')||document.querySelector('[data-testid="message-composer"]').disabled`), "unavailable recipient disables sending");
  for (const response of heldDetails.splice(0)) await fulfill(response.requestId, response.result).catch(() => {}); // Read confirmation cancels this older request.
  assert.ok(await evaluate(`/không còn|không thể gửi|không khả dụng/i.test(document.body.textContent)`), "unavailable recipient explanation");
  await capture("desktop-recipient-unavailable.png");
  conversation.can_send = true; conversation.recipient.is_active = true;
  fixture.of("/realtime").emit("conversation:updated", { event_id: randomUUID(), conversation_id: conversationId, recipient_id: userId, reason: "policy", message_id: null });
  await until(() => evaluate(`!!document.querySelector('[data-testid="message-composer"]')&&!document.querySelector('[data-testid="message-composer"]').disabled`), "recipient available again");
  refuseConnection = true; fixture.of("/realtime").disconnectSockets(true);
  await until(() => evaluate(`/mất kết nối|đang kết nối|kết nối lại|kết nối trực tiếp tạm gián đoạn|ngoại tuyến/i.test(document.body.textContent)`), "connection warning");
  await capture("desktop-disconnected.png");
  refuseConnection = false;
  const beforeReconnect = connected;
  await until(() => connected > beforeReconnect, "fixture reconnect");
  checks.push("read confirmation revalidates overlapping policy changes; unavailable recipients and temporary connection errors have explicit UI states");

  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await until(() => visible('[data-testid="chat-panel"]'), "mobile chat detail");
  assert.equal(await visible('[data-testid="conversation-list"]'), false, "mobile detail hides conversation list");
  assert.equal(await visible('a[aria-label="Quay lại danh sách tin nhắn"]'), true);
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "mobile has no horizontal overflow");
  await capture("mobile-chat.png");
  await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  await until(() => evaluate(`document.documentElement.scrollWidth<=innerWidth&&Array.from(document.querySelectorAll('nav[aria-label="Điều hướng chính"] a,nav[aria-label="Điều hướng chính"] button')).filter(e=>e.getBoundingClientRect().width>0).every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})`), "320px mobile navigation and chat fit");
  await capture("mobile-320-chat.png");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 520, deviceScaleFactor: 1, mobile: true });
  await until(() => evaluate(`(()=>{const e=document.querySelector('[data-testid="message-composer"]');const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()`), "composer remains inside reduced mobile viewport");
  await capture("mobile-reduced-viewport.png");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(`document.querySelector('a[aria-label="Quay lại danh sách tin nhắn"]').click()`);
  await until(() => visible('[data-testid="conversation-list"]'), "mobile back to list");
  assert.equal(await visible('[data-testid="chat-panel"]'), false, "mobile list hides chat detail");
  await capture("mobile-conversation-list.png");
  checks.push("mobile list/detail/back flow uses separate screens without horizontal overflow");

  await evaluate(`document.querySelector('a[href="/messages/${secondId}"]').click()`);
  await until(() => visible('[data-testid="message-composer"]'), "empty conversation detail");
  await until(() => requests.some((entry) => entry.path.endsWith(`/conversations/${secondId}/messages`)), "empty history from REST");
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="message-history"] [data-message-key]').length`), 0);
  assert.equal(await evaluate(`document.querySelector('[data-testid="message-composer"]').disabled`), false);
  await capture("mobile-empty-conversation.png");
  await evaluate(`document.querySelector('a[aria-label="Quay lại danh sách tin nhắn"]').click()`);
  await until(() => visible('[data-testid="conversation-list"]'), "back from empty conversation");
  checks.push("empty conversation keeps the composer available without fabricated messages");

  await evaluate(`Array.from(document.querySelectorAll('button')).find(e=>e.getBoundingClientRect().width>0&&(e.getAttribute('aria-label')==='Cuộc trò chuyện mới'||e.textContent.includes('Cuộc trò chuyện mới'))).click()`);
  await until(() => visible('[role="dialog"]'), "new-conversation dialog");
  await evaluate(`(()=>{const d=document.querySelector('[role="dialog"]');const e=d.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'ban_dong_hanh');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await clickText("Tìm người nhận");
  await until(() => evaluate(`document.querySelector('[role="dialog"]').textContent.includes('Bạn đồng hành')`), "profile lookup through REST");
  await capture("mobile-new-conversation.png");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until(() => evaluate(`!document.querySelector('[role="dialog"]')`), "dialog closes accessibly");
  checks.push("new-conversation dialog searches real profile endpoint");

  await evaluate(`document.querySelector('a[href="/messages/${conversationId}"]').click()`);
  await until(() => visible('[data-testid="message-composer"]'), "chat actions detail");
  const unsentDraft = "Bản nháp còn giữ sau khi hủy theo dõi";
  await setComposer(unsentDraft);
  const unfollowCount = () => mutations.filter((entry) => entry.method === "DELETE" && entry.path.endsWith("/follow")).length;
  const clickActionsTrigger = async () => {
    const point = await evaluate(`(()=>{const r=document.querySelector('button[aria-label="Tùy chọn cuộc trò chuyện"]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1 });
  };
  const openActions = async () => {
    await clickActionsTrigger();
    await until(() => evaluate(`!!Array.from(document.querySelectorAll('[role=menuitem]')).find(e=>e.textContent.includes('Hủy theo dõi')&&!e.hasAttribute('data-disabled'))`), "loaded unfollow action");
  };
  await openActions();
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[role=menuitem]')).map(e=>e.textContent.trim())`), ["Mở hồ sơ", "Hủy theo dõi"]);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('[role=menuitem]')).find(e=>e.textContent.includes('Mở hồ sơ')).getAttribute('href')`), `/profile/${recipient.username}`);
  assert.equal(await evaluate("location.pathname"), `/messages/${conversationId}`, "opening the menu does not navigate");
  await capture("mobile-conversation-actions.png");
  await evaluate(`Array.from(document.querySelectorAll('[role=menuitem]')).find(e=>e.textContent.includes('Hủy theo dõi')).click()`);
  await until(() => visible('[role=dialog]'), "unfollow confirmation");
  await clickText("Quay lại");
  assert.equal(unfollowCount(), 0, "cancel makes no API mutation");
  await openActions();
  await evaluate(`Array.from(document.querySelectorAll('[role=menuitem]')).find(e=>e.textContent.includes('Hủy theo dõi')).click()`);
  await until(() => visible('[role=dialog]'), "unfollow confirmation reopened");
  await clickText("Hủy theo dõi");
  await until(() => textIncludes("Tạm thời chưa thể hủy theo dõi"), "failed unfollow feedback");
  assert.equal(await visible('[role=dialog]'), true, "failed unfollow keeps the confirmation retryable");
  assert.equal(await evaluate(`document.querySelector('[data-testid="message-composer"]').disabled`), false);
  await clickText("Hủy theo dõi");
  await until(() => evaluate(`!document.querySelector('[role=dialog]')&&document.querySelector('[data-testid="message-composer"]').disabled`), "successful unfollow disables composer");
  assert.equal(await evaluate(`document.querySelector('[data-testid="message-composer"]').value`), unsentDraft);
  assert.ok(await evaluate(`document.querySelectorAll('[data-testid="message-history"] [data-message-key]').length>0`), "unfollow preserves history");
  await capture("mobile-unfollowed-conversation.png");
  await clickActionsTrigger();
  await until(() => evaluate(`Array.from(document.querySelectorAll('[role=menuitem]')).some(e=>e.textContent.includes('Hủy theo dõi')&&e.hasAttribute('data-disabled'))`), "unfollow disabled after success");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  checks.push("conversation profile icon opens two actions; unfollow cancel/failure/retry preserve draft and history, then disable sending after success");

  conversations = [];
  await send("Page.navigate", { url: `${web}/messages` });
  await until(() => evaluate(`/chưa có cuộc trò chuyện|chưa có tin nhắn|hành trình bắt đầu từ một lời chào/i.test(document.body?.textContent??'')`), "empty conversation state");
  await capture("mobile-empty-list.png");
  conversations = [conversation, second]; listFailure = true;
  await send("Page.navigate", { url: `${web}/messages` });
  await until(() => evaluate(`/không thể tải|chưa tải được|tải.*thất bại/i.test(document.body?.textContent??'')`), "REST list error state");
  await capture("mobile-list-error.png");
  checks.push("empty lists and API errors render actionable states without mock production data");

  assert.equal(mutations.some((entry) => entry.blocked), false, "all mutations stay within explicit fixture handlers");
  assert.deepEqual(exceptions, [], "no unhandled browser runtime exceptions");
  console.log(JSON.stringify({ checks, mutations, artifacts, exceptions }, null, 2));
} catch (error) {
  try {
    await captureFailure?.();
    await writeFile(join(artifacts, "failure.json"), JSON.stringify({ message: error.stack, checks, mutations, requests: requests.slice(-25), state: await failureState?.(), exceptions }, null, 2));
  } catch { /* Preserve original failure. */ }
  console.error(`Messaging browser artifacts: ${artifacts}`);
  throw error;
} finally {
  socket?.close(); chrome.kill();
  await new Promise((done) => fixture.close(done));
  const target = resolve(profile), temp = resolve(tmpdir()) + sep;
  assert.ok(target.startsWith(temp) && basename(target).startsWith("wandermap-messaging-browser-"));
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
