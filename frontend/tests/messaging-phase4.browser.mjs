// Node 22+, Chrome, built frontend/backend, and an explicitly supplied EMPTY local *_test DB.
// Real REST, cookies, Socket.IO, DB triggers and LISTEN/NOTIFY. No API/socket fixtures.
// The DB remains available for inspection; the runner never drops tables or databases.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request as proxyRequest } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

const require = createRequire(new URL("../../backend/package.json", import.meta.url));
const { Client } = require("pg");
const databaseUrl = process.env.WANDERMAP_TEST_DATABASE_URL;
assert.ok(databaseUrl, "WANDERMAP_TEST_DATABASE_URL must explicitly name an empty disposable DB");
const database = new URL(databaseUrl);
assert.ok(["127.0.0.1", "localhost"].includes(database.hostname) && /_test$/.test(database.pathname), "Only a local *_test database is accepted");
const root = resolve(import.meta.dirname, "../..");
const frontend = join(root, "frontend"), backend = join(root, "backend");
const profile = await mkdtemp(join(tmpdir(), "wandermap-phase4-browser-"));
const artifacts = await mkdtemp(join(tmpdir(), "wandermap-phase4-shots-"));
const children = [], checks = [], errors = [], pages = [];
const pause = (ms = 100) => new Promise((done) => setTimeout(done, ms));
async function until(check, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(); }
  throw new Error(`Timed out: ${label}`);
}
async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
function start(args, cwd, env = {}) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  // Keep process output private: auth/DB environment and response headers are never logged.
  child.stdout.resume(); child.stderr.resume();
  return child;
}
async function completed(child) {
  assert.equal(await new Promise((done) => child.once("exit", done)), 0, "Child command failed");
}
const db = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
let gateway, socket;
try {
  await db.connect();
  const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys'");
  assert.deepEqual(tables.rows, [], "Refusing a populated DB: supply a NEW empty *_test database for each run");
  await completed(start(["dist/database/migrate.js"], backend, { DATABASE_URL: databaseUrl }));
  const apiPort = await freePort(), webPort = await freePort();
  gateway = createServer((incoming, outgoing) => {
    const isApi = incoming.url.startsWith("/api/v1/") || incoming.url.startsWith("/uploads/");
    const port = isApi ? apiPort : webPort;
    const upstream = proxyRequest({ hostname: "127.0.0.1", port, path: incoming.url, method: incoming.method, headers: { ...incoming.headers, host: `127.0.0.1:${port}` } }, (response) => {
      outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing);
    });
    upstream.on("error", () => { outgoing.writeHead(502); outgoing.end("Test upstream unavailable"); });
    incoming.pipe(upstream);
  });
  await new Promise((done) => gateway.listen(0, "127.0.0.1", done));
  const web = `http://127.0.0.1:${gateway.address().port}`;
  const api = `http://127.0.0.1:${apiPort}/api/v1`;
  const apiProcess = start(["dist/main.js"], backend, {
    NODE_ENV: "test", PORT: String(apiPort), DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: randomBytes(48).toString("hex"), COOKIE_SECURE: "false", COOKIE_SAME_SITE: "lax",
    CORS_ORIGINS: web, UPLOAD_DIR: join(profile, "uploads"), UPLOAD_PUBLIC_URL: `http://127.0.0.1:${apiPort}/uploads`,
  });
  await until(async () => { assert.equal(apiProcess.exitCode, null, "Backend exited at startup"); try { return (await fetch(`${api}/health`)).ok; } catch { return false; } }, "real backend startup");
  start(["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(webPort)], frontend, { API_INTERNAL_URL: api });
  await until(async () => { try { return (await fetch(`${web}/auth/login`)).ok; } catch { return false; } }, "Next production server");

  async function rest(path, token, method = "GET", body, expected) {
    const response = await fetch(`${api}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    assert.ok(expected ? response.status === expected : response.ok, `${method} ${path}: status ${response.status}`);
    return response.json();
  }
  const password = randomBytes(18).toString("hex");
  const users = [];
  for (const [username, display_name] of [["phase4_an", "An du lịch"], ["phase4_binh", "Bình khám phá"], ["phase4_chi", "Chi ghé thăm"]]) {
    const email = `${username}@example.test`;
    const registered = await rest("/auth/register", null, "POST", { username, display_name, email, password });
    users.push({ ...registered, email, username, display_name });
  }
  const [an, binh, chi] = users;
  await rest(`/users/${binh.username}/follow`, an.accessToken, "POST");
  await rest(`/users/${an.username}/follow`, binh.accessToken, "POST");

  const chrome = spawn(process.env.WANDERMAP_BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--remote-debugging-port=0", `--user-data-dir=${join(profile, "chrome")}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  children.push(chrome);
  let debug;
  await until(async () => { try { debug = (await readFile(join(profile, "chrome/DevToolsActivePort"), "utf8")).trim().split("\n"); return !!debug[1]; } catch { return false; } }, "Chrome startup");
  socket = new WebSocket(`ws://127.0.0.1:${debug[0]}${debug[1]}`);
  await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const pending = new Map();
  let nextId = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") errors.push({ session: message.sessionId, error: message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text });
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const url = new URL(request.url);
      const allowed = !url.pathname.startsWith("/api/v1/") || [web, new URL(api).origin].includes(url.origin);
      if (!allowed) errors.push({ session: message.sessionId, error: "Refused API request outside this runner's isolated servers" });
      void send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", { requestId, ...(!allowed ? { errorReason: "BlockedByClient" } : {}) }, message.sessionId).catch(() => {});
    }
    const entry = pending.get(message.id);
    if (entry) { pending.delete(message.id); clearTimeout(entry.timer); message.error ? entry.reject(new Error(message.error.message)) : entry.done(message.result); }
  });
  const send = (method, params = {}, sessionId) => new Promise((done, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { done, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  async function newPage(name, mobile = false, browserContextId) {
    const context = browserContextId ?? (await send("Target.createBrowserContext")).browserContextId;
    const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId: context });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const call = (method, params) => send(method, params, sessionId);
    const evaluate = async (expression) => {
      const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(`${name}: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
      return result.result.value;
    };
    await call("Page.enable"); await call("Runtime.enable");
    // Guard against a production build with an absolute API URL: never send test mutations there.
    await call("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await call("Emulation.setDeviceMetricsOverride", { width: mobile ? 390 : 1440, height: mobile ? 844 : 900, deviceScaleFactor: 1, mobile });
    // Only routing changes: the websocket connects to the REAL backend using the app's JWT.
    await call("Page.addScriptToEvaluateOnNewDocument", { source: `(()=>{const Native=window.WebSocket;window.WebSocket=class extends Native{constructor(url,protocols){const target=new URL(url,location.href);if(target.pathname.startsWith('/socket.io/')){target.hostname='127.0.0.1';target.protocol='ws:';target.port=${JSON.stringify(String(apiPort))};}super(target.href,...(protocols===undefined?[]:[protocols]));}};})()` });
    const page = { name, context, targetId, sessionId, call, evaluate, focus: () => send("Target.activateTarget", { targetId }) };
    pages.push(page);
    return page;
  }
  const visible = (page, selector) => page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return !!e&&e.getBoundingClientRect().width>0;})()`);
  async function login(page, user) {
    await page.focus(); await page.call("Page.navigate", { url: `${web}/auth/login?next=%2Fmessages` });
    await until(() => visible(page, 'input[type="email"]'), `${page.name}: login form`);
    await pause(400);
    for (const [type, value] of [["email", user.email], ["password", password]]) {
      await page.evaluate(`(()=>{const e=document.querySelector('input[type="${type}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    }
    await page.evaluate("document.querySelector('form').requestSubmit()");
    await until(() => visible(page, '[data-testid="conversation-list"]'), `${page.name}: authenticated messaging`);
    await until(() => page.evaluate(`document.body.innerText.includes('Bạn bè')`), `${page.name}: contacts loaded`);
  }
  const chatVisible = (page, text) => page.evaluate(`Array.from(document.querySelectorAll('[data-message-key]')).filter(e=>e.textContent.includes(${JSON.stringify(text)})).length`);
  const messageBadge = (page) => page.evaluate(`document.querySelector('a[title="Tin nhắn"]')?.getAttribute('aria-label')`);
  const bell = (page) => page.evaluate(`Array.from(document.querySelectorAll('button')).find(e=>e.getAttribute('aria-label')?.startsWith('Thông báo'))?.getAttribute('aria-label')`);
  async function openChat(page, id) {
    await page.focus();
    await page.evaluate(`(()=>{const a=document.querySelector('a[href="/messages/${id}"]');if(a)a.click();else location.assign('/messages/${id}');})()`);
    await until(() => visible(page, '[data-testid="message-composer"]'), `${page.name}: chat open`);
  }
  async function writeMessage(page, text) {
    await page.focus();
    await page.evaluate(`(()=>{const e=document.querySelector('[data-testid="message-composer"]');e.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until(() => page.evaluate(`!document.querySelector('button[aria-label="Gửi tin nhắn"]').disabled`), "composer ready");
    await page.evaluate(`document.querySelector('button[aria-label="Gửi tin nhắn"]').click()`);
    await until(() => page.evaluate(`document.querySelector('[data-testid="message-composer"]').value===''`), "send acknowledged");
  }
  const a1 = await newPage("An desktop"), bMobile = await newPage("Bình mobile", true), bDesktop = await newPage("Bình desktop");
  await login(a1, an); await login(bMobile, binh); await login(bDesktop, binh);
  const a2 = await newPage("An second tab", false, a1.context);
  await a2.call("Page.navigate", { url: `${web}/messages` });
  await until(() => visible(a2, '[data-testid="conversation-list"]'), "second tab cookie restoration");
  await until(() => a2.evaluate("document.body.innerText.includes('Bình khám phá')"), "second tab restored friends");
  checks.push("three real logins across independent desktop/mobile sessions; a second tab restores the shared HttpOnly session");

  await a1.focus();
  await until(() => a1.evaluate(`Array.from(document.querySelectorAll('section[aria-label="Bạn bè"] button')).some(e=>e.textContent.includes('Bình khám phá')&&!e.disabled)`), "friend ready after focus refresh");
  await a1.evaluate(`Array.from(document.querySelectorAll('section[aria-label="Bạn bè"] button')).find(e=>e.textContent.includes('Bình khám phá')).click()`);
  await until(() => visible(a1, '[data-testid="message-composer"]'), "create direct from friend");
  const conversationId = await a1.evaluate("location.pathname.split('/').at(-1)");
  const text = "Hẹn gặp ở Đà Lạt 🌿 — Chuyến đi đầu tiên";
  await writeMessage(a1, text);
  await until(async () => (await messageBadge(bMobile))?.includes("1 cuộc trò chuyện") && (await messageBadge(bDesktop))?.includes("1 cuộc trò chuyện"), "fanout unread to both recipient devices");
  assert.equal((await rest(`/conversations/${conversationId}`, binh.accessToken)).read_state.last_read_sequence, null, "background devices must not mark unseen messages read");
  assert.equal(await chatVisible(a1, text), 1, "REST/socket/optimistic reconcile");
  assert.equal((await db.query("SELECT count(*)::int AS count FROM conversations")).rows[0].count, 1);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM messages")).rows[0].count, 1);
  checks.push("real REST send plus user-room fanout: two recipient devices show unread, one DB row and one sender bubble");

  await openChat(bMobile, conversationId);
  await until(() => chatVisible(bMobile, text), "mobile history");
  await until(async () => (await rest(`/conversations/${conversationId}`, binh.accessToken)).read_state.last_read_sequence === "1", "visible mobile read persisted");
  await until(() => a1.evaluate("document.querySelector('[data-testid=\"message-history\"]').textContent.includes('Đã đọc')"), "sender read receipt");
  await until(async () => await messageBadge(bDesktop) === "Tin nhắn", "read clears other device badge");
  await openChat(bDesktop, conversationId);
  await until(() => chatVisible(bDesktop, text), "independent desktop history");
  await openChat(a2, conversationId);
  await until(() => chatVisible(a2, text), "same owner second tab history");
  for (const page of [a1, a2, bMobile, bDesktop]) assert.equal(await chatVisible(page, text), 1, `${page.name}: no duplicate`);
  checks.push("mobile visibility advances the server read cursor; sender receipt and recipient desktop badge synchronize across devices");

  const reply = "Bình đã sẵn sàng! Cùng ngắm bình minh nhé ☀️";
  await writeMessage(bMobile, reply);
  await until(async () => (await messageBadge(a1))?.includes("1 cuộc trò chuyện") && (await messageBadge(a2))?.includes("1 cuộc trò chuyện"), "both sender tabs receive unread reply");
  await a1.focus();
  await until(() => chatVisible(a1, reply), "reply received");
  await until(async () => await messageBadge(a1) === "Tin nhắn" && await messageBadge(a2) === "Tin nhắn", "read clears both owner tabs");
  await until(() => bMobile.evaluate("document.querySelector('[data-testid=\"message-history\"]').textContent.includes('Đã đọc')"), "reply read receipt");
  checks.push("reverse-direction reply and read receipt synchronize to both tabs without duplicate bubbles");

  const beforeNotification = (await rest("/notifications/unread-count", binh.accessToken)).count;
  await rest(`/users/${binh.username}/follow`, chi.accessToken, "POST");
  await until(async () => (await bell(bMobile)) === `Thông báo, ${beforeNotification + 1} chưa đọc` && (await bell(bDesktop)) === `Thông báo, ${beforeNotification + 1} chưa đọc`, "real notification trigger fanout");
  await bDesktop.focus();
  await bDesktop.evaluate(`Array.from(document.querySelectorAll('button')).find(e=>e.getAttribute('aria-label')?.startsWith('Thông báo')).click()`);
  await until(() => bDesktop.evaluate("document.querySelector('[role=dialog]')?.textContent.includes('Chi ghé thăm')"), "notification list actor");
  await bDesktop.evaluate(`Array.from(document.querySelectorAll('[role=dialog] button')).find(e=>e.textContent.includes('Đánh dấu tất cả')).click()`);
  await until(async () => await bell(bMobile) === "Thông báo" && await bell(bDesktop) === "Thông báo", "notification read state fanout");
  assert.equal((await rest("/notifications/unread-count", binh.accessToken)).count, 0);
  assert.equal((await rest("/conversations/unread-count", binh.accessToken)).unread_conversations, 0);
  checks.push("Phase 3 regression: real follow trigger, LISTEN/NOTIFY, bell/list and mark-all-read fan out to both devices independently of chat badges");

  await rest(`/conversations/${conversationId}`, chi.accessToken, "GET", undefined, 404);
  await rest(`/conversations/${conversationId}/messages`, chi.accessToken, "GET", undefined, 404);
  await rest(`/conversations/${conversationId}/messages`, chi.accessToken, "POST", { client_message_id: randomUUID(), message_type: "text", content: "unauthorized" }, 404);
  const outsider = await newPage("Chi outsider"); await login(outsider, chi);
  assert.equal(await outsider.evaluate(`Array.from(document.querySelectorAll('[data-testid="conversation-list"] a[href^="/messages/"]')).length`), 0);
  await outsider.call("Page.navigate", { url: `${web}/messages/${conversationId}` });
  await until(() => outsider.evaluate("document.body.innerText.includes('Cuộc trò chuyện không còn khả dụng')"), "outsider detail error");
  assert.equal(await chatVisible(outsider, text), 0);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM messages")).rows[0].count, 2);
  checks.push("third-party list is empty; forged detail/history/send requests return 404 and create no message");

  for (const page of [a1, bMobile, bDesktop]) {
    await page.focus();
    assert.equal(await page.evaluate("document.documentElement.scrollWidth<=innerWidth"), true, `${page.name}: no horizontal overflow`);
    assert.equal(await page.evaluate("document.cookie.includes('wandermap_refresh')"), false, "refresh cookie stays HttpOnly");
    const cookies = await send("Storage.getCookies", { browserContextId: page.context });
    const refreshCookie = cookies.cookies.find((cookie) => cookie.name === "wandermap_refresh");
    assert.ok(refreshCookie?.httpOnly && refreshCookie.path === "/api/v1/auth" && refreshCookie.sameSite === "Lax", "real cookie attributes");
    assert.equal(await page.evaluate(`(()=>{const sensitive=/access.?token|refresh.?token|authorization/i;for(const storage of [localStorage,sessionStorage])for(const key of Object.keys(storage)){if(sensitive.test(key)||sensitive.test(storage.getItem(key)))return true;}return false;})()`), false, "no tokens in browser storage");
    const shot = await page.call("Page.captureScreenshot", { format: "png" });
    await writeFile(join(artifacts, `${page.name.replaceAll(" ", "-")}.png`), Buffer.from(shot.data, "base64"));
  }
  assert.deepEqual(errors, [], "No browser runtime/hydration exceptions");
  checks.push("desktop/mobile layout, HttpOnly refresh-cookie isolation and no browser runtime exceptions");
  console.log(JSON.stringify({ checks, artifacts, backend: "real NestJS/Socket.IO/PostGIS", sessions: "2 users, 3 independent device contexts, 4 chat tabs, plus outsider", physicalDevices: false }, null, 2));
} catch (error) {
  console.error(error);
  for (const page of pages) {
    try { await writeFile(join(artifacts, `${page.name.replaceAll(" ", "-")}-failure.txt`), await page.evaluate("location.pathname+'\\n'+document.body.innerText")); } catch { /* target may be gone */ }
  }
  console.error(`Failure artifacts: ${artifacts}`);
  process.exitCode = 1;
} finally {
  socket?.close();
  for (const child of children.reverse()) child.kill();
  gateway?.closeAllConnections();
  if (gateway) await new Promise((done) => gateway.close(done));
  await db.end();
  await pause(500);
  const target = resolve(profile), temporary = resolve(tmpdir()) + sep;
  if (target.startsWith(temporary) && basename(target).startsWith("wandermap-phase4-browser-")) await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
