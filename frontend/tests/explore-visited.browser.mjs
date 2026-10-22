// Node 22+, Chrome, local web/API running. Browser API traffic is mocked; no database writes.
// Explore's server render only reads public trending locations from the configured backend.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";

const web = process.env.WANDERMAP_TEST_WEB_URL;
assert.ok(
  web && ["localhost", "127.0.0.1"].includes(new URL(web).hostname),
  "Explicit local web URL required",
);
const profile = await mkdtemp(join(tmpdir(), "wandermap-explore-visited-"));
const artifacts = await mkdtemp(
  join(tmpdir(), "wandermap-explore-visited-shots-"),
);
const chrome = spawn(
  process.env.WANDERMAP_BROWSER_PATH ??
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  [
    "--headless=new",
    "--enable-unsafe-swiftshader",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const pause = (ms = 150) => new Promise((r) => setTimeout(r, ms));
async function until(check, label) {
  const end = Date.now() + 90_000;
  while (Date.now() < end) {
    if (await check()) return;
    await pause();
  }
  throw new Error(`Timed out: ${label}`);
}
const userId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const existingId = "33333333-3333-4333-8333-333333333333";
const user = {
  id: userId,
  username: "visited_test",
  display_name: "Người đi tìm kỷ niệm",
  avatar_url: null,
  cover_url: null,
  bio: null,
  post_count: 0,
  follower_count: 0,
  following_count: 0,
  country_count: 0,
  email: "visited@example.test",
};
const place = {
  key: "osm:W123456789",
  name: "Hồ ký ức không có ảnh",
  address: "Đường ven hồ, Đà Lạt",
  city: "Đà Lạt",
  country: "Việt Nam",
  coordinates: { lat: 11.94, lng: 108.458 },
  category: "other",
  kind: "natural:water",
};
const location = {
  ...place,
  id: locationId,
  google_place_id: place.key,
  post_count: 0,
  avg_rating: null,
  trending_score: 0,
  created_at: "2026-01-01T00:00:00Z",
};
const existing = {
  ...location,
  id: existingId,
  name: "Địa điểm WanderMap chưa có bài",
  google_place_id: "osm:N2468",
};
const journey = {
  id: userId,
  user_id: userId,
  title: "Hành trình ký ức",
  description: null,
  cover_image_url: null,
  visibility: "private",
  status: "draft",
  revision: 1,
  author: user,
  stops: [],
  style_config: {
    version: 1,
    line_color: "#22c55e",
    line_style: "solid",
    show_labels: true,
    show_order: true,
    map_style: "outdoors-v12",
  },
};
const marks = [];
const writes = [],
  checks = [],
  errors = [];
let socket, send, evaluate;
let failLocation = false,
  failMark = false,
  holdLocation = false,
  heldRequest;
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
  const page = await (
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
      method: "PUT",
    })
  ).json();
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, reject) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  send = (method, params = {}) =>
    new Promise((done, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30_000);
      pending.set(id, { done, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const fulfill = (requestId, body, status = 200) =>
    send("Fetch.fulfillRequest", {
      requestId,
      responseCode: status,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64"),
    });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.text);
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const url = new URL(request.url),
        path = url.pathname;
      const body = request.postData ? JSON.parse(request.postData) : undefined;
      if (
        !["GET", "HEAD"].includes(request.method) &&
        !path.endsWith("/auth/refresh")
      )
        writes.push({ path, body, method: request.method });
      let result = {},
        status = 200;
      if (path.endsWith("/auth/refresh"))
        result = { accessToken: "test-only-access", expiresIn: 900 };
      else if (path.endsWith("/users/me")) result = user;
      else if (path.endsWith("/places/search"))
        result = {
          existing: [existing],
          external: [place],
          externalAvailable: true,
        };
      else if (path.endsWith("/locations") && request.method === "POST") {
        if (holdLocation) {
          heldRequest = requestId;
          return;
        }
        if (failLocation) {
          failLocation = false;
          status = 503;
          result = { message: "test connection failure" };
        } else result = location;
      } else if (
        path.endsWith("/visited-locations") &&
        request.method === "POST"
      ) {
        if (failMark) {
          failMark = false;
          status = 503;
          result = { message: "test connection failure" };
        } else {
          result = {
            id: "44444444-4444-4444-8444-444444444444",
            user_id: userId,
            ...body,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            last_visited_at: body.visited_at,
            visit_count: body.visited_at ? 1 : 0,
            location,
          };
          marks.splice(0, marks.length, result);
        }
      } else if (path.endsWith("/visited-locations")) {
        const rows = url.searchParams.has("location_id")
          ? marks.filter(
              (m) => m.location_id === url.searchParams.get("location_id"),
            )
          : marks;
        result = {
          data: rows,
          count: rows.length,
          page: 1,
          pageSize: 20,
          hasMore: false,
        };
      } else if (path.endsWith("/visits"))
        result = { data: [], count: 0, page: 1, pageSize: 10, hasMore: false };
      else if (path.includes("/journeys/")) result = journey;
      else if (path.includes("/locations/")) result = [];
      else if (path.includes("unread")) result = { count: 0 };
      void fulfill(requestId, result, status);
    }
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      clearTimeout(entry.timer);
      message.error
        ? entry.reject(new Error(message.error.message))
        : entry.done(message.result);
    }
  });
  evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails)
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text,
      );
    return response.result.value;
  };
  const clickText = (text) =>
    evaluate(
      `(()=>{const el=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!el||el.disabled)throw new Error('Missing '+${JSON.stringify(text)});el.focus();el.click()})()`,
    );
  const click = (selector) =>
    evaluate(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)throw new Error('Missing '+${JSON.stringify(selector)});el.focus();el.click()})()`,
    );
  const fill = async (selector, text) => {
    await until(
      () =>
        evaluate(
          `(()=>{const el=document.querySelector(${JSON.stringify(selector)});return !!el && Object.keys(el).some(k=>k.startsWith('__reactProps$'))})()`,
        ),
      "input hydration",
    );
    await evaluate(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.select()})()`,
    );
    await send("Input.insertText", { text });
    await until(
      () =>
        evaluate(
          `document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(text)}`,
        ),
      "input value",
    );
  };
  const selectResult = async (name) => {
    await fill('input[aria-label="Tìm kiếm địa điểm"]', "ký ức");
    await until(
      () =>
        evaluate(
          `[...document.querySelectorAll('button')].some(b=>b.textContent.includes(${JSON.stringify(name)}))`,
        ),
      "search results",
    );
    await evaluate(
      `(()=>{const el=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(name)}));el.click()})()`,
    );
    await until(
      () =>
        evaluate(
          `!!document.querySelector('.mapboxgl-marker button[aria-haspopup="dialog"]')`,
        ),
      "search pin actions",
    );
    await pause(1300); // flyTo finishes before pointer/bounds checks
  };
  const capture = async (name) => {
    const image = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(artifacts, name), Buffer.from(image.data, "base64"));
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.bringToFront");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/v1/*" }] });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: `${web}/explore` });
  await until(
    () =>
      evaluate(
        `!!document.querySelector('input[aria-label="Tìm kiếm địa điểm"]')`,
      ),
    "Explore",
  );
  await until(
    () => evaluate("!!document.querySelector('.mapboxgl-canvas')"),
    "hydrated map",
  );
  await pause(500);
  // Client guard test: fixture search results are supplied even to this anonymous test browser.
  await selectResult(place.name);
  assert.equal(writes.length, 0, "Selecting a place must not write anything");
  await clickText("Đánh dấu đã đến");
  await until(
    () =>
      evaluate(
        "document.body.innerText.includes('Đăng nhập để lưu những địa điểm')",
      ),
    "guest auth prompt",
  );
  assert.equal(writes.length, 0);
  checks.push(
    "Search/selection and anonymous mark attempts never create a location or visit",
  );
  await evaluate(
    `localStorage.setItem('wandermap-auth',JSON.stringify({state:{profile:${JSON.stringify(user)}},version:0}))`,
  );
  await send("Page.reload", { ignoreCache: true });
  await until(
    () => evaluate(`!!document.querySelector('a[aria-label="Hồ sơ cá nhân"]')`),
    "restore fixture session",
  );
  await selectResult(place.name);
  failLocation = true;
  await clickText("Đánh dấu đã đến");
  await until(
    () => evaluate("document.body.innerText.includes('Thử đánh dấu lại')"),
    "location error",
  );
  assert.equal(
    await evaluate("document.body.innerText.includes('Hồ ký ức không có ảnh')"),
    true,
  );
  await clickText("Thử đánh dấu lại");
  await until(
    () => evaluate("!!document.querySelector('#marked-visit-date')"),
    "visited form opens automatically",
  );
  assert.equal(
    await evaluate("document.querySelector('#marked-visit-date').value"),
    "",
  );
  assert.equal(
    await evaluate("document.querySelector('input[value=private]').checked"),
    true,
  );
  await fill("#marked-note", "Kỷ niệm từ nhiều năm trước, không còn ảnh.");
  failMark = true;
  await click('button[form="visited-location-form"][type="submit"]');
  await until(
    () =>
      evaluate(
        `!!document.querySelector('#visited-location-form [role="alert"]')`,
      ),
    "mark failure",
  );
  assert.equal(
    await evaluate("document.querySelector('#marked-note').value"),
    "Kỷ niệm từ nhiều năm trước, không còn ảnh.",
  );
  await click('button[form="visited-location-form"][type="submit"]');
  await until(
    () => evaluate("!document.querySelector('#visited-location-form')"),
    "mark saved",
  );
  await until(
    () => evaluate("document.body.innerText.includes('Đã ghé thăm')"),
    "visited button updated",
  );
  assert.deepEqual(
    writes.filter((w) => w.path.endsWith("/locations"))[1].body,
    {
      name: place.name,
      address: place.address,
      coordinates: place.coordinates,
      city: place.city,
      country: place.country,
      category: place.category,
      google_place_id: place.key,
    },
  );
  assert.deepEqual(
    writes.filter((w) => w.path.endsWith("/visited-locations")).at(-1).body,
    {
      note: "Kỷ niệm từ nhiều năm trước, không còn ảnh.",
      visibility: "private",
      location_id: locationId,
      visited_at: null,
    },
  );
  checks.push(
    "External place resolves by OSM key; undated private mark saves without posts/images; both errors retry without losing input",
  );
  await capture("desktop-visited-search.png");
  const marksBefore = writes.filter((w) =>
    w.path.endsWith("/visited-locations"),
  ).length;
  await selectResult(place.name);
  await click('.mapboxgl-marker button[aria-haspopup="dialog"]');
  await until(
    () =>
      evaluate("document.body.innerText.includes('Một nơi, nhiều kỷ niệm')"),
    "existing mark reopened",
  );
  assert.equal(
    writes.filter((w) => w.path.endsWith("/visited-locations")).length,
    marksBefore,
  );
  await click('button[aria-label="Đóng quản lý địa điểm đã đến"]');
  const createsBefore = writes.filter((w) =>
    w.path.endsWith("/locations"),
  ).length;
  await selectResult(existing.name);
  await clickText("Đánh dấu đã đến");
  await until(
    () => evaluate("!!document.querySelector('#marked-visit-date')"),
    "existing location form",
  );
  assert.equal(
    writes.filter((w) => w.path.endsWith("/locations")).length,
    createsBefore,
  );
  await click('button[aria-label="Đóng quản lý địa điểm đã đến"]');
  checks.push(
    "Re-selecting an already marked OSM place opens its existing history; existing WanderMap results skip location creation",
  );
  holdLocation = true;
  await selectResult(place.name);
  await clickText("Đánh dấu đã đến");
  await until(() => !!heldRequest, "delayed resolution");
  await selectResult(existing.name);
  holdLocation = false;
  await fulfill(heldRequest, location);
  await pause(500);
  assert.equal(
    await evaluate("!!document.querySelector('[role=dialog]')"),
    false,
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.mapboxgl-marker').innerText.includes('Địa điểm WanderMap chưa có bài')",
    ),
    true,
  );
  checks.push(
    "A late resolution for an old search pin cannot open or overwrite the newly selected place",
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 850,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await evaluate("localStorage.setItem('theme','dark')");
  await send("Page.reload", { ignoreCache: true });
  await until(
    () => evaluate(`!!document.querySelector('a[aria-label="Hồ sơ cá nhân"]')`),
    "mobile auth",
  );
  await selectResult(existing.name);
  assert.equal(
    await evaluate("document.documentElement.scrollWidth > innerWidth"),
    false,
  );
  await capture("mobile-dark-search.png");
  await clickText("Đánh dấu đã đến");
  await until(
    () => evaluate("!!document.querySelector('#marked-visit-date')"),
    "mobile mark form",
  );
  await capture("mobile-dark-mark-form.png");
  await click('button[aria-label="Đóng quản lý địa điểm đã đến"]');
  checks.push(
    "320px mobile/dark search card and reused mark form remain usable",
  );
  await send("Page.navigate", { url: `${web}/journey/${userId}` });
  await until(
    () => evaluate("document.body.innerText.includes('Chỉnh sửa')"),
    "journey detail",
  );
  await clickText("Chỉnh sửa");
  await until(
    () =>
      evaluate(
        `[...document.querySelectorAll('[role=dialog] button')].some(b=>b.textContent.trim()===${JSON.stringify(place.name)})`,
      ),
    "new place in journey picker",
  );
  await clickText(place.name);
  await until(
    () =>
      evaluate(
        `!!document.querySelector('button[aria-label="Kéo để sắp xếp ${place.name}"]')`,
      ),
    "selected stop without any posts",
  );
  assert.ok(
    writes.every(
      (w) =>
        w.path.endsWith("/locations") || w.path.endsWith("/visited-locations"),
    ),
    "No post, upload or journey write allowed",
  );
  assert.equal(marks.length, 1);
  assert.equal(marks[0].location.post_count, 0);
  checks.push(
    "The new undated location with zero posts is selectable as a Journey stop",
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, artifacts }, null, 2));
} catch (error) {
  if (send && evaluate) {
    const image = await send("Page.captureScreenshot", { format: "png" }).catch(
      () => null,
    );
    if (image)
      await writeFile(
        join(artifacts, "failure.png"),
        Buffer.from(image.data, "base64"),
      );
    console.error(
      JSON.stringify({
        artifacts,
        text: await evaluate("document.body.innerText.slice(-2000)").catch(
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
  assert.ok(basename(profile).startsWith("wandermap-explore-visited-"));
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 300,
  });
}
