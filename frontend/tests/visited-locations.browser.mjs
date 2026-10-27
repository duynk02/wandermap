// Node 22+, Chrome/Chromium, and an isolated backend/database are required.
// Set WANDERMAP_TEST_WEB_URL and WANDERMAP_TEST_API_URL explicitly. Never uses a saved browser profile.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const web = process.env.WANDERMAP_TEST_WEB_URL;
const api = process.env.WANDERMAP_TEST_API_URL;
for (const address of [web, api]) {
  assert.ok(address && ["localhost", "127.0.0.1"].includes(new URL(address).hostname), "Set explicit localhost test web/API URLs backed by a disposable database.");
}
const browser = process.env.WANDERMAP_BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = await mkdtemp(join(tmpdir(), "wandermap-step2-browser-"));
const artifacts = await mkdtemp(join(tmpdir(), "wandermap-step2-screenshots-"));
const chrome = spawn(browser, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--window-size=1440,1100", "about:blank"], { windowsHide: true, stdio: "ignore" });
chrome.on("error", (error) => { console.error(error.message); });
let socket;
let diagnose;
const runtimeErrors = [];
const authRequests = [];
const checks = [];
const pause = (ms = 150) => new Promise((done) => setTimeout(done, ms));
async function until(check, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause();
  }
  throw new Error(`Timed out: ${label}`);
}
try {
  let port;
  await until(async () => {
    try { port = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; return !!port; } catch { return false; }
  }, "Chrome remote debugging");
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  let failNextWrite = false;
  let failPostSources = false;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Fetch.requestPaused") {
      const failedWrite = failNextWrite && message.params.request.method === "PATCH";
      const shouldFail = failedWrite || (failPostSources && message.params.request.url.includes('/posts/mine/by-location/'));
      if (failedWrite) failNextWrite = false;
      void send(shouldFail ? "Fetch.failRequest" : "Fetch.continueRequest", {
        requestId: message.params.requestId,
        ...(shouldFail ? { errorReason: "Failed" } : {}),
      });
    }
    if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails.text);
    if (message.method === "Network.responseReceived" && message.params.response.url.includes('/api/v1/auth/login')) authRequests.push({ status: message.params.response.status });
    if (message.method === "Network.loadingFailed") authRequests.push({ error: message.params.errorText });
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    clearTimeout(waiting.timeout);
    if (message.error) waiting.reject(new Error(message.error.message)); else waiting.done(message.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP command timed out: ${method}`)); }, 30000);
    pending.set(id, { done, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = (expression, label) => until(() => evaluate(expression), label);
  const click = (label) => evaluate(`(() => { const root = [...document.querySelectorAll('[role=dialog]')].filter(d => d.dataset.state !== 'closed').at(-1) ?? document; const button = [...root.querySelectorAll('button')].find(b => !b.disabled && b.textContent.trim() === ${JSON.stringify(label)}); if (!button) throw new Error('Missing button: ' + ${JSON.stringify(label)}); button.focus(); button.click(); })()`);
  const fill = async (selector, value) => {
    await waitFor(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && !el.disabled; })()`, `field ready: ${selector}`);
    const date = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Missing field'); el.focus(); if(el.type !== 'date') el.select(); return el.type === 'date'; })()`);
    if (date) await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    else await send("Input.insertText", { text: value });
  };
  const capture = async (name) => {
    await pause(250);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(artifacts, name), Buffer.from(shot.data, "base64"));
  };
  diagnose = async () => {
    await capture("failure.png");
    console.error(JSON.stringify({ artifacts, authRequests, page: await evaluate("location.href"), visibleText: await evaluate("document.body.innerText.slice(-1800)"), valid: await evaluate("document.querySelector('form')?.checkValidity()") }, null, 2));
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const credentials = { email: `travel_${suffix}@example.test`, password: `Test-only-${randomUUID()}`, username: `travel_${suffix}`, display_name: "Người lưu dấu chân" };
  async function call(path, body, method = "POST", accessToken) {
    const response = await fetch(`${api}${path}`, { method, headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.ok(response.ok, `${method} ${path}: ${response.status}`);
    return response.json();
  }
  const session = await call("/auth/register", credentials);
  const location = await call("/locations", { name: "Đà Lạt · Một miền ký ức", city: "Đà Lạt", country: "Việt Nam", category: "mountain", coordinates: { lat: 11.9404, lng: 108.4583 } }, "POST", session.accessToken);
  const locationId = location.id;
  assert.ok(locationId, "Location creation returns an ID");
  for (let index = 0; index < 13; index++) await call('/posts', {
    location_id: locationId, content: `Kỷ niệm tham khảo số ${index}`, images: [], rating: 4, visited_at: '2025-03-04', visibility: 'public',
  }, 'POST', session.accessToken);
  const importedContent = 'Kỷ niệm riêng tư ở Đà Lạt. '.repeat(50);
  await call('/posts', { location_id: locationId, content: importedContent, images: [], rating: 5, visited_at: '2024-02-29', visibility: 'private' }, 'POST', session.accessToken);
  const outsider = await call('/auth/register', { email: `outside_${suffix}@example.test`, password: `Test-only-${randomUUID()}`, username: `outside_${suffix}`, display_name: 'Một người khác' });
  await call('/posts', { location_id: locationId, content: 'Bài của người khác không được lấy làm nguồn', images: [], rating: 4, visited_at: '2025-03-04', visibility: 'public' }, 'POST', outsider.accessToken);

  // Exercise real parallel requests through the application's pg pool/owner locks.
  const repeatLocation = await call("/locations", { name: "Điểm kiểm thử gửi lại", coordinates: { lat: 10, lng: 106 } }, "POST", session.accessToken);
  const repeated = await Promise.all(Array.from({ length: 4 }, () => call("/users/me/visited-locations", { location_id: repeatLocation.id, visited_at: "2026-01-02" }, "POST", session.accessToken)));
  assert.equal(new Set(repeated.map((mark) => mark.id)).size, 1);
  assert.equal(repeated.at(-1).visit_count, 1);
  checks.push("parallel mark requests are idempotent");

  await send("Page.navigate", { url: `${web}/location/${locationId}` });
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Đánh dấu đã đến' && !b.disabled)", "guest location page");
  await click("Đánh dấu đã đến");
  await waitFor("document.body.innerText.includes('Đăng nhập để lưu những địa điểm bạn đã ghé thăm')", "guest auth feedback");
  assert.equal(await evaluate("!!document.querySelector('[role=dialog]')"), false);
  checks.push("guest action prompts sign-in");
  await send("Page.navigate", { url: `${web}/auth/login?next=${encodeURIComponent(`/location/${locationId}`)}` });
  await waitFor("!!document.querySelector('input[name=email]')", "login form");
  await waitFor("Object.keys(document.querySelector('input[name=email]')).some(key => key.startsWith('__reactProps$'))", "login hydration");
  await fill("input[name=email]", credentials.email);
  await fill("input[name=password]", credentials.password);
  await click("Đăng nhập");
  await waitFor(`location.pathname === ${JSON.stringify(`/location/${locationId}`)} && [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Đánh dấu đã đến' && !b.disabled)`, "return to place after login");
  await click("Đánh dấu đã đến");
  await waitFor("!!document.querySelector('#marked-note')", "new mark editor");
  assert.equal(await evaluate("document.querySelector('input[value=private]').checked"), true);
  assert.equal(await evaluate("document.querySelector('#marked-visit-date').value"), "");
  await fill('#marked-note', 'Nội dung đang nhập');
  failPostSources = true;
  await send('Fetch.enable', { patterns: [{ urlPattern: '*posts/mine/by-location/*' }] });
  await click('Lấy thông tin từ bài đăng');
  await waitFor("document.body.innerText.includes('Không thể tải bài đăng')", 'source error does not block manual entry');
  assert.equal(await evaluate("document.querySelector('#marked-note').value"), 'Nội dung đang nhập');
  failPostSources = false;
  await click('Thử tải lại');
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.includes('Kỷ niệm riêng tư ở Đà Lạt'))", 'own private post source');
  assert.equal(await evaluate("document.querySelector('[role=dialog]').innerText.includes('Bài của người khác không được lấy làm nguồn')"), false);
  assert.equal(await evaluate("document.querySelector('#marked-note').value"), 'Nội dung đang nhập', 'loading/refetch must not overwrite a draft');
  await click('Xem thêm bài đăng');
  await waitFor("document.body.innerText.includes('Kỷ niệm tham khảo số 0')", 'source pagination reaches old posts');
  await capture("visited-post-picker-desktop.png");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.ok(await evaluate("(() => { const r=document.querySelector('[role=dialog]').getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth && r.height <= innerHeight; })()"), "Post picker fits the mobile dialog");
  await capture("visited-post-picker-mobile.png");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Kỷ niệm riêng tư ở Đà Lạt')).click()");
  assert.equal(await evaluate("document.querySelector('#marked-visit-date').value"), '2024-02-29');
  assert.equal(await evaluate("document.querySelector('#marked-note').value"), importedContent.trim().slice(0, 1000));
  assert.equal(await evaluate("document.querySelector('input[value=private]').checked"), true);
  assert.equal(await evaluate("document.body.innerText.includes('1.000 ký tự đầu')"), true);
  assert.equal((await call(`/users/me/visited-locations?location_id=${locationId}`, undefined, "GET", session.accessToken)).count, 0, "Choosing a post must not save a mark automatically");
  checks.push('owner-only paginated post sources include private posts; selected travel date/text fill editable fields; no automatic overwrite; truncation notice; visibility preserved');
  await fill("#marked-visit-date", "2026-06-12");
  await fill("#marked-note", "Buổi sáng se lạnh, một ly cà phê và lời hẹn quay lại.");
  await capture("visited-create-desktop.png");
  await click("Lưu dấu chân");
  await waitFor("!document.querySelector('[role=dialog]') && [...document.querySelectorAll('button')].some(b => b.textContent.includes('Đã ghé thăm'))", "mark saved");
  let marks = await call(`/users/me/visited-locations?location_id=${locationId}`, undefined, "GET", session.accessToken);
  assert.equal(marks.data[0].visit_count, 1);
  assert.equal((await call(`/users/${credentials.username}/visited-locations`, undefined, "GET")).count, 0);
  const markId = marks.data[0].id;
  checks.push("create private mark with optional date and note");

  const openEditor = async () => {
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Đã ghé thăm')).click()");
    await waitFor("document.body.innerText.includes('Những lần ghé thăm')", "existing mark editor");
  };
  await openEditor();
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Thêm lần đến' && !b.disabled)", "visit history loaded");
  await click("Thêm lần đến");
  await click('Lấy thông tin từ bài đăng');
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.includes('Kỷ niệm riêng tư ở Đà Lạt'))", 'repeat visit source picker');
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Kỷ niệm riêng tư ở Đà Lạt')).click()");
  assert.equal(await evaluate("document.querySelector('#visit-date').value"), '2024-02-29');
  assert.equal(await evaluate("document.querySelector('#visit-note').value"), importedContent.trim().slice(0, 1000));
  await fill("#visit-date", "2026-07-20");
  await fill("#visit-note", "Quay lại cùng những người bạn.");
  await click("Lưu lần ghé thăm");
  await waitFor("!document.querySelector('#visit-date') && document.body.innerText.includes('20/07/2026')", "repeat visit saved");
  await waitFor("!!document.querySelector('button[aria-label=\"Sửa lần ghé thăm 20/07/2026\"]:not(:disabled)')", "visit save finished before editing");
  await evaluate("document.querySelector('button[aria-label=\"Sửa lần ghé thăm 20/07/2026\"]').click()");
  await waitFor("!!document.querySelector('#visit-date:not(:disabled)')", "visit edit form ready");
  await fill("#visit-date", "2026-07-21");
  await click("Lưu lần ghé thăm");
  await waitFor("!document.querySelector('#visit-date') && document.body.innerText.includes('21/07/2026')", "visit date edited");
  checks.push("add and edit repeat visits");

  await fill("#marked-note", "Chưa lưu");
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Lưu thay đổi' && !b.disabled)", "metadata draft registered before closing");
  await evaluate("document.querySelector('button[aria-label=\"Đóng quản lý địa điểm đã đến\"]').click()");
  await waitFor("document.body.innerText.includes('Bạn còn thay đổi chưa lưu')", "unsaved warning");
  await click("Quay lại");
  assert.equal(await evaluate("document.querySelector('#marked-note').value"), "Chưa lưu");
  await evaluate("document.querySelector('button[aria-label=\"Đóng quản lý địa điểm đã đến\"]').click()");
  await click("Bỏ thay đổi");
  await waitFor("!document.querySelector('[role=dialog]')", "discard closed editor");
  await pause();
  assert.ok(await evaluate("document.activeElement.textContent.includes('Đã ghé thăm')"));
  await openEditor();
  assert.notEqual(await evaluate("document.querySelector('#marked-note').value"), "Chưa lưu");
  checks.push("unsaved close confirmation, draft preservation and restored focus");

  await evaluate("document.querySelector('input[value=public]').click()");
  failNextWrite = true;
  await send("Fetch.enable", { patterns: [{ urlPattern: `${web}/api/v1/users/me/visited-locations/${markId}`, requestStage: "Request" }] });
  await click("Lưu thay đổi");
  await waitFor("document.body.innerText.includes('Chưa thể lưu thay đổi')", "save network failure feedback");
  assert.equal(await evaluate("document.querySelector('input[value=public]').checked"), true);
  assert.ok((await evaluate("document.querySelector('#marked-note').value")).includes("Buổi sáng se lạnh"));
  await send("Fetch.disable");
  checks.push("failed save preserves form values for retry");
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Lưu thay đổi' && !b.disabled)", "retry is available");
  await click("Lưu thay đổi");
  await until(async () => (await call(`/users/${credentials.username}/visited-locations`, undefined, "GET")).count === 1, "public visibility saved");
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Lưu thay đổi' && b.disabled)", "metadata save finished");
  await pause(2800); // Inspect the dialog after its transient save notification.
  await capture("visited-manage-desktop.png");
  checks.push("visibility change updates public API");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await pause(250);
  assert.ok(await evaluate("(() => { const r=document.querySelector('[role=dialog]').getBoundingClientRect(); return r.left>=-1 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1 && r.top>=0; })()"), "Mobile dialog fits viewport");
  await capture("visited-manage-mobile.png");
  await evaluate("document.documentElement.classList.add('dark')");
  await capture("visited-manage-mobile-dark.png");
  checks.push("mobile and dark dialog fit viewport");

  await evaluate("document.querySelector('button[aria-label=\"Xóa lần ghé thăm 21/07/2026\"]').click()");
  await click("Xóa lần ghé thăm");
  await waitFor("!document.body.innerText.includes('21/07/2026')", "visit removed");
  marks = await call(`/users/me/visited-locations?location_id=${locationId}`, undefined, "GET", session.accessToken);
  assert.equal(marks.data[0].visit_count, 1);
  // Scroll the dialog body, since destructive actions sit below history on mobile.
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Bỏ đánh dấu địa điểm này').click()");
  await click("Bỏ đánh dấu");
  await waitFor("!document.querySelector('[role=dialog]')", "mark removed");
  assert.equal((await call(`/users/me/visited-locations?location_id=${locationId}`, undefined, "GET", session.accessToken)).count, 0);
  assert.equal((await call(`/users/${credentials.username}/visited-locations`, undefined, "GET")).count, 0);
  checks.push("confirmed deletion removes visit/mark and invalidates status");
  await send("Page.navigate", { url: `${web}/location/${repeatLocation.id}` });
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.includes('Đã ghé thăm') && !b.disabled)", "place with no post sources");
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Đã ghé thăm')).click()");
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Thêm lần đến' && !b.disabled)", "empty source visit history");
  await click("Thêm lần đến");
  await click("Lấy thông tin từ bài đăng");
  await waitFor("document.body.innerText.includes('Bạn chưa có bài đăng tại địa điểm này')", "empty post source feedback");
  assert.equal(await evaluate("document.querySelector('#visit-date').disabled"), false);
  assert.equal(await evaluate("document.querySelector('#visit-note').disabled"), false);
  checks.push("empty sources leave manual visit entry available");
  assert.deepEqual(runtimeErrors, [], "No uncaught browser runtime exceptions");
  console.log(JSON.stringify({ checks, artifacts }, null, 2));
} catch (error) {
  console.error(error.message);
  await diagnose?.();
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: 2147483647, method: "Browser.close" }));
  socket?.close();
  for (let attempt = 0; attempt < 20 && chrome.exitCode === null; attempt++) await pause(250);
  if (chrome.exitCode === null) chrome.kill();
  // Only remove the fresh temporary browser profile created by this script.
  assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
  assert.ok(basename(profile).startsWith("wandermap-step2-browser-"));
  await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 300 }).catch((error) => console.warn(`Temporary browser profile cleanup: ${error.code}`));
}
