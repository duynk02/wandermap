// Real local API + Next development server backed by an isolated, migrated *_test DB.
// Never point this mutation suite at development/production accounts or services.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const web = process.env.WANDERMAP_TEST_WEB_URL;
const api = process.env.WANDERMAP_TEST_API_URL;
for (const url of [web, api]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname), "Explicit local fixture URLs required");
assert.equal(process.env.WANDERMAP_BROWSER_ALLOW_MUTATIONS, "isolated-test", "Explicit isolated-test mutation acknowledgement required");
const profile = await mkdtemp(join(tmpdir(), "wandermap-media-browser-"));
const pause = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(); }
  throw new Error(`Timed out: ${label}`);
}
async function rest(path, token, method = "GET", body) {
  const response = await fetch(`${api}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  assert.ok(response.ok, `${method} ${path} returned ${response.status}`);
  return response.json();
}
let chrome, socket;
const pending = new Map();
const checks = [];
let sequence = 0, mediaWithBearer = 0, leakedTokenUrl = false, providerRequest = false;
try {
  await until(async () => { try { return (await fetch(`${api}/health`, { signal: AbortSignal.timeout(5000) })).ok && (await fetch(`${web}/auth/login`, { signal: AbortSignal.timeout(10000) })).ok; } catch { return false; } }, "fixture services ready", 300000);
  const suffix = randomBytes(5).toString("hex");
  const password = randomBytes(18).toString("hex");
  const users = [];
  for (const role of ["owner", "outsider"]) {
    const username = `media_${role}_${suffix}`;
    const email = `${username}@example.test`;
    users.push({ ...(await rest("/auth/register", null, "POST", { username, email, password, display_name: `Media ${role}` })), username, email });
  }
  const [owner, outsider] = users;
  const location = await rest("/locations", owner.accessToken, "POST", { name: `Media fixture ${suffix}`, coordinates: { lat: 12, lng: 108 }, category: "other" });
  const bytes = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#22c55e" } }).jpeg().toBuffer();
  const form = new FormData(); form.append("file", new Blob([bytes], { type: "image/jpeg" }), "fixture.jpg");
  const uploaded = await fetch(`${api}/uploads/images`, { method: "POST", headers: { Authorization: `Bearer ${owner.accessToken}` }, body: form });
  assert.equal(uploaded.status, 201);
  const asset = await uploaded.json();
  const post = await rest("/posts", owner.accessToken, "POST", { location_id: location.id, content: "Private browser media fixture", images: [asset.url], rating: 5, visited_at: "2026-01-01", visibility: "private" });
  const mediaPath = new URL(asset.url).pathname;
  chrome = spawn(process.env.WANDERMAP_BROWSER_PATH ?? (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "google-chrome"), [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  let debug;
  await until(async () => { try { debug = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split("\n"); return !!debug[1]; } catch { return false; } }, "Chrome CDP");
  socket = new WebSocket(`ws://127.0.0.1:${debug[0]}${debug[1]}`);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 60000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const item = pending.get(message.id); if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(new Error(`CDP error: ${message.error.message}`)); else item.resolve(message.result);
    }
    if (message.method === "Network.requestWillBeSent") {
      const request = message.params.request;
      if (/[?&](password|access_token|token)=/i.test(request.url)) leakedTokenUrl = true;
      if (request.url.includes("/api/v1/media/")) {
        if (Object.keys(request.headers).some((key) => key.toLowerCase() === "authorization")) mediaWithBearer++;
        if (/[?&](token|access_token)=/i.test(request.url)) leakedTokenUrl = true;
      }
      if (request.url.includes("res.cloudinary.com")) providerRequest = true;
    }
  });
  const context = (await send("Target.createBrowserContext")).browserContextId;
  async function page() {
    const targetId = (await send("Target.createTarget", { url: "about:blank", browserContextId: context })).targetId;
    const sessionId = (await send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
    const call = (method, params) => send(method, params, sessionId);
    await call("Page.enable"); await call("Runtime.enable"); await call("Network.enable");
    await call("Network.setBlockedURLs", { urls: ["https://*"] });
    await call("Page.addScriptToEvaluateOnNewDocument", { source: "window.__revokedMedia=[];const revoke=URL.revokeObjectURL;URL.revokeObjectURL=function(url){window.__revokedMedia.push(url);return revoke.call(URL,url)}" });
    return { call, focus: () => send('Target.activateTarget', { targetId }), evaluate: async (expression) => {
      const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      assert.ok(!result.exceptionDetails, "Browser evaluation failed");
      return result.result?.value;
    } };
  }
  const first = await page();
  async function login(current, user) {
    await current.focus();
    await current.call("Page.navigate", { url: `${web}/auth/login?next=${encodeURIComponent(`/post/${post.id}`)}` });
    await until(() => current.evaluate("!!document.querySelector('input[type=email]')"), "login form");
    await until(() => current.evaluate("(()=>{const form=document.querySelector('form');return !!form&&Object.keys(form).some(key=>key.startsWith('__reactProps$')&&typeof form[key]?.onSubmit==='function')})()"), "hydrated login handlers");
    assert.equal(await current.evaluate("document.querySelector('form').method"), "post", "Auth forms must never native-submit credentials using GET");
    for (const [type, value] of [["email", user.email], ["password", password]]) await current.evaluate(`(()=>{const input=document.querySelector('input[type=${type}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await pause(250);
    await current.evaluate("document.querySelector('form').requestSubmit()");
    await until(() => current.evaluate(`location.pathname==='/post/${post.id}'`), "login redirect");
  }
  const imageReady = (current) => current.evaluate("Array.from(document.images).some(image=>image.alt==='Ảnh 1'&&image.src.startsWith('blob:')&&image.naturalWidth===40)");
  await login(first, owner);
  await until(() => imageReady(first), "authorized private image decoded");
  const privateBlob = await first.evaluate("Array.from(document.images).find(image=>image.alt==='Ảnh 1').src");
  assert.equal(await first.evaluate(`fetch(${JSON.stringify(mediaPath)},{cache:'no-store'}).then(response=>response.status)`), 404, "A canonical URL alone must not authorize even a logged-in browser without bearer header");
  checks.push("real login + same-origin rewrite + private authorized Blob image; bare canonical URL denied");

  const second = await page();
  await second.call("Page.navigate", { url: `${web}/profile/${owner.username}` });
  await until(() => second.evaluate("!!document.querySelector('button[aria-label=\"Cài đặt\"]')"), "second tab session restoration");
  await second.focus();
  const point = await second.evaluate("(()=>{const r=document.querySelector('button[aria-label=\"Cài đặt\"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await second.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await second.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await until(() => second.evaluate("Array.from(document.querySelectorAll('[role=menuitem]')).some(item=>item.textContent.trim()==='Đăng xuất')"), 'logout menu');
  await second.evaluate("Array.from(document.querySelectorAll('[role=menuitem]')).find(item=>item.textContent.trim()==='Đăng xuất').click()");
  await until(() => first.evaluate("document.body?.innerText.includes('Không tìm thấy bài đăng')"), "cross-tab logout removes private UI");
  assert.equal(await first.evaluate(`window.__revokedMedia.includes(${JSON.stringify(privateBlob)})`), true, "Private Blob URL must be revoked");
  checks.push("real UI logout broadcasts to the original tab, removes private image and revokes Blob URL");

  await login(first, outsider);
  await until(() => first.evaluate("document.body?.innerText.includes('Không tìm thấy bài đăng')"), "outsider cannot view private post");
  assert.equal(await imageReady(first), false);
  await rest(`/posts/${post.id}`, owner.accessToken, "PATCH", { visibility: "public" });
  await first.call("Page.reload"); await until(() => imageReady(first), "public image visible to another account");
  await rest(`/posts/${post.id}`, owner.accessToken, "PATCH", { visibility: "private" });
  await first.call("Page.reload");
  await until(() => first.evaluate("document.body?.innerText.includes('Không tìm thấy bài đăng')"), "privacy change blocks new image request");
  const denied = await fetch(`${web}${mediaPath}`, { cache: "no-store" });
  assert.equal(denied.status, 404); assert.match(denied.headers.get("cache-control"), /no-store/);
  assert.ok(mediaWithBearer > 0); assert.equal(leakedTokenUrl, false); assert.equal(providerRequest, false);
  checks.push("account replacement does not reuse old bytes; public→private blocks fresh reads without provider/token URL leakage");
  console.log(JSON.stringify({ checks, result: "PASS", verification: "Chrome + local Docker API/Next development + isolated PostGIS; cloud and production browser integration NOT VERIFIED" }, null, 2));
} finally {
  for (const item of pending.values()) clearTimeout(item.timer);
  socket?.close();
  if (chrome) {
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill(); await Promise.race([exited, pause(3000)]);
  }
  if (profile.startsWith(join(tmpdir(), "wandermap-media-browser-"))) await rm(profile, { recursive: true, force: true });
}
