// Node 22+, Chrome and a local production Next server. REST and Socket.IO are fixtures; no database writes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { Server } from "../../backend/node_modules/socket.io/dist/index.js";

const web = process.env.WANDERMAP_TEST_WEB_URL;
assert.ok(web && ["localhost", "127.0.0.1"].includes(new URL(web).hostname), "Explicit local web URL required");
const profile = await mkdtemp(join(tmpdir(), "wandermap-notifications-browser-"));
const artifacts = await mkdtemp(join(tmpdir(), "wandermap-notifications-shots-"));
const userId = "11111111-1111-4111-8111-111111111111";
const postId = "22222222-2222-4222-8222-222222222222";
const actor = { id: "33333333-3333-4333-8333-333333333333", username: "ban_dong_hanh", display_name: "Bạn đồng hành", avatar_url: null };
const user = { id: userId, username: "notification_test", display_name: "Người khám phá", email: "fixture@example.test", avatar_url: null, bio: null, home_city: null, country_count: 0, total_posts: 0, followers_count: 0, following_count: 0, created_at: "2026-01-01T00:00:00Z" };
const accessToken = `fixture.${Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 900 })).toString("base64url")}.fixture`;
let unread = 0, items = [], connected = 0;
let refreshFailures = 2;
const mutations = [], exceptions = [], checks = [];
const fixtureHttp = createServer();
const fixture = new Server(fixtureHttp, { cors: { origin: new URL(web).origin } });
fixture.of("/realtime").on("connection", (client) => {
  connected += 1;
  client.emit("notifications:status", { available: true });
});
await new Promise((done) => fixtureHttp.listen(0, "127.0.0.1", done));
const fixturePort = fixtureHttp.address().port;
const chrome = spawn(process.env.WANDERMAP_BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank",
], { windowsHide: true, stdio: "ignore" });
const pause = (ms = 100) => new Promise((done) => setTimeout(done, ms));
async function until(check, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(); }
  throw new Error(`Timed out: ${label}`);
}
let socket;
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
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const path = new URL(request.url).pathname;
      let responseCode = 200;
      let result = { data: [], count: 0, hasMore: false, page: 1, pageSize: 20 };
      if (path.endsWith("/auth/refresh")) {
        if (refreshFailures-- > 0) { responseCode = 503; result = { message: "Temporary test outage" }; }
        else result = { accessToken, expiresIn: 900 };
      }
      else if (path.endsWith("/users/me")) result = user;
      else if (path.endsWith("/notifications/unread-count")) result = { count: unread };
      else if (path.endsWith("/notifications/read-all") && request.method === "POST") {
        mutations.push(`${request.method} ${path}`);
        const updated = unread;
        unread = 0;
        items = items.map((item) => ({ ...item, is_unread: false }));
        result = { updated };
      } else if (path.endsWith("/notifications")) result = { ...result, data: items, count: items.length };
      else if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        mutations.push(`BLOCKED ${request.method} ${path}`);
        responseCode = 403;
      }
      void send("Fetch.fulfillRequest", { requestId, responseCode, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(result)).toString("base64") }).catch((error) => {
        if (!error.message.includes("Invalid InterceptionId")) exceptions.push(error.message);
      });
    }
    const entry = pending.get(message.id);
    if (entry) { pending.delete(message.id); clearTimeout(entry.timer); message.error ? entry.reject(new Error(message.error.message)) : entry.done(message.result); }
  });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  };
  const bell = `Array.from(document.querySelectorAll('button[aria-haspopup="dialog"]')).find(e=>e.getBoundingClientRect().width>0&&e.getAttribute('aria-label')?.startsWith('Thông báo'))`;
  const badge = (count) => evaluate(`(${bell})?.getAttribute('aria-label')===${JSON.stringify(count ? `Thông báo, ${count} chưa đọc` : "Thông báo")}`);
  const capture = async (name) => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(artifacts, name), Buffer.from(shot.data, "base64"));
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/v1/*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    if(location.origin===${JSON.stringify(new URL(web).origin)})localStorage.setItem('wandermap-auth',JSON.stringify({state:{profile:${JSON.stringify(user)}},version:0}));
    const NativeWebSocket=window.WebSocket;
    window.WebSocket=class extends NativeWebSocket{constructor(url,protocols){const target=new URL(url);if(target.pathname.startsWith('/socket.io')){target.hostname='127.0.0.1';target.port=${JSON.stringify(String(fixturePort))};}super(target.toString(),protocols);}};
  ` });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${web}/feed` });
  await until(() => badge(0), "authenticated notification bell");
  await until(() => connected > 0, "fixture Socket.IO connection");
  checks.push("reload session restoration survives two temporary refresh outages without login");
  await evaluate(`window.__notificationSmokeNonce='same-document'`);
  unread = 2;
  items = [{ id: `like:${postId}`, type: "like", actors: [actor], actor_count: 2, post: { id: postId, excerpt: "Một hành trình đáng nhớ", image: null }, is_unread: true, created_at: new Date().toISOString() }];
  fixture.of("/realtime").emit("notification:changed", { notification_id: "44444444-4444-4444-8444-444444444444", recipient_id: userId, type: "like", change: "created" });
  await until(() => badge(2), "realtime bell count");
  assert.equal(await evaluate("location.pathname"), "/feed");
  assert.equal(await evaluate("window.__notificationSmokeNonce"), "same-document");
  checks.push("notification event updates badge without reload or navigation");
  await evaluate(`(${bell}).click()`);
  await until(() => evaluate(`!!document.querySelector('[role="dialog"] li a.border-brand-500')`), "unread popover row");
  assert.equal(mutations.length, 0, "opening the popover must not mark notifications read");
  await capture("desktop-unread.png");
  checks.push("popover shows unread highlight without automatic read mutation");
  for (const [type, text, id] of [
    ["comment_like", "đã thích bình luận của bạn", "55555555-5555-4555-8555-555555555555"],
    ["reply", "đã trả lời bình luận của bạn", "66666666-6666-4666-8666-666666666666"],
  ]) {
    unread += 1;
    items.unshift({ id, type, actors: [actor], actor_count: 1, post: { id: postId, excerpt: "Một hành trình đáng nhớ", image: null }, is_unread: true, created_at: new Date().toISOString() });
    const event = { notification_id: id, recipient_id: userId, type, change: "created" };
    fixture.of("/realtime").emit("notification:changed", event);
    fixture.of("/realtime").emit("notification:changed", event);
    await until(() => evaluate(`Array.from(document.querySelectorAll('[role="dialog"] li a')).some(e=>e.textContent.includes(${JSON.stringify(text)})&&e.getAttribute('href')==='/post/${postId}')`), `${type} notification text and target`);
    await until(() => badge(unread), `${type} authoritative badge without duplicate increments`);
  }
  assert.equal(await evaluate("location.pathname"), "/feed");
  assert.equal(mutations.length, 0);
  checks.push("comment likes and replies render Vietnamese messages and post targets with deduplicated realtime counts");
  await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(e=>e.textContent.includes('Đánh dấu tất cả đã đọc')).click()`);
  await until(() => badge(0), "authoritative zero unread badge after REST mark-all");
  assert.deepEqual(mutations, ["POST /api/v1/notifications/read-all"]);
  checks.push("mark-all uses REST and refreshes the authoritative unread count");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await until(() => evaluate(`(()=>{const d=document.querySelector('[role="dialog"]');if(!d)return false;const r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth;})()`), "mobile popover within viewport");
  await capture("mobile-read.png");
  checks.push("mobile 390px popover fits without horizontal overflow");
  // No event is sent for these server changes: reconnect must reconcile via REST.
  const beforeReconnect = connected;
  unread = 7;
  fixture.of("/realtime").disconnectSockets(true);
  await until(() => connected > beforeReconnect, "reconnect after backend shutdown");
  await until(() => badge(7), "REST reconciliation of missed notifications");
  assert.equal(await evaluate("window.__notificationSmokeNonce"), "same-document");
  checks.push("server disconnect reconnects and reconciles missed unread state without reload");
  const beforeNetworkDrop = connected;
  unread = 9;
  for (const client of fixture.of("/realtime").sockets.values()) client.conn.close();
  await until(() => connected > beforeNetworkDrop, "Manager reconnect after transport loss");
  await until(() => badge(9), "missed state after network transport loss");
  checks.push("transport loss uses Manager reconnect and reconciles missed notifications");
  unread = 11;
  await pause(150);
  await evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  await until(() => badge(11), "foreground REST reconciliation without socket event");
  checks.push("foreground reconciles server state without requiring an event");
  await evaluate("new BroadcastChannel('wandermap-session').postMessage('signed-out')");
  await until(() => evaluate(`!(${bell}) || !document.body.textContent.includes('Người khám phá')`), "cross-tab session invalidation");
  await until(() => fixture.of("/realtime").sockets.size === 0, "logout stops all local reconnects");
  checks.push("cross-tab logout signal disconnects authenticated socket");
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ checks, mutations, artifacts, exceptions }, null, 2));
} finally {
  socket?.close();
  chrome.kill();
  await new Promise((done) => fixture.close(done));
  const target = resolve(profile), temp = resolve(tmpdir()) + sep;
  assert.ok(target.startsWith(temp) && basename(target).startsWith("wandermap-notifications-browser-"));
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
