// Explicit local integration run: node tests/profile-editing.live.mjs
// Uses throwaway accounts, an isolated browser profile and the running local API/web app.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchLocalBrowser } from "./helpers/local-browser.mjs";

const requireBackend = createRequire(
  new URL("../../backend/package.json", import.meta.url),
);
const dotenv = requireBackend("dotenv");
const { Pool } = requireBackend("pg");
const { JwtService } = requireBackend("@nestjs/jwt");
const sharp = requireBackend("sharp");
const backend = fileURLToPath(new URL("../../backend/", import.meta.url));
const frontend = fileURLToPath(new URL("../", import.meta.url));
const settings = dotenv.parse(await readFile(path.join(backend, ".env")));
const apiBase =
  process.env.WANDERMAP_TEST_API ?? "http://localhost:4000/api/v1";
const webBase = process.env.WANDERMAP_TEST_WEB ?? "http://localhost:3000";
const localHosts = ["localhost", "127.0.0.1", "[::1]"];
for (const address of [settings.DATABASE_URL, apiBase, webBase]) {
  assert.ok(
    localHosts.includes(new URL(address).hostname),
    "Live profile checks require local services.",
  );
}
const pool = new Pool({
  connectionString: settings.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
const directory = await mkdtemp(
  path.join(tmpdir(), "wandermap-profile-fixtures-"),
);
const runId = randomUUID().replaceAll("-", "").slice(0, 12);
const emails = [
  `profile-check-${runId}-a@example.invalid`,
  `profile-check-${runId}-b@example.invalid`,
];
const password = `test-only-${randomUUID()}`;
const artifacts = path.join(frontend, "build/profile-test-artifacts");
const startedAt = Date.now();
const uploadedUrls = new Set();
const results = [];
let browser;
let credentials;

const editorTitle = "Chỉnh sửa hồ sơ";
const cropTitle = "Căn chỉnh ảnh đại diện";
const dialogOpen = (title) =>
  `[...document.querySelectorAll('[role="dialog"]')].some(e => e.querySelector('h2')?.textContent.trim() === ${JSON.stringify(title)})`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (name) => {
  results.push(name);
  console.log(`PASS ${name}`);
};
const waitUntil = async (check, label) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await pause(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

async function api(route, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${apiBase}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
    headers: response.headers,
  };
}

try {
  for (const [index, email] of emails.entries()) {
    const result = await api("/auth/register", {
      method: "POST",
      body: {
        email,
        password,
        username: `profile_${runId}_${index}`,
        display_name: `Profile Check ${index}`,
      },
    });
    assert.equal(result.status, 201, "Test account registration must succeed.");
    assert.ok(result.headers.get("set-cookie")?.includes("HttpOnly"));
    if (index === 0) credentials = result.body;
  }
  const other = `profile_${runId}_1`;
  const own = `profile_${runId}_0`;
  const token = credentials.accessToken;
  const patch = (body) => api("/users/me", { method: "PATCH", token, body });

  assert.equal(
    (await api("/users/me", { method: "PATCH", body: { bio: "unauthorized" } }))
      .status,
    401,
  );
  for (const body of [
    { display_name: "   " },
    { username: "bad-name" },
    { id: randomUUID() },
    { role: "admin" },
    { website: "https://example.com" },
    { cover_url: "https://example.com/cover.png" },
  ]) {
    assert.equal((await patch(body)).status, 400);
  }
  pass(
    "real API rejects unauthenticated requests, invalid values and forbidden fields",
  );

  const conflict = await patch({ username: other.toUpperCase() });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "USERNAME_TAKEN");
  assert.equal(
    (await api(`/users/${other}`)).body.display_name,
    "Profile Check 1",
  );
  pass(
    "PostgreSQL enforces case-insensitive username uniqueness and preserves the other account",
  );

  const updated = await patch({
    display_name: "  Kiểm thử Profile  ",
    bio: "  Du lịch  ",
    home_city: "  Huế  ",
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.display_name, "Kiểm thử Profile");
  assert.equal(updated.body.home_city, "Huế");
  assert.equal(updated.body.bio, "Du lịch");
  assert.ok(!("website" in updated.body) && !("email" in updated.body));
  const cleared = await patch({ bio: "", home_city: null, avatar_url: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.bio, null);
  assert.equal(cleared.body.home_city, null);
  pass("real API persists normalized details and clears optional values");

  browser = await launchLocalBrowser();
  const page = browser.client;
  const count = { upload: 0, patch: 0, refresh: 0 };
  const faults = {
    upload: false,
    patch: false,
    expired: false,
    refresh: false,
    delay: false,
  };
  let delayed;
  const browserErrors = [];
  const protocolErrors = [];
  page.on("Runtime.exceptionThrown", () =>
    browserErrors.push("Unhandled browser exception"),
  );
  page.on("Network.responseReceived", ({ response }) => {
    if (response.url.endsWith("/auth/login"))
      console.log(`CHECK browser login HTTP ${response.status}`);
  });
  page.on("Network.requestWillBeSent", ({ request }) => {
    if (request.url.endsWith("/uploads/images") && request.method === "POST")
      count.upload++;
    if (request.url.endsWith("/users/me") && request.method === "PATCH")
      count.patch++;
    if (request.url.endsWith("/auth/refresh") && request.method === "POST")
      count.refresh++;
  });
  const expired = new JwtService({ secret: settings.JWT_ACCESS_SECRET }).sign(
    {
      sub: credentials.user.id,
      email: emails[0],
    },
    { expiresIn: -1 },
  );
  page.on("Fetch.requestPaused", (event) => {
    void (async () => {
      const { requestId, request } = event;
      const upload = request.url.endsWith("/uploads/images");
      const update =
        request.url.endsWith("/users/me") && request.method === "PATCH";
      const refresh = request.url.endsWith("/auth/refresh");
      if (
        (upload && faults.upload) ||
        (update && faults.patch) ||
        (refresh && faults.refresh)
      ) {
        const status = refresh ? 401 : 500;
        if (upload) faults.upload = false;
        if (update) faults.patch = false;
        if (refresh) faults.refresh = false;
        await page.send("Fetch.fulfillRequest", {
          requestId,
          responseCode: status,
          responseHeaders: [
            { name: "Content-Type", value: "application/json" },
          ],
          body: Buffer.from(
            JSON.stringify({
              statusCode: status,
              code: "TEST_FAILURE",
              message: "Injected local test failure.",
            }),
          ).toString("base64"),
        });
      } else if (update && faults.expired) {
        faults.expired = false;
        const headers = Object.entries(request.headers)
          .filter(([name]) => name.toLowerCase() !== "authorization")
          .map(([name, value]) => ({ name, value }));
        headers.push({ name: "Authorization", value: `Bearer ${expired}` });
        await page.send("Fetch.continueRequest", { requestId, headers });
      } else if (update && faults.delay) {
        faults.delay = false;
        delayed = requestId;
      } else await page.send("Fetch.continueRequest", { requestId });
    })().catch((error) => protocolErrors.push(error.message));
  });
  await page.send("Fetch.enable", {
    patterns: [
      { urlPattern: "*/api/v1/uploads/images", requestStage: "Request" },
      { urlPattern: "*/api/v1/users/me", requestStage: "Request" },
      { urlPattern: "*/api/v1/auth/refresh", requestStage: "Request" },
    ],
  });
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.navigate(`${webBase}/auth/login`);
  await page.waitFor(
    `!!document.querySelector('input[type=email]')`,
    "login form",
  );
  await page.waitFor(
    `Object.keys(document.querySelector('input[type=email]')).some(key => key.startsWith('__reactProps'))`,
    "login form hydration",
  );
  // Authenticate with the real API; seed only the public hint used by AuthProvider.
  // The subsequent full navigation must restore its token through the HttpOnly cookie.
  const authenticated = await page.evaluate(`(async () => {
    const response=await fetch('/api/v1/auth/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(emails[0])},password:${JSON.stringify(password)}})});
    if(!response.ok) return false;
    const result=await response.json();
    const {email,...profile}=result.user;
    localStorage.setItem('wandermap-auth',JSON.stringify({state:{profile},version:0}));
    return profile.id===${JSON.stringify(credentials.user.id)};
  })()`);
  assert.equal(
    authenticated,
    true,
    "Browser must authenticate with the real API.",
  );
  await page.navigate(`${webBase}/profile/${own}`);
  await page.waitFor(
    `location.pathname === '/profile/${own}' && [...document.querySelectorAll('button')].some(e => e.textContent.trim() === 'Chỉnh sửa hồ sơ')`,
    "authenticated own profile",
  );
  await page.click(editorTitle);
  await page.waitFor(dialogOpen(editorTitle), "edit profile dialog");
  assert.equal(
    await page.evaluate(
      `document.querySelector('#profile-display_name').value`,
    ),
    "Kiểm thử Profile",
  );
  assert.equal(
    await page.evaluate(`!!document.querySelector('#profile-website')`),
    false,
  );
  assert.equal(
    await page.evaluate(`getComputedStyle(document.body).overflow`),
    "hidden",
  );
  for (let index = 0; index < 12; index++) {
    await page.key("Tab", 9);
    assert.equal(
      await page.evaluate(
        `!!document.activeElement.closest('[role="dialog"]')`,
      ),
      true,
    );
  }
  pass(
    "own profile loads current values, traps focus and locks background scrolling",
  );

  await page.fill("#profile-display_name", "   ");
  await page.click("Lưu thay đổi", editorTitle);
  await page.waitFor(
    `!!document.querySelector('#profile-display_name-error')`,
    "blank name error",
  );
  await page.fill("#profile-display_name", "Bản nháp chưa lưu");
  await page.click("Hủy", editorTitle);
  await page.waitFor(
    dialogOpen("Bỏ thay đổi chưa lưu?"),
    "discard confirmation",
  );
  await page.click("Tiếp tục sửa", "Bỏ thay đổi chưa lưu?");
  assert.equal(
    await page.evaluate(
      `document.querySelector('#profile-display_name').value`,
    ),
    "Bản nháp chưa lưu",
  );
  await page.click("Hủy", editorTitle);
  await page.click("Bỏ thay đổi", "Bỏ thay đổi chưa lưu?");
  await page.waitFor(`!(${dialogOpen(editorTitle)})`, "discarded editor");
  await page.waitFor(
    `document.activeElement?.textContent.trim() === 'Chỉnh sửa hồ sơ'`,
    "focus restored to edit trigger",
  );
  await page.click(editorTitle);
  assert.equal(
    await page.evaluate(
      `document.querySelector('#profile-display_name').value`,
    ),
    "Kiểm thử Profile",
  );
  pass(
    "invalid values stay in the form; discard confirmation, cancel and focus restoration work",
  );

  await page.fill("#profile-username", other.toUpperCase());
  await page.click("Lưu thay đổi", editorTitle);
  await page.waitFor(
    `document.querySelector('#profile-username-error')?.textContent.includes('đã được sử dụng')`,
    "username conflict",
  );
  assert.equal(
    await page.evaluate(`document.querySelector('#profile-username').value`),
    other.toUpperCase(),
  );
  const renamed = `renamed_${runId}`;
  await page.fill("#profile-username", renamed);
  await page.fill("#profile-display_name", "Hồ sơ đã cập nhật");
  await page.fill("#profile-bio", "Yêu những chuyến đi");
  await page.fill("#profile-home_city", "Đà Nẵng");
  pass(
    "duplicate username is rejected beside its field without losing draft values",
  );

  const photo = path.join(directory, "avatar.png");
  const invalid = path.join(directory, "invalid.png");
  const oversized = path.join(directory, "oversized.png");
  await writeFile(
    photo,
    await sharp({
      create: {
        width: 1600,
        height: 900,
        channels: 3,
        background: `#${runId.slice(0, 6)}`,
      },
    })
      .png()
      .toBuffer(),
  );
  await writeFile(invalid, "not an image");
  await writeFile(oversized, Buffer.alloc(10 * 1024 * 1024 + 1));
  await page.chooseFile(oversized);
  await page.waitFor(
    `document.querySelector('#profile-avatar-error')?.textContent.includes('10 MB')`,
    "oversized avatar rejection",
  );
  assert.equal(count.upload, 0);
  await page.chooseFile(invalid);
  await page.waitFor(
    `(${dialogOpen(cropTitle)}) && [...document.querySelectorAll('[role=alert]')].some(e => e.textContent.includes('Không đọc được ảnh'))`,
    "invalid crop image rejection",
  );
  await page.click("Hủy", cropTitle);
  await page.waitFor(`!(${dialogOpen(cropTitle)})`, "cancel invalid crop");

  const originalPreview = await page.evaluate(
    `document.querySelector('img[alt="Xem trước ảnh đại diện"]').src`,
  );
  await page.chooseFile(photo);
  await page.waitFor(
    `(${dialogOpen(cropTitle)}) && !document.querySelector('input[type=range]')?.disabled`,
    "loaded crop image",
  );
  await page.click("Hủy", cropTitle);
  await page.waitFor(`!(${dialogOpen(cropTitle)})`, "crop cancelled");
  assert.equal(
    await page.evaluate(
      `document.querySelector('img[alt="Xem trước ảnh đại diện"]').src`,
    ),
    originalPreview,
  );
  assert.equal(count.upload, 0);
  pass(
    "oversized/corrupt images are rejected; cancelling crop preserves the prior avatar and uploads nothing",
  );

  await page.chooseFile(photo);
  await page.waitFor(
    `!!document.querySelector('input[type=range]') && !document.querySelector('input[type=range]').disabled`,
    "crop controls",
  );
  await page.fill("input[type=range]", "2");
  await page.click("Đặt lại", cropTitle);
  assert.equal(
    await page.evaluate(`document.querySelector('input[type=range]').value`),
    "1",
  );
  await page.click("Phóng to ảnh", cropTitle);
  assert.equal(
    await page.evaluate(
      `Number(document.querySelector('input[type=range]').value)`,
    ),
    1.1,
  );
  await page.fill("input[type=range]", "2");
  await page.evaluate(
    `document.querySelector('[aria-label="Vùng cắt ảnh đại diện"]').focus()`,
  );
  const beforeKeyboardPan = await page.evaluate(
    `document.querySelector('img[alt="Ảnh đại diện đang căn chỉnh"]').style.left`,
  );
  await page.key("ArrowRight", 39);
  await page.waitFor(
    `document.querySelector('img[alt="Ảnh đại diện đang căn chỉnh"]').style.left !== ${JSON.stringify(beforeKeyboardPan)}`,
    "keyboard crop panning",
  );
  const area = await page.evaluate(
    `(() => { const r = document.querySelector('[aria-label="Vùng cắt ảnh đại diện"]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
  );
  await page.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: area.x,
    y: area.y,
    button: "left",
    clickCount: 1,
  });
  const beforeMousePan = await page.evaluate(
    `document.querySelector('img[alt="Ảnh đại diện đang căn chỉnh"]').style.left`,
  );
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: area.x + 40,
    y: area.y + 20,
    buttons: 1,
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: area.x + 40,
    y: area.y + 20,
    button: "left",
    clickCount: 1,
  });
  await page.waitFor(
    `document.querySelector('img[alt="Ảnh đại diện đang căn chỉnh"]').style.left !== ${JSON.stringify(beforeMousePan)}`,
    "mouse crop panning",
  );
  assert.equal(
    await page.evaluate(`document.querySelector('input[type=range]').value`),
    "2",
  );
  await page.click("Áp dụng ảnh", cropTitle);
  await page.waitFor(
    `!(${dialogOpen(cropTitle)}) && document.querySelector('img[alt="Xem trước ảnh đại diện"]').src.startsWith('blob:')`,
    "applied cropped avatar",
  );
  assert.equal(count.upload, 0);
  pass(
    "desktop crop supports zoom and dragging and applies only a local preview",
  );

  faults.upload = true;
  await page.click("Lưu thay đổi", editorTitle);
  await page.waitFor(
    `(${dialogOpen(editorTitle)}) && [...document.querySelectorAll('[role=alert]')].some(e => e.textContent.includes('Máy chủ'))`,
    "upload failure retained editor",
  );
  assert.equal(
    await page.evaluate(`document.querySelector('#profile-home_city').value`),
    "Đà Nẵng",
  );
  const uploadBeforeRetry = count.upload;
  const patchBeforeRetry = count.patch;
  faults.patch = true;
  await page.click("Lưu thay đổi", editorTitle);
  await waitUntil(
    () => count.patch > patchBeforeRetry,
    "retried upload followed by PATCH",
  );
  await page.waitFor(
    `(${dialogOpen(editorTitle)}) && [...document.querySelectorAll('[role=alert]')].some(e => e.textContent.includes('Máy chủ')) && ![...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Lưu thay đổi').disabled`,
    "PATCH failure retained editor",
  );
  assert.equal(count.upload, uploadBeforeRetry + 1);
  const uploadAfterSuccess = count.upload;
  faults.delay = true;
  await page.click("Lưu thay đổi", editorTitle);
  for (let attempt = 0; attempt < 100 && !delayed; attempt++) await pause(50);
  assert.ok(delayed, "Profile update must reach the API once.");
  assert.equal(
    await page.evaluate(
      `document.querySelector('button[type=submit]').disabled`,
    ),
    true,
  );
  const updateCount = count.patch;
  await page.evaluate(`document.querySelector('button[type=submit]').click()`);
  assert.equal(count.patch, updateCount);
  await page.send("Fetch.continueRequest", { requestId: delayed });
  await page.waitFor(
    `!(${dialogOpen(editorTitle)}) && location.pathname === '/profile/${renamed}'`,
    "successful profile save and username navigation",
  );
  assert.equal(count.upload, uploadAfterSuccess);
  const saved = await api("/users/me", { token });
  assert.equal(saved.body.display_name, "Hồ sơ đã cập nhật");
  assert.equal(saved.body.home_city, "Đà Nẵng");
  assert.equal(saved.body.bio, "Yêu những chuyến đi");
  assert.ok(saved.body.avatar_url);
  await page.waitFor(
    `document.querySelector('h1')?.textContent === 'Hồ sơ đã cập nhật' && document.querySelector('header img')?.src === ${JSON.stringify(saved.body.avatar_url)}`,
    "immediate profile identity update",
  );
  uploadedUrls.add(saved.body.avatar_url);
  const imageResponse = await fetch(saved.body.avatar_url);
  assert.equal(imageResponse.status, 200);
  const meta = await sharp(
    Buffer.from(await imageResponse.arrayBuffer()),
  ).metadata();
  assert.equal(meta.width, 450);
  assert.equal(meta.height, 450);
  assert.equal(meta.format, "webp");
  assert.equal(meta.exif, undefined);
  pass(
    "upload/PATCH failures preserve the draft; retry reuses upload; duplicate saves are blocked; cropped WebP persists",
  );

  await page.send("Page.reload", { ignoreCache: true });
  await page.waitFor(
    `document.querySelector('h1')?.textContent === 'Hồ sơ đã cập nhật' && [...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Chỉnh sửa hồ sơ')`,
    "profile persistence after reload",
  );
  assert.equal(
    await page.evaluate(`document.querySelector('header img').src`),
    saved.body.avatar_url,
  );
  assert.equal(
    await page.evaluate(
      `(() => { const data=JSON.parse(localStorage.getItem('wandermap-auth')); return Object.keys(data.state).join(',') === 'profile' && !('email' in data.state.profile) && !/accessToken|refreshToken|password/.test(JSON.stringify(data)); })()`,
    ),
    true,
  );
  assert.equal(
    await page.evaluate(`document.cookie.includes('wandermap_refresh')`),
    false,
  );
  await page.navigate(`${webBase}/feed`);
  await page.waitFor(
    `document.querySelector('a[aria-label="Hồ sơ cá nhân"]')?.getAttribute('href') === '/profile/${renamed}'`,
    "navbar profile link",
  );
  assert.equal(
    await page.evaluate(
      `document.querySelector('a[aria-label="Hồ sơ cá nhân"] img').src`,
    ),
    saved.body.avatar_url,
  );
  pass(
    "reload restores profile through HttpOnly session; Navbar uses the new avatar and username; tokens stay out of storage",
  );

  await page.navigate(`${webBase}/profile/${other}`);
  await page.waitFor(
    `document.querySelector('h1')?.textContent === 'Profile Check 1'`,
    "other profile",
  );
  assert.equal(
    await page.evaluate(
      `[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Chỉnh sửa hồ sơ')`,
    ),
    false,
  );
  pass("another profile exposes no edit action");

  await page.navigate(`${webBase}/profile/${renamed}`);
  await page.waitFor(
    `document.querySelector('h1')?.textContent === 'Hồ sơ đã cập nhật' && [...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Chỉnh sửa hồ sơ')`,
    "own profile again",
  );
  await page.click(editorTitle);
  const refreshBefore = count.refresh;
  faults.expired = true;
  await page.fill("#profile-display_name", "Sau khi làm mới phiên");
  await page.click("Lưu thay đổi", editorTitle);
  await page.waitFor(
    `!(${dialogOpen(editorTitle)}) && document.querySelector('h1')?.textContent === 'Sau khi làm mới phiên'`,
    "expired JWT refresh and retry",
  );
  assert.equal(count.refresh, refreshBefore + 1);
  pass(
    "a genuinely expired JWT triggers one refresh and a successful update retry",
  );

  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await page.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  await page.click(editorTitle);
  await page.chooseFile(photo);
  await page.waitFor(
    `!!document.querySelector('input[type=range]') && !document.querySelector('input[type=range]').disabled`,
    "mobile crop",
  );
  await page.fill("input[type=range]", "2");
  const touchArea = await page.evaluate(
    `(() => { const r=document.querySelector('[aria-label="Vùng cắt ảnh đại diện"]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
  );
  const beforePan = await page.evaluate(
    `document.querySelector('img[alt="Ảnh đại diện đang căn chỉnh"]').style.left`,
  );
  await page.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: touchArea.x, y: touchArea.y, id: 1 }],
  });
  await page.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: touchArea.x + 35, y: touchArea.y + 10, id: 1 }],
  });
  await page.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.waitFor(
    `document.querySelector('img[alt="Ảnh đại diện đang căn chỉnh"]').style.left !== ${JSON.stringify(beforePan)}`,
    "touch panning",
  );
  assert.equal(
    await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`),
    true,
  );
  assert.equal(
    await page.evaluate(
      `(() => { const dialogs=[...document.querySelectorAll('[role=dialog]')]; return dialogs.every(d=>{ const r=d.getBoundingClientRect(); return r.left>=-1 && r.right<=innerWidth+1 && r.top>=-1 && r.bottom<=innerHeight+1; }); })()`,
    ),
    true,
  );
  await mkdir(artifacts, { recursive: true });
  const screenshot = await page.send("Page.captureScreenshot", {
    format: "png",
  });
  await writeFile(
    path.join(artifacts, "profile-crop-mobile.png"),
    Buffer.from(screenshot.data, "base64"),
  );
  await page.click("Hủy", cropTitle);
  await page.waitFor(`!(${dialogOpen(cropTitle)})`, "mobile crop cancel");
  await page.click("Xóa ảnh đại diện", editorTitle);
  await page.click("Lưu thay đổi", editorTitle);
  await page.waitFor(`!(${dialogOpen(editorTitle)})`, "avatar removal");
  assert.equal((await api("/users/me", { token })).body.avatar_url, null);
  pass(
    "mobile crop supports touch panning, fits the viewport and avatar removal persists",
  );

  await page.click(editorTitle);
  await page.fill("#profile-display_name", "Bản nháp khi hết phiên");
  faults.expired = true;
  faults.refresh = true;
  await page.click("Lưu thay đổi", editorTitle);
  await page.waitFor(
    `(${dialogOpen(editorTitle)}) && [...document.querySelectorAll('[role=alert]')].some(e=>e.textContent.includes('hết hạn'))`,
    "ended session retains editor",
  );
  assert.equal(
    await page.evaluate(
      `document.querySelector('#profile-display_name').value`,
    ),
    "Bản nháp khi hết phiên",
  );
  assert.equal(
    await page.evaluate(
      `document.querySelector('button[type=submit]').disabled`,
    ),
    true,
  );
  assert.equal(
    (await api("/users/me", { token })).body.display_name,
    "Sau khi làm mới phiên",
  );
  assert.deepEqual(protocolErrors, []);
  assert.deepEqual(browserErrors, []);
  pass(
    "refresh failure keeps unsaved data, disables saving and does not change the persisted profile",
  );
  console.log(`Live Profile Editing checks passed: ${results.length}`);
  console.log(`Screenshot: ${path.join(artifacts, "profile-crop-mobile.png")}`);
} catch (error) {
  if (browser) {
    const diagnostic = await browser.client
      .evaluate(
        `({path:location.pathname, alerts:[...document.querySelectorAll('[role=alert],[data-sonner-toast],form p')].map(e=>e.textContent), dialogTitles:[...document.querySelectorAll('[role=dialog] h2')].map(e=>e.textContent), heading:document.querySelector('h1')?.textContent, inputLengths:[...document.querySelectorAll('input')].map(e=>({type:e.type,length:e.value.length}))})`,
      )
      .catch(() => ({ unavailable: true }));
    console.error("Profile test diagnostic:", JSON.stringify(diagnostic));
  }
  throw error;
} finally {
  try {
    await browser?.close();
  } catch {
    console.error("Browser cleanup failed; fixture cleanup will still run.");
  }
  // Only remove the unique fixture accounts created by this run; never touch other users.
  await pool.query(
    "DELETE FROM users WHERE email = ANY($1::text[]) AND email LIKE 'profile-check-%@example.invalid'",
    [emails],
  );
  const remaining = await pool.query(
    "SELECT count(*)::int AS count FROM users WHERE email = ANY($1::text[])",
    [emails],
  );
  assert.equal(
    remaining.rows[0].count,
    0,
    "Fixture accounts must be removed after the run.",
  );
  const uploadRoot = path.resolve(backend, settings.UPLOAD_DIR || "uploads");
  for (const url of uploadedUrls) {
    const suffix = new URL(url).pathname.match(
      /\/uploads\/([0-9a-f]{2}\/[0-9a-f]{32}\.webp)$/,
    )?.[1];
    if (!suffix) continue;
    const file = path.resolve(uploadRoot, suffix);
    if (!file.startsWith(`${uploadRoot}${path.sep}`))
      throw new Error("Unexpected upload cleanup path.");
    const info = await stat(file).catch(() => null);
    if (info && info.birthtimeMs >= startedAt) await unlink(file);
  }
  await pool.end();
  const target = path.resolve(directory);
  if (
    path.dirname(target) !== path.resolve(tmpdir()) ||
    !path.basename(target).startsWith("wandermap-profile-fixtures-")
  ) {
    throw new Error("Unexpected fixture cleanup directory.");
  }
  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
