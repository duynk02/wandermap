// Real browser + local frontend, mocked auth responses. Never creates database accounts.
// Run: WANDERMAP_TEST_WEB_URL=http://127.0.0.1:<port> node tests/auth-forms.browser.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const web = process.env.WANDERMAP_TEST_WEB_URL;
assert.ok(web && ["localhost", "127.0.0.1"].includes(new URL(web).hostname), "Only an explicit local fixture frontend is allowed.");
const profile = await mkdtemp(join(tmpdir(), "wandermap-auth-browser-"));
const pause = (ms = 100) => new Promise((done) => setTimeout(done, ms));
const checks = [];
const pending = new Map();
const requests = [];
let sequence = 0, socket, sessionId, interceptionError, pendingRegistration, pageLoads = 0;
let registration = "success", cleanup = "success", leakedCredentialUrl = false;
const chrome = spawn(process.env.WANDERMAP_BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--disable-background-networking", "--window-size=1280,1000", "about:blank",
], { windowsHide: true, stdio: "ignore" });
chrome.on("error", (error) => { interceptionError = error; });

async function until(check, label) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (interceptionError) throw interceptionError;
    if (await check()) return;
    await pause();
  }
  throw new Error(`Timed out: ${label}`);
}
const send = (method, params = {}, targetSession = sessionId) => new Promise((resolveCall, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 45000);
  pending.set(id, { resolve: resolveCall, reject, timer });
  socket.send(JSON.stringify({ id, method, params, ...(targetSession ? { sessionId: targetSession } : {}) }));
});
async function evaluate(expression) {
  const value = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  assert.ok(!value.exceptionDetails, "Browser evaluation failed");
  return value.result?.value;
}
async function fulfill(requestId, status, body, headers = []) {
  await send("Fetch.fulfillRequest", { requestId, responseCode: status,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }, ...headers],
    body: Buffer.from(JSON.stringify(body)).toString("base64"),
  });
}
async function registered(requestId) {
  await fulfill(requestId, 201, { accessToken: "registration-fixture-not-for-storage", user: { id: "fixture-user" } }, [
    { name: "Set-Cookie", value: "wandermap_refresh=fixture; HttpOnly; Path=/api/v1/auth; SameSite=Lax" },
  ]);
}
async function intercept({ requestId, request }) {
  const route = new URL(request.url).pathname;
  requests.push({ route, method: request.method });
  if (route.endsWith("/auth/register")) {
    if (registration === "pending") { pendingRegistration = requestId; return; }
    if (registration === "conflict") return fulfill(requestId, 409, { code: "CONFLICT", message: "Email này đã được đăng ký." });
    if (registration === "network") return send("Fetch.failRequest", { requestId, errorReason: "ConnectionFailed" });
    return registered(requestId);
  }
  if (route.endsWith("/auth/logout")) {
    if (cleanup === "failure") return fulfill(requestId, 503, { code: "UNAVAILABLE", message: "Fixture cleanup unavailable" });
    return fulfill(requestId, 200, { success: true }, [{ name: "Set-Cookie", value: "wandermap_refresh=; Max-Age=0; HttpOnly; Path=/api/v1/auth; SameSite=Lax" }]);
  }
  if (route.endsWith("/auth/login")) return fulfill(requestId, 401, { code: "UNAUTHORIZED", message: "Email hoặc mật khẩu không đúng." });
  throw new Error(`Unexpected auth browser request: ${route}`);
}
async function navigate(route) {
  const previousLoad = pageLoads;
  await send("Page.navigate", { url: `${web}${route}` });
  await until(() => pageLoads > previousLoad, "auth page load");
  await until(() => evaluate("(()=>{const form=document.querySelector('form');return !!form&&Object.keys(form).some(key=>key.startsWith('__reactProps$')&&typeof form[key]?.onSubmit==='function')})()"), "hydrated auth form");
}
async function fill(fields) {
  for (const [name, value] of Object.entries(fields)) {
    await evaluate(`(()=>{const input=document.querySelector('input[name=${name}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  }
  await pause(100);
}
const submit = () => evaluate("document.querySelector('form').requestSubmit()");
const fixture = { display_name: "Du khách", username: "traveler_fixture", email: "traveler@example.test", password: "Auth-ui-fixture-only" };
async function assertLabels(expected) {
  const labels = await evaluate("Array.from(document.querySelectorAll('form label')).map(label=>({name:label.textContent.trim(),linked:!!label.control,outside:!!label.control&&label.getBoundingClientRect().bottom<=label.control.getBoundingClientRect().top}))");
  assert.deepEqual(labels.map((label) => label.name), expected);
  assert.ok(labels.every((label) => label.linked && label.outside));
  assert.equal(await evaluate("document.querySelector('form').method"), "post");
}

try {
  let debug;
  await until(async () => { try { debug = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split("\n"); return !!debug[1]; } catch { return false; } }, "Chrome startup");
  socket = new WebSocket(`ws://127.0.0.1:${debug[0]}${debug[1]}`);
  await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const call = pending.get(message.id); if (!call) return;
      pending.delete(message.id); clearTimeout(call.timer);
      if (message.error) call.reject(new Error(message.error.message)); else call.resolve(message.result);
    }
    if (message.method === "Fetch.requestPaused") void intercept(message.params).catch((error) => { interceptionError = error; });
    if (message.method === "Page.loadEventFired") pageLoads++;
    if (message.method === "Network.requestWillBeSent" && /[?&](password|access_token|token)=/i.test(message.params.request.url)) leakedCredentialUrl = true;
  });
  const targetId = (await send("Target.createTarget", { url: "about:blank" }, null)).targetId;
  sessionId = (await send("Target.attachToTarget", { targetId, flatten: true }, null)).sessionId;
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Network.setBlockedURLs", { urls: ["https://*"] });
  await send("Fetch.enable", { patterns: [{ urlPattern: `${web}/api/v1/*`, requestStage: "Request" }] });

  await navigate("/auth/register");
  await assertLabels(["Tên hiển thị", "Tên người dùng", "Email", "Mật khẩu"]);
  if (process.env.WANDERMAP_TEST_SCREENSHOT_DIR) {
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(join(process.env.WANDERMAP_TEST_SCREENSHOT_DIR, "register-labels.png"), Buffer.from(shot.data, "base64"));
  }
  await submit();
  await until(() => evaluate("document.querySelectorAll('form input[aria-invalid=true]').length===4"), "field validation feedback");
  assert.equal(requests.length, 0);
  checks.push("four persistent registration labels; accessible validation; invalid input sends no API request");

  await fill(fixture);
  registration = "pending";
  await submit();
  await until(() => !!pendingRegistration, "pending registration request");
  assert.equal(await evaluate("document.querySelector('button[type=submit]').disabled && document.querySelector('button[type=submit]').textContent.includes('Đang tạo tài khoản')"), true);
  await registered(pendingRegistration); pendingRegistration = undefined;
  await until(() => evaluate("location.pathname==='/auth/login'&&location.search.includes('registered=1')"), "registration redirects to login");
  await until(() => evaluate("!!document.querySelector('form [role=status]')?.textContent.includes('Đăng ký thành công')"), "persistent success banner");
  await assertLabels(["Email", "Mật khẩu"]);
  assert.deepEqual(requests.map(({ route }) => route), ["/api/v1/auth/register", "/api/v1/auth/logout"]);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('wandermap-auth')).state.profile"), null);
  const cookies = await send("Network.getCookies", { urls: [`${web}/api/v1/auth/refresh`] });
  assert.ok(!cookies.cookies.some((cookie) => cookie.name === "wandermap_refresh"));
  checks.push("loading feedback; successful registration redirects to login with visible success; no automatic signed-in profile or refresh cookie");

  registration = "conflict"; requests.length = 0;
  await navigate("/auth/register"); await fill(fixture); await submit();
  await until(() => evaluate("Array.from(document.querySelectorAll('form [role=alert]')).some(alert=>alert.textContent.includes('Email này đã được đăng ký'))"), "duplicate account inline error");
  assert.equal(await evaluate("location.pathname"), "/auth/register");
  assert.equal(requests.length, 1);
  checks.push("server rejection remains on registration page with a visible inline error");

  registration = "network";
  await navigate("/auth/register"); await fill(fixture); await submit();
  await until(() => evaluate("Array.from(document.querySelectorAll('form [role=alert]')).some(alert=>alert.textContent.includes('Không thể kết nối'))"), "network failure inline error");
  checks.push("network failure shows actionable feedback");

  registration = "success"; cleanup = "failure";
  await navigate("/auth/register"); await fill(fixture); await submit();
  await until(() => evaluate("location.pathname==='/auth/login'&&location.search.includes('session_cleanup=failed')"), "successful account with cleanup warning");
  await until(() => evaluate("document.querySelector('form')?.textContent.includes('bạn không cần đăng ký lại')"), "cleanup warning without false registration failure");
  checks.push("account creation is still reported as successful if session cleanup fails");

  await navigate("/auth/login"); await assertLabels(["Email", "Mật khẩu"]);
  await fill({ email: fixture.email, password: fixture.password }); await submit();
  await until(() => evaluate("Array.from(document.querySelectorAll('form [role=alert]')).some(alert=>alert.textContent.includes('Email hoặc mật khẩu không đúng'))"), "login failure inline error");
  assert.equal(await evaluate("location.pathname"), "/auth/login");
  assert.equal(leakedCredentialUrl, false);
  checks.push("two persistent login labels; failed login has visible feedback; no credentials in URLs");
  console.log(JSON.stringify({ result: "PASS", checks, scope: "Chrome + local frontend; auth requests intercepted, no database/provider writes" }, null, 2));
} finally {
  for (const call of pending.values()) clearTimeout(call.timer);
  socket?.close();
  const exited = new Promise((done) => chrome.once("exit", done));
  chrome.kill(); await Promise.race([exited, pause(2000)]);
  assert.ok(resolve(profile).startsWith(resolve(tmpdir()) + sep));
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
