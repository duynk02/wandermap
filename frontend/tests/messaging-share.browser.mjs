// Node 22+, Chrome, and `npm run build`. All REST/Socket.IO data are isolated fixtures.
// The runner starts its own Next server with a fixture SSR origin; no application DB writes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { Server } from "../../backend/node_modules/socket.io/dist/index.js";

const pause = (ms = 80) => new Promise((done) => setTimeout(done, ms));
async function until(check, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(); }
  throw new Error(`Timed out: ${label}`);
}
const profilePath = await mkdtemp(join(tmpdir(), "wandermap-share-browser-"));
const artifacts = await mkdtemp(join(tmpdir(), "wandermap-share-shots-"));
const owner = "11111111-1111-4111-8111-111111111111", recipientId = "22222222-2222-4222-8222-222222222222";
const postId = "33333333-3333-4333-8333-333333333333", locationId = "44444444-4444-4444-8444-444444444444", journeyId = "55555555-5555-4555-8555-555555555555";
const chatId = "66666666-6666-4666-8666-666666666666", blockedId = "77777777-7777-4777-8777-777777777777";
const user = { id: owner, username: "share_test", display_name: "Người khám phá", avatar_url: null, email: "fixture@example.test", bio: null, home_city: null, country_count: 0, total_posts: 1, followers_count: 0, following_count: 0, created_at: "2026-01-01T00:00:00Z" };
const recipient = { id: recipientId, username: "ban_dong_hanh", display_name: "Bạn đồng hành", avatar_url: null, is_active: true, is_following: true, follows_you: true, is_mutual: true, can_message: true };
const now = () => new Date().toISOString();
const token = `fixture.${Buffer.from(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.fixture`;
let web, activePath = "/", imageUrl, sendMode = "hold", heldSend = null, hidden = false, historyGate = false;
let heldHistory = [], socket, chrome, nextServer, nextLogs = "";
const exceptions = [], mutations = [], requests = [], checks = [], messages = [];
const location = { id: locationId, name: "Hồ Tuyền Lâm", address: "Đà Lạt, Lâm Đồng", city: "Đà Lạt", country: "Việt Nam", category: "mountain", coordinates: { lat: 11.896, lng: 108.433 }, post_count: 1, avg_rating: 5, trending_score: 0, created_at: now() };
const post = { id: postId, post_type: "location", author_id: owner, author: user, location_id: locationId, location, content: "Bình minh bên hồ — một ngày thật xanh 🌿", images: [], visibility: "public", likes_count: 0, comments_count: 0, saves_count: 0, rating: 5, visited_at: "2026-10-24", created_at: now(), is_liked: false, is_saved: false };
const journey = { id: journeyId, user_id: owner, title: "Cung đường Đà Lạt", description: "Hai điểm đến bình yên", cover_image_url: null, visibility: "public", status: "published", revision: 1, author: user, created_at: now(), updated_at: now(), style_config: { version: 1, line_color: "#22c55e", line_style: "solid", show_labels: true, show_order: true, map_style: "outdoors-v12" }, stops: [] };
const chat = { id: chatId, type: "direct", created_at: now(), updated_at: now(), last_message_at: null, recipient, can_send: true, blocked_by_me: false, read_state: { last_read_sequence: null, last_read_at: null }, recipient_read_state: { last_read_sequence: null, last_read_at: null }, unread_count: 0, last_message: null };
const blocked = { ...chat, id: blockedId, recipient: { ...recipient, id: randomUUID(), username: "inactive", display_name: "Người nhận không khả dụng", is_active: false }, can_send: false };
const contactId = "88888888-8888-4888-8888-888888888888";
const contact = { ...recipient, id: contactId, username: "ban_moi", display_name: "Bạn chưa từng chat", conversation_id: null };
let followingBack = false, relationshipTests = false;
const follower = { ...contact, id: "99999999-9999-4999-8999-999999999999", username: "minh_hai", display_name: "Minh Hải" };
let followerFollowedBack = false, followBackMode = "success";
const relation = () => ({ ...contact, is_following: followingBack, follows_you: true, is_mutual: followingBack, can_message: followingBack });
const unavailable = () => ({ available: false, id: null, title: null, image_url: null, author: null, location: null, address: null, category: null });
function project(row) {
  const base = { available: true, id: row.shared_resource_id, title: null, image_url: null, author: null, location: null, address: null, category: null };
  let resource = row.message_type === "shared_post" ? { ...base, title: post.content, image_url: imageUrl, author: user, location: { id: locationId, name: location.name } }
    : row.message_type === "shared_location" ? { ...base, title: location.name, location: { id: locationId, name: location.name }, address: location.address, category: location.category }
    : { ...base, title: journey.title, image_url: imageUrl, author: user };
  if (hidden && row.message_type === "shared_post") resource = unavailable();
  const { shared_resource_id, ...message } = row;
  return { ...message, shared_resource: resource };
}
function commit(input) {
  const existing = messages.find((row) => row.client_message_id === input.client_message_id);
  if (existing) return { message: project(existing), created: false };
  const row = { id: randomUUID(), conversation_id: chatId, sender_id: owner, sequence: String(messages.length + 1), created_at: now(), updated_at: now(), deleted_at: null, ...input };
  messages.push(row); chat.last_message_at = row.created_at; chat.last_message = project(row);
  return { message: project(row), created: true };
}
function responseFor(path, query = new URLSearchParams()) {
  if (path.endsWith("/auth/refresh")) return { accessToken: token, expiresIn: 3600 };
  if (path.endsWith("/users/me")) return user;
  if (path.endsWith(`/users/${user.username}`)) return user;
  if (path.endsWith(`/users/${user.username}/followers`)) return { data: [recipient, relation()], count: 2, page: 1, pageSize: 20, hasMore: false };
  if (path.endsWith(`/users/${user.username}/following`)) return { data: [recipient, ...(followingBack ? [relation()] : [])], count: followingBack ? 2 : 1, page: 1, pageSize: 20, hasMore: false };
  if (path.endsWith("/conversations/contacts")) {
    const data = !relationshipTests ? [] : query.get("kind") === "followers"
      ? (followerFollowedBack ? [] : [follower])
      : [{ ...recipient, conversation_id: chatId }, ...(followingBack ? [contact] : []), ...(followerFollowedBack ? [follower] : [])];
    const term = query.get("search")?.trim().toLowerCase() ?? "";
    return { data: data.filter((row) => `${row.username} ${row.display_name}`.toLowerCase().includes(term)), hasMore: false, next_page: null };
  }
  if (path.endsWith(`/users/${recipient.username}`)) return { ...user, ...recipient };
  if (path.endsWith("/notifications/unread-count")) return { count: 0 };
  if (path.endsWith("/conversations/unread-count")) return { unread_messages: 0, unread_conversations: 0 };
  if (path.endsWith("/conversations")) return { data: [chat, blocked], next_cursor: null, hasMore: false };
  if (path.endsWith(`/conversations/${chatId}/messages`)) return { data: messages.toReversed().map(project), next_cursor: null, hasMore: false };
  if (path.includes(`/conversations/${chatId}/messages/`)) { const row = messages.find((row) => row.id === path.split("/").at(-1)); return row ? project(row) : null; }
  if (path.endsWith(`/conversations/${chatId}`)) return { ...chat, last_message: messages.length ? project(messages.at(-1)) : null };
  if (path.endsWith(`/conversations/${blockedId}`)) return blocked;
  if (path.endsWith(`/locations/${locationId}`)) return location;
  if (path.endsWith("/locations/trending")) return [location];
  if (path.endsWith("/locations/in-viewport")) return [location];
  if (path.endsWith(`/posts/${postId}`)) return post;
  if (path.endsWith("/posts/feed")) return { data: [post], count: 1, hasMore: false, page: 1, pageSize: 20 };
  if (path.endsWith(`/journeys/${journeyId}`)) return journey;
  return { data: [], count: 0, hasMore: false, page: 1, pageSize: 20 };
}
const api = createServer((request, response) => {
  const path = new URL(request.url, "http://fixture.test").pathname;
  if (path === "/preview.svg") { response.writeHead(200, { "content-type": "image/svg+xml" }); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="338"><rect width="600" height="338" fill="#15803d"/><text x="32" y="180" fill="white" font-size="34">WanderMap fixture</text></svg>'); return; }
  if (request.method !== "GET") { response.writeHead(403); response.end(); return; }
  response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(responseFor(path)));
});
await new Promise((done) => api.listen(0, "127.0.0.1", done));
const apiPort = api.address().port;
imageUrl = `http://127.0.0.1:${apiPort}/preview.svg`; post.images = [imageUrl]; journey.cover_image_url = imageUrl;
const fixture = new Server(api, { cors: { origin: true } });
fixture.of("/realtime").on("connection", (client) => client.emit("notifications:status", { available: true }));
const free = createServer(); await new Promise((done) => free.listen(0, "127.0.0.1", done));
const webPort = free.address().port; await new Promise((done) => free.close(done));
web = `http://127.0.0.1:${webPort}`;
nextServer = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(webPort)], { cwd: process.cwd(), env: { ...process.env, API_INTERNAL_URL: `http://127.0.0.1:${apiPort}/api/v1` }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
nextServer.stdout.on("data", (chunk) => { nextLogs = (nextLogs + chunk).slice(-12000); }); nextServer.stderr.on("data", (chunk) => { nextLogs = (nextLogs + chunk).slice(-12000); });
let evaluate, send, capture;
try {
  await until(async () => { try { return (await fetch(`${web}/feed`)).status === 200; } catch { return false; } }, "isolated Next production server");
  chrome = spawn(process.env.WANDERMAP_BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--enable-unsafe-swiftshader", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--remote-debugging-port=0", `--user-data-dir=${profilePath}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank"], { windowsHide: true, stdio: "ignore" });
  let port; await until(async () => { try { port = (await readFile(join(profilePath, "DevToolsActivePort"), "utf8")).split("\n")[0]; return !!port; } catch { return false; } }, "Chrome CDP");
  const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let serial = 0; const pending = new Map();
  send = (method, params = {}) => new Promise((done, reject) => { const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000); pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  const fulfill = (requestId, result, status = 200) => send("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(result)).toString("base64") });
  const emit = (row) => {
    const payload = { event_id: randomUUID(), conversation_id: chatId, recipient_id: owner, message_id: row.id, sender_id: row.sender_id, client_message_id: row.client_message_id, message_type: row.message_type, sequence: row.sequence, created_at: row.created_at };
    fixture.of("/realtime").emit("message:new", payload); fixture.of("/realtime").emit("message:new", payload);
    fixture.of("/realtime").emit("conversation:updated", { event_id: randomUUID(), conversation_id: chatId, recipient_id: owner, reason: "message", message_id: row.id });
  };
  async function intercept({ requestId, request }) {
    const url = new URL(request.url), path = url.pathname, method = request.method, input = request.postData ? JSON.parse(request.postData) : null;
    requests.push({ path, method, query: url.search });
    if (path.endsWith(`/users/${contact.username}/follow`) && method === "POST") { followingBack = true; await fulfill(requestId, { following: true, changed: true }, 201); return; }
    if (path.endsWith(`/users/${follower.username}/follow`) && method === "POST") {
      if (followBackMode === "error") { await fulfill(requestId, { message: "Chưa thể theo dõi lại. Vui lòng thử lại." }, 503); return; }
      followerFollowedBack = true; await fulfill(requestId, { following: true, changed: true }, 201); return;
    }
    if (path.endsWith(`/conversations/${chatId}/messages`) && method === "POST") {
      mutations.push({ path, method, input });
      assert.deepEqual(Object.keys(input).sort(), ["client_message_id", "content", "message_type", "shared_resource_id"]);
      if (sendMode === "hold") { heldSend = { requestId, input }; return; }
      if (sendMode === "lost-ack") { commit(input); sendMode = "success"; await fulfill(requestId, { message: "Kết nối tạm gián đoạn sau khi gửi." }, 503); return; }
      if (sendMode === "forbidden") { await fulfill(requestId, { message: "Nội dung chia sẻ không khả dụng cho những người trong cuộc trò chuyện." }, 404); return; }
      const result = commit(input); emit(result.message); await fulfill(requestId, result, 201); return;
    }
    if (path.endsWith("/conversations/direct") && method === "POST") { mutations.push({ path, method, input }); await fulfill(requestId, { conversation: chat, created: false }, 201); return; }
    if (path.endsWith(`/conversations/${chatId}/read`) && method === "PATCH") { mutations.push({ path, method, input }); chat.read_state = { last_read_sequence: input.last_read_sequence, last_read_at: now() }; await fulfill(requestId, { conversation_id: chatId, ...chat.read_state, unread_count: 0 }); return; }
    if (path.endsWith(`/conversations/${chatId}/messages`) && method === "GET" && historyGate) { heldHistory.push(requestId); return; }
    if (!["GET", "POST"].includes(method) || (method === "POST" && !path.endsWith("/auth/refresh"))) throw new Error(`Unexpected fixture mutation ${method} ${path}`);
    const result = responseFor(path, url.searchParams); await fulfill(requestId, result ?? { message: "Không tìm thấy" }, result ? 200 : 404);
  }
  socket.addEventListener("message", ({ data }) => {
    const response = JSON.parse(data);
    if (response.method === "Page.frameNavigated" && !response.params.frame.parentId) activePath = new URL(response.params.frame.url).pathname;
    if (response.method === "Page.navigatedWithinDocument") activePath = new URL(response.params.url).pathname;
    if (response.method === "Runtime.exceptionThrown") exceptions.push(`${activePath}: ${response.params.exceptionDetails.exception?.description ?? response.params.exceptionDetails.text}`);
    if (response.method === "Fetch.requestPaused") void intercept(response.params).catch((error) => { if (!error.message.includes("Invalid InterceptionId")) exceptions.push(error.stack); });
    const entry = pending.get(response.id); if (entry) { pending.delete(response.id); clearTimeout(entry.timer); response.error ? entry.reject(new Error(response.error.message)) : entry.done(response.result); }
  });
  evaluate = async (expression) => { const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
  capture = async (name) => { const shot = await send("Page.captureScreenshot", { format: "png" }); await writeFile(join(artifacts, name), Buffer.from(shot.data, "base64")); };
  const navigate = async (path) => { activePath = path; await send("Page.navigate", { url: web + path }); await send("Page.bringToFront"); };
  const visible = (selector) => evaluate(`!!document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect().width`);
  const click = (text, scope = "document") => evaluate(`(()=>{const e=Array.from(${scope}.querySelectorAll('button,a')).find(e=>e.getBoundingClientRect().width>0&&e.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error('Missing action: '+${JSON.stringify(text)});e.click();})()`);
  const dialog = "document.querySelector('[data-testid=share-content-dialog]')";
  const input = async (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const openShare = async (label) => { await until(() => visible(`button[aria-label="${label}"]:not(:disabled)`), "share entrypoint"); await evaluate(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`); await until(() => visible('[data-testid="share-content-dialog"]'), "share dialog"); };
  const choose = async () => { await until(() => evaluate(`!!Array.from(${dialog}.querySelectorAll('button')).find(e=>e.textContent.includes('Bạn đồng hành'))`), "recent conversation"); await evaluate(`Array.from(${dialog}.querySelectorAll('button')).find(e=>e.textContent.includes('Bạn đồng hành')).click()`); };
  const sent = () => evaluate(`${dialog}?.textContent.includes('Đã gửi cho')`);
  const bubbleCount = () => evaluate(`document.querySelectorAll('[data-message-key]').length`);
  await send("Page.enable"); await send("Runtime.enable"); await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/v1/*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `if(location.origin===${JSON.stringify(web)})localStorage.setItem('wandermap-auth',JSON.stringify({state:{profile:${JSON.stringify(user)}},version:0}));const Native=window.WebSocket;window.WebSocket=class extends Native{constructor(url,protocols){const target=new URL(url);if(target.pathname.startsWith('/socket.io')){target.hostname='127.0.0.1';target.port='${apiPort}';}super(target.toString(),protocols);}};` });
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate("/feed"); await openShare("Chia sẻ bài viết qua tin nhắn"); await choose();
  assert.equal(await evaluate(`${dialog}.querySelector('button[aria-pressed][disabled]')?.textContent.includes('khả dụng')`), true);
  const caption = "Cùng đón bình minh ở đây nhé 🌿";
  await input("#share-caption", caption); await click("Gửi", dialog);
  await until(() => heldSend !== null, "pending share REST request");
  const first = heldSend; assert.equal(first.input.message_type, "shared_post"); assert.equal(first.input.content, caption);
  assert.equal(await evaluate(`${dialog}.querySelector('button[aria-label="Đóng chia sẻ"]').disabled`), true);
  const firstResult = commit(first.input); emit(firstResult.message); await fulfill(first.requestId, firstResult, 201); heldSend = null; sendMode = "success";
  await until(sent, "share confirmed by server"); assert.equal(await evaluate("location.pathname"), "/feed");
  await capture("desktop-share-dialog.png"); await click("Mở cuộc trò chuyện", dialog);
  await until(() => visible('[data-testid="message-history"] [data-shared-type="shared_post"]'), "shared post card"); assert.equal(await bubbleCount(), 1);
  assert.equal(await evaluate(`document.querySelector('[data-shared-type=shared_post] img').getAttribute('src')`), imageUrl);
  assert.ok(await evaluate(`document.querySelector('[data-shared-type=shared_post]').textContent.includes('Người khám phá')&&document.querySelector('[data-shared-type=shared_post]').textContent.includes('Hồ Tuyền Lâm')`));
  await capture("desktop-shared-post.png"); checks.push("post sharing stays on Feed, waits for REST, ignores duplicate socket delivery and renders authoritative card");

  await navigate(`/post/${postId}`); await openShare("Chia sẻ bài viết qua tin nhắn");
  assert.equal(await evaluate("location.pathname"), `/post/${postId}`);
  await evaluate(`${dialog}.querySelector('button[aria-label="Đóng chia sẻ"]').click()`);
  checks.push("Post Detail exposes the same share action without navigating away");

  await navigate("/feed"); await openShare("Chia sẻ bài viết qua tin nhắn"); await choose(); await input("#share-caption", "Thử lại sau khi mất phản hồi"); sendMode = "lost-ack";
  await click("Gửi", dialog); await until(() => evaluate(`${dialog}.textContent.includes('Kết nối tạm gián đoạn')`), "failed share");
  const failed = mutations.at(-1); assert.equal(await evaluate("document.querySelector('#share-caption').value"), "Thử lại sau khi mất phản hồi");
  await click("Thử gửi lại", dialog); await until(sent, "idempotent retry"); assert.deepEqual(mutations.at(-1).input, failed.input); assert.equal(messages.length, 2);
  await click("Xong", dialog); checks.push("ambiguous failure keeps caption and retry body/key; a committed share is never inserted twice");

  await openShare("Chia sẻ bài viết qua tin nhắn"); await input("#share-recipient-search", "ban_dong_hanh"); await evaluate(`${dialog}.querySelector('button[aria-label="Tìm tên người dùng"]').click()`);
  await until(() => evaluate(`${dialog}.querySelector('form').nextElementSibling?.tagName==='BUTTON'&&${dialog}.querySelector('form').nextElementSibling.textContent.includes('Bạn đồng hành')`), "username lookup");
  await evaluate(`${dialog}.querySelector('form').nextElementSibling.click()`);
  await click("Gửi", dialog); await until(sent, "new recipient/direct conversation"); assert.ok(mutations.some((row) => row.path.endsWith("/direct") && row.input.recipient_id === recipientId));
  await click("Xong", dialog); checks.push("lookup selects an exact username and creates/resolves the direct conversation through REST");

  await navigate(`/messages/${chatId}`); await until(() => visible('[data-shared-type="shared_post"]'), "cached shared cards");
  hidden = true; historyGate = true; await evaluate("document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('visibilitychange'))");
  await until(() => heldHistory.length > 0, "authoritative history recheck");
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('[data-testid=shared-content-card]')).some(e=>e.querySelector('img')||e.textContent.includes('Bình minh bên hồ'))`), false, "old cached previews hidden while permissions are being verified");
  historyGate = false; for (const requestId of heldHistory.splice(0)) {
    try { await fulfill(requestId, responseFor(`/api/v1/conversations/${chatId}/messages`)); }
    catch (error) { if (!error.message.includes("Invalid InterceptionId")) throw error; }
  }
  await until(() => visible('[data-testid="shared-content-unavailable"]'), "unavailable cards after privacy change");
  assert.equal(await evaluate(`!!document.querySelector('[data-testid=shared-content-unavailable] a, [data-testid=shared-content-unavailable] img')`), false);
  await capture("desktop-content-unavailable.png"); checks.push("permission recheck hides stale metadata and unavailable cards contain no image, private title or link"); hidden = false;

  await navigate(`/location/${locationId}`); await openShare("Chia sẻ địa điểm qua tin nhắn"); await choose(); await click("Gửi", dialog); await until(sent, "location share");
  assert.equal(mutations.filter((row) => row.method === "POST" && row.path.endsWith("/messages")).at(-1).input.message_type, "shared_location");
  await click("Mở cuộc trò chuyện", dialog); await until(() => visible('[data-testid="message-history"] [data-shared-type="shared_location"]'), "location card");
  await until(() => evaluate(`(()=>{const e=document.querySelector('[data-testid=message-history]');return e.scrollHeight-e.scrollTop-e.clientHeight<8;})()`), "latest card remains at the bottom after preview image layout");
  assert.ok(await evaluate(`document.querySelector('[data-shared-type=shared_location]').textContent.includes('Đà Lạt, Lâm Đồng')&&document.querySelector('[data-shared-type=shared_location]').textContent.includes('Núi')`));
  await capture("desktop-shared-location.png"); await click("Xem trên bản đồ"); await until(() => evaluate("location.pathname==='/explore'"), "internal map navigation");
  await openShare("Chia sẻ địa điểm qua tin nhắn");
  assert.equal(await evaluate("location.pathname"), "/explore");
  await evaluate(`${dialog}.querySelector('button[aria-label="Đóng chia sẻ"]').click()`);
  checks.push("Location Detail shares a canonical reference and the location card opens WanderMap's map using REST coordinates");

  await navigate(`/journey/${journeyId}`); await openShare("Chia sẻ hành trình qua tin nhắn"); await choose(); await click("Gửi", dialog); await until(sent, "journey share");
  assert.equal(mutations.filter((row) => row.method === "POST" && row.path.endsWith("/messages")).at(-1).input.message_type, "shared_journey");
  await click("Mở cuộc trò chuyện", dialog); await until(() => visible('[data-testid="message-history"] [data-shared-type="shared_journey"]'), "journey card");
  assert.equal(await evaluate(`document.querySelector('[data-shared-type=shared_journey] a').getAttribute('href')`), `/journey/${journeyId}`);
  journey.visibility = "private"; await navigate(`/journey/${journeyId}`); await openShare("Chia sẻ hành trình qua tin nhắn");
  await until(() => evaluate(`${dialog}.textContent.includes('Hãy xuất bản hành trình công khai')`), "private journey restriction");
  assert.equal(await evaluate(`Array.from(${dialog}.querySelectorAll('button')).find(e=>e.textContent.trim()==='Gửi').disabled`), true);
  await evaluate(`${dialog}.querySelector('button[aria-label="Đóng chia sẻ"]').click()`); journey.visibility = "public";
  checks.push("published public journeys share through the same dialog; private journeys cannot be sent");

  post.visibility = "followers"; await navigate("/feed"); await openShare("Chia sẻ bài viết qua tin nhắn"); await choose(); sendMode = "forbidden";
  await click("Gửi", dialog); await until(() => evaluate(`${dialog}.textContent.includes('không khả dụng cho những người')`), "backend permission rejection");
  assert.equal(await evaluate(`${dialog}.textContent.includes('Đã gửi cho')`), false);
  await capture("desktop-share-permission-error.png"); await evaluate(`${dialog}.querySelector('button[aria-label="Đóng chia sẻ"]').click()`); sendMode = "success";
  post.visibility = "private"; await navigate("/feed"); await openShare("Chia sẻ bài viết qua tin nhắn");
  assert.ok(await evaluate(`${dialog}.textContent.includes('Bài viết riêng tư')`));
  await evaluate(`${dialog}.querySelector('button[aria-label="Đóng chia sẻ"]').click()`); post.visibility = "public";
  checks.push("followers-only sends honor backend rejection and private-post source state disables sending");

  await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  await navigate("/feed"); await openShare("Chia sẻ bài viết qua tin nhắn"); await choose();
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
  assert.ok(await evaluate(`${dialog}.getBoundingClientRect().width<=innerWidth&&${dialog}.getBoundingClientRect().height<=innerHeight`));
  await capture("mobile-share-dialog.png"); await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await capture("mobile-share-dark.png"); checks.push("Share Dialog remains usable at 320px and in dark theme with footer outside the scrolling body");
  await evaluate(`${dialog}.querySelector('button[aria-label="Đóng chia sẻ"]').click()`);

  relationshipTests = true;
  await navigate(`/profile/${user.username}`);
  await until(() => evaluate("Array.from(document.querySelectorAll('button')).some(e=>e.textContent.includes('Chỉnh sửa hồ sơ'))"), "profile session restored");
  await until(() => evaluate("Array.from(document.querySelectorAll('button')).some(e=>e.textContent.includes('người theo dõi'))"), "profile follow counters");
  await evaluate("Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('người theo dõi')).click()");
  await until(() => evaluate("document.querySelector('[role=dialog]')?.textContent.includes('Theo dõi lại')"), "followers list follow-back action");
  assert.equal(await visible('button[aria-label="Nhắn tin cho Bạn đồng hành"]'), true);
  assert.equal(await visible('button[aria-label="Nhắn tin cho Bạn chưa từng chat"]'), false);
  await click("Theo dõi lại", "document.querySelector('[role=dialog]')");
  await until(() => visible('button[aria-label="Nhắn tin cho Bạn chưa từng chat"]'), "message action after follow back");
  await capture("mobile-profile-followers.png");
  await evaluate("document.querySelector('button[aria-label=\"Nhắn tin cho Bạn chưa từng chat\"]').click()");
  await until(() => evaluate(`location.pathname==='/messages/${chatId}'`), "follower messaging navigation");
  checks.push("profile followers distinguish mutuals from follow-back; following back enables REST messaging and navigation");
  await navigate(`/profile/${user.username}`);
  await until(() => evaluate("Array.from(document.querySelectorAll('button')).some(e=>e.textContent.includes('Chỉnh sửa hồ sơ'))"), "following profile session restored");
  await until(() => evaluate("Array.from(document.querySelectorAll('button')).some(e=>e.textContent.includes('đang theo dõi'))"), "following counter");
  await evaluate("Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('đang theo dõi')).click()");
  await until(() => visible('button[aria-label="Nhắn tin cho Bạn đồng hành"]'), "following list messaging action");
  await evaluate("document.querySelector('button[aria-label=\"Đóng danh sách\"]').click()");
  checks.push("profile following counter opens the actual list with message actions");
  const directBefore = mutations.filter((row) => row.path.endsWith('/direct')).length;
  await navigate("/messages");
  await until(() => evaluate("document.querySelector('section[aria-label=\"Bạn bè\"]')?.textContent.includes('Bạn chưa từng chat')"), "friend without messages");
  assert.equal(mutations.filter((row) => row.path.endsWith('/direct')).length, directBefore);
  assert.ok(await evaluate("document.querySelector('section[aria-label=\"Bạn bè\"]').textContent.includes('Bạn đồng hành')"), "friends also include contacts with an existing conversation");
  assert.equal(await evaluate("document.body.textContent.includes('Bạn theo dõi qua lại')"), false);
  await capture("mobile-mutual-contacts.png");
  const followerSection = "document.querySelector('section[aria-label=\"Người theo dõi bạn\"]')";
  await until(() => visible('button[aria-label="Theo dõi lại Minh Hải"]:not(:disabled)'), "incoming follower action");
  assert.equal(await evaluate("document.querySelector('section[aria-label=\"Bạn bè\"]').textContent.includes('Minh Hải')"), false);
  await capture("mobile-friends-and-followers.png");
  await evaluate(`${followerSection}.querySelector('button[aria-expanded]').click()`);
  assert.equal(await evaluate(`${followerSection}.querySelector('button[aria-expanded]').getAttribute('aria-expanded')`), "false");
  assert.equal(await visible('button[aria-label="Theo dõi lại Minh Hải"]'), false);
  await capture("mobile-followers-collapsed.png");
  await evaluate(`${followerSection}.querySelector('button[aria-expanded]').click()`);
  await until(() => visible('button[aria-label="Theo dõi lại Minh Hải"]:not(:disabled)'), "expanded followers");
  followBackMode = "error";
  await evaluate("document.querySelector('button[aria-label=\"Theo dõi lại Minh Hải\"]').click()");
  await until(() => evaluate(`${followerSection}.querySelector('[role=alert]')?.textContent.includes('Chưa thể theo dõi lại')`), "follow-back failure");
  assert.equal(await evaluate("document.querySelector('section[aria-label=\"Bạn bè\"]').textContent.includes('Minh Hải')"), false);
  followBackMode = "success";
  await evaluate("document.querySelector('button[aria-label=\"Theo dõi lại Minh Hải\"]').click()");
  await until(() => evaluate("document.querySelector('section[aria-label=\"Bạn bè\"]').textContent.includes('Minh Hải')"), "followed contact promoted to friends");
  assert.equal(await visible('button[aria-label="Theo dõi lại Minh Hải"]'), false);
  assert.equal(mutations.filter((row) => row.path.endsWith('/direct')).length, directBefore);
  assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"));
  checks.push("friends include all mutuals; incoming followers can collapse/expand and failed follow-back stays retryable before successful promotion without creating a conversation");
  await evaluate("Array.from(document.querySelector('section[aria-label=\"Bạn bè\"]').querySelectorAll('button')).find(e=>e.textContent.includes('Bạn chưa từng chat')).click()");
  await until(() => evaluate(`location.pathname==='/messages/${chatId}'`), "new contact opens chat");
  assert.ok(mutations.some((row) => row.path.endsWith('/direct') && row.input.recipient_id === contactId));
  checks.push("messaging lists mutual contacts with no history, creates no empty chats on load, and opens one through REST on selection");
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ checks, messageCount: messages.length, mutations, artifacts, exceptions }, null, 2));
} catch (error) {
  try { await capture?.("failure.png"); await writeFile(join(artifacts, "failure.json"), JSON.stringify({ error: error.stack, checks, requests: requests.slice(-25), mutations, exceptions, nextLogs, text: await evaluate?.("document.body?.innerText") }, null, 2)); } catch { /* Keep original failure. */ }
  console.error(`Share browser artifacts: ${artifacts}`); throw error;
} finally {
  socket?.close(); chrome?.kill(); nextServer?.kill();
  await new Promise((done) => fixture.close(done));
  const target = resolve(profilePath), root = resolve(tmpdir()) + sep;
  assert.ok(target.startsWith(root) && basename(target).startsWith("wandermap-share-browser-"));
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
