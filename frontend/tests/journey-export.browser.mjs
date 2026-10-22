// Node 22+, Chrome. API fixtures are intercepted; Mapbox/WebGL/fonts and PNG downloads are real.
// No database writes or production debug hooks. Set WANDERMAP_EXPORT_TEST_WEB_URL to a local web server.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import sharp from "sharp";

const web = process.env.WANDERMAP_EXPORT_TEST_WEB_URL;
assert.ok(
  web && ["localhost", "127.0.0.1"].includes(new URL(web).hostname),
  "Explicit localhost test URL required",
);
const profile = await mkdtemp(join(tmpdir(), "wandermap-export-browser-"));
const artifacts = await mkdtemp(join(tmpdir(), "wandermap-export-artifacts-"));
const chrome = spawn(
  process.env.WANDERMAP_BROWSER_PATH ??
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  [
    "--headless=new",
    "--enable-unsafe-swiftshader",
    ...(process.env.WANDERMAP_EXPORT_TEST_ANGLE
      ? [`--use-angle=${process.env.WANDERMAP_EXPORT_TEST_ANGLE}`]
      : []),
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const pause = (ms = 200) => new Promise((done) => setTimeout(done, ms));
async function until(check, label, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await pause();
  }
  throw new Error(`Timed out: ${label}`);
}
const id = "11111111-1111-4111-8111-111111111111";
const profileData = {
  id,
  username: "export_test",
  display_name: "Người lưu ký ức",
  avatar_url: null,
  cover_url: null,
  bio: null,
  post_count: 0,
  follower_count: 0,
  following_count: 0,
  country_count: 0,
};
const style = {
  version: 1,
  line_color: "#16a34a",
  line_style: "dashed",
  show_labels: true,
  show_order: true,
  map_style: "outdoors-v12",
};
let fixture = {
  id,
  user_id: id,
  title: "Một dải ký ức miền Trung",
  description: "Kỷ niệm",
  cover_image_url: "https://image.invalid/no-cors.jpg",
  visibility: "private",
  status: "draft",
  revision: 1,
  author: profileData,
  style_config: style,
  stops: [
    ["Đà Lạt", 108.458, 11.94],
    ["Nha Trang", 109.196, 12.238],
    ["Đà Nẵng", 108.202, 16.054],
  ].map(([name, lng, lat], i) => ({
    id: `stop-${i}`,
    location_id: `22222222-2222-4222-8222-22222222222${i}`,
    stop_order: i + 1,
    location_name_snapshot: name,
    visited_at_snapshot: `2026-01-0${i + 1}`,
    location: {
      id: `place-${i}`,
      name,
      city: name,
      country: "Việt Nam",
      coordinates: { lng, lat },
    },
  })),
};
let socket, send, evaluate;
let blockMapbox = false;
const mutations = [],
  exceptions = [],
  checks = [];
try {
  let port;
  await until(async () => {
    try {
      port = (
        await readFile(join(profile, "DevToolsActivePort"), "utf8")
      ).split("\n")[0];
      return !!port;
    } catch {
      return false;
    }
  }, "Chrome");
  const target = await (
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
      method: "PUT",
    })
  ).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  send = (method, params = {}) =>
    new Promise((done, reject) => {
      const requestId = ++sequence;
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30_000);
      pending.set(requestId, { done, reject, timeout });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown")
      exceptions.push(message.params.exceptionDetails.text);
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const path = new URL(request.url).pathname;
      if (request.url.includes("api.mapbox.com")) {
        void send(blockMapbox ? "Fetch.failRequest" : "Fetch.continueRequest", {
          requestId,
          ...(blockMapbox ? { errorReason: "Failed" } : {}),
        });
      } else {
        if (
          !["GET", "HEAD"].includes(request.method) &&
          !path.endsWith("/auth/refresh")
        )
          mutations.push(`${request.method} ${path}`);
        const body = path.endsWith("/auth/refresh")
          ? { accessToken: "test-only-token", expiresIn: 900 }
          : path.endsWith("/users/me")
            ? { ...profileData, email: "export@example.test" }
            : path.includes("/journeys/")
              ? fixture
              : path.endsWith("/visited-locations")
                ? { data: [], count: 0, page: 1, pageSize: 20, hasMore: false }
                : path.includes("unread")
                  ? { count: 0 }
                  : {};
        void send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "application/json" },
          ],
          body: Buffer.from(JSON.stringify(body)).toString("base64"),
        });
      }
    }
    const waiting = pending.get(message.id);
    if (waiting) {
      pending.delete(message.id);
      clearTimeout(waiting.timeout);
      message.error
        ? waiting.reject(new Error(message.error.message))
        : waiting.done(message.result);
    }
  });
  evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    return result.result.value;
  };
  const click = (selector) =>
    evaluate(
      `(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el || el.disabled) throw new Error('Missing or disabled '+${JSON.stringify(selector)}); el.click(); })()`,
    );
  const clickText = (text) =>
    evaluate(
      `(() => { const el=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!el || el.disabled) throw new Error('Missing '+${JSON.stringify(text)}); el.click(); })()`,
    );
  const ready = async () => {
    await until(
      () =>
        evaluate(
          `!!document.querySelector('img[alt^="Poster hành trình"]') || !!document.querySelector('[role="dialog"] [role="alert"]')`,
        ),
      "poster or error",
    );
    const error = await evaluate(
      `document.querySelector('[role="dialog"] [role="alert"]')?.innerText`,
    );
    assert.ok(!error, error);
    return evaluate(
      `document.querySelector('img[alt^="Poster hành trình"]').decode().then(()=>{const i=document.querySelector('img[alt^="Poster hành trình"]');return [i.naturalWidth,i.naturalHeight]})`,
    );
  };
  const capture = async (name) => {
    const image = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(artifacts, name), Buffer.from(image.data, "base64"));
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.bringToFront");
  await send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: artifacts,
  });
  await send("Fetch.enable", {
    patterns: [
      { urlPattern: "*/api/v1/*" },
      { urlPattern: "*://api.mapbox.com/*" },
    ],
  });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
    localStorage.setItem('wandermap-auth', JSON.stringify({state:{profile:${JSON.stringify(profileData)}},version:0}));
    window.exportURLs=new Set();
    const create=URL.createObjectURL.bind(URL), revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=(blob)=>{const url=create(blob);if(blob.type==='image/png')window.exportURLs.add(url);return url;};
    URL.revokeObjectURL=(url)=>{window.exportURLs.delete(url);return revoke(url);};
  `,
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: `${web}/journey/${id}` });
  await until(
    () =>
      evaluate(
        `!!document.querySelector('button[aria-label="Xuất ảnh hành trình"]')`,
      ),
    "journey detail",
  );
  await click('button[aria-label="Xuất ảnh hành trình"]');
  assert.deepEqual(await ready(), [1600, 1600]);
  await capture("desktop-square.png");
  await clickText("Tải PNG");
  await until(
    async () =>
      (await readdir(artifacts)).some((name) => name.endsWith("1x1.png")),
    "PNG download",
  );
  const filename = (await readdir(artifacts)).find((name) =>
    name.endsWith("1x1.png"),
  );
  const png = await readFile(join(artifacts, filename));
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 1600);
  assert.equal(meta.height, 1600);
  assert.equal(meta.format, "png");
  const stats = await sharp(png)
    .extract({ left: 48, top: 352, width: 1504, height: 900 })
    .stats();
  assert.ok(
    stats.channels[0].stdev > 12,
    "Map pixels must contain real rendered data",
  );
  checks.push(
    "Real Mapbox/WebGL square poster, PNG file, nonblank map, inaccessible cover excluded",
  );
  await click('input[value="4:5"]');
  console.log("Square PNG verified; rendering portrait");
  assert.deepEqual(await ready(), [1600, 2000]);
  checks.push("Portrait ratio regenerates the actual 1600×2000 PNG");
  await click('button[aria-label="Đóng xuất ảnh"]');
  await until(
    () => evaluate("window.exportURLs.size===0"),
    "revoke preview URL",
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[aria-hidden=true] .mapboxgl-map').length",
    ),
    0,
  );

  // Error/retry does not mutate or remove the parent journey.
  blockMapbox = true;
  console.log("Portrait verified; checking map errors and retry");
  await click('button[aria-label="Xuất ảnh hành trình"]');
  await until(
    () =>
      evaluate(`!!document.querySelector('[role="dialog"] [role="alert"]')`),
    "map network error",
  );
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Tải PNG').disabled`,
    ),
    true,
  );
  blockMapbox = false;
  await clickText("Thử lại");
  await ready();
  await click('button[aria-label="Đóng xuất ảnh"]');
  checks.push(
    "Map network failure shows an error, disables download, and retries successfully",
  );

  // Browser blocks a tainted canvas: error must be explained and retry must recover.
  console.log("Checking canvas security failure");
  await evaluate(
    `window.originalToBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(){throw new DOMException('test cross-origin','SecurityError')}`,
  );
  await click('button[aria-label="Xuất ảnh hành trình"]');
  await until(
    () =>
      evaluate(
        `document.querySelector('[role="dialog"] [role="alert"]')?.innerText.includes('quyền truy cập nguồn ảnh')`,
      ),
    "cross-origin error",
  );
  await evaluate("HTMLCanvasElement.prototype.toBlob=window.originalToBlob");
  await clickText("Thử lại");
  await ready();
  await click('button[aria-label="Đóng xuất ảnh"]');
  checks.push(
    "Canvas SecurityError is recoverable and no partial image is offered",
  );

  // Builder snapshot exports unsaved metadata; nested Escape returns to the dirty form.
  console.log("Checking unsaved Builder state");
  await clickText("Chỉnh sửa");
  await until(
    () => evaluate(`!!document.querySelector('input[name="title"]')`),
    "builder",
  );
  await evaluate(
    `(()=>{const el=document.querySelector('input[name="title"]');el.focus();el.select()})()`,
  );
  await send("Input.insertText", { text: "Bản nháp chưa lưu 🌿" });
  await click('button[aria-label="Xuất ảnh hành trình"]');
  await ready();
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await until(
    () =>
      evaluate(
        `document.querySelector('input[name="title"]')?.value==='Bản nháp chưa lưu 🌿' && !document.querySelector('img[alt^="Poster hành trình"]')`,
      ),
    "unsaved form after Escape",
  );
  checks.push(
    "Export uses unsaved Builder data; Escape preserves the form without saving/publishing",
  );
  await until(
    () =>
      evaluate(
        `document.activeElement?.getAttribute('aria-label') === 'Xuất ảnh hành trình'`,
      ),
    "focus returns to export button",
  );
  await click('button[aria-label="Đóng trình tạo hành trình"]');
  await clickText("Bỏ thay đổi");
  await until(
    () => evaluate("!document.querySelector('input[name=title]')"),
    "close dirty Builder before reload",
  );

  // Mobile/retina, busy antimeridian route, dark style and very long title.
  console.log("Checking mobile/retina antimeridian export");
  fixture = {
    ...fixture,
    title: "Hành trình qua kinh tuyến 180° 🌏 ".repeat(5).slice(0, 190),
    style_config: { ...style, map_style: "dark-v11" },
    stops: Array.from({ length: 30 }, (_, i) => ({
      ...fixture.stops[i % 3],
      id: `many-${i}`,
      location_id: `place-${i}`,
      stop_order: i + 1,
      visited_at_snapshot: i === 0 ? null : "2026-01-01",
      location_name_snapshot: `Kỷ niệm số ${i + 1}`,
      location: {
        ...fixture.stops[0].location,
        coordinates: {
          lng: i % 2 ? -179 + i / 50 : 179 - i / 50,
          lat: 10 + i / 10,
        },
      },
    })),
  };
  await send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 900,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await send("Page.reload", { ignoreCache: true });
  await until(
    () =>
      evaluate(
        `!!document.querySelector('button[aria-label="Xuất ảnh hành trình"]')`,
      ),
    "mobile detail",
  );
  await click('button[aria-label="Xuất ảnh hành trình"]');
  await until(
    () => evaluate(`!!document.querySelector('input[value="4:5"]')`),
    "export controls after lazy import",
  );
  await click('input[value="4:5"]');
  assert.deepEqual(await ready(), [1600, 2000]);
  assert.equal(
    await evaluate("document.documentElement.scrollWidth > innerWidth"),
    false,
  );
  await capture("mobile-dark-portrait.png");
  await clickText("Tải PNG");
  await until(
    async () =>
      (await readdir(artifacts)).some((name) => name.endsWith("4x5.png")),
    "retina portrait download",
  );
  checks.push(
    "320px mobile, DPR 2, dark map, 30 stops across antimeridian, long Unicode title",
  );

  // Cancel while fonts never finish: job and offscreen map must not outlive the dialog.
  await click('button[aria-label="Đóng xuất ảnh"]');
  await evaluate(
    "window.originalFontsLoad=document.fonts.load.bind(document.fonts);document.fonts.load=()=>new Promise(()=>{})",
  );
  await click('button[aria-label="Xuất ảnh hành trình"]');
  await pause(400);
  await click('button[aria-label="Đóng xuất ảnh"]');
  await evaluate("document.fonts.load=window.originalFontsLoad");
  await pause(300);
  assert.equal(await evaluate("window.exportURLs.size"), 0);
  assert.equal(
    await evaluate(
      "document.querySelectorAll('body > div[aria-hidden=true]').length",
    ),
    0,
  );
  checks.push(
    "Cancel while fonts load cleans up without stale previews or hidden map containers",
  );
  assert.deepEqual(mutations, [], "Export must not save, upload or publish");
  assert.deepEqual(exceptions, [], "No uncaught exceptions");
  console.log(JSON.stringify({ checks, artifacts }, null, 2));
} catch (error) {
  if (send && evaluate) {
    const screenshot = await send("Page.captureScreenshot", {
      format: "png",
    }).catch(() => null);
    if (screenshot)
      await writeFile(
        join(artifacts, "failure.png"),
        Buffer.from(screenshot.data, "base64"),
      );
    console.error(
      JSON.stringify({
        artifacts,
        page: await evaluate("document.body.innerText.slice(-2000)").catch(
          () => "unavailable",
        ),
      }),
    );
  }
  throw error;
} finally {
  socket?.close();
  chrome.kill();
  await pause(500);
  assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
  assert.ok(basename(profile).startsWith("wandermap-export-browser-"));
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 300,
  });
}
