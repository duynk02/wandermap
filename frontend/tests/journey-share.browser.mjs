// Node 22+, Chrome, local web/API. Browser APIs are fixtures; Mapbox/WebGL and image capture are real.
// No database mutations: all /api/v1 writes are intercepted.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import sharp from "sharp";

const web = process.env.WANDERMAP_TEST_WEB_URL;
assert.ok(
  web && ["localhost", "127.0.0.1"].includes(new URL(web).hostname),
  "Explicit local web URL required",
);
const profile = await mkdtemp(join(tmpdir(), "wandermap-journey-share-"));
const artifacts = await mkdtemp(
  join(tmpdir(), "wandermap-journey-share-shots-"),
);
const chrome = spawn(
  process.env.WANDERMAP_BROWSER_PATH ??
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  [
    "--headless=new",
    "--enable-unsafe-swiftshader",
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
const pause = (ms = 150) => new Promise((done) => setTimeout(done, ms));
async function until(check, label, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await pause();
  }
  throw new Error(`Timed out: ${label}`);
}
const id = "11111111-1111-4111-8111-111111111111";
const postId = "44444444-4444-4444-8444-444444444444";
const user = {
  id,
  username: "share_test",
  display_name: "Người kể hành trình",
  avatar_url: null,
  cover_url: null,
  bio: null,
  total_posts: 0,
  total_followers: 0,
  total_following: 0,
};
const imageUrl = `${web}/share-test-preview.png`;
const png = await sharp({
  create: { width: 600, height: 600, channels: 3, background: "#22c55e" },
})
  .png()
  .toBuffer();
let journey = {
  id,
  user_id: id,
  title: "Đà Lạt đến Đà Nẵng",
  description: null,
  cover_image_url: imageUrl,
  visibility: "private",
  status: "draft",
  revision: 1,
  author: user,
  style_config: {
    version: 1,
    line_color: "#22c55e",
    line_style: "solid",
    show_labels: true,
    show_order: true,
    map_style: "outdoors-v12",
  },
  stops: [
    ["Đà Lạt", 108.458, 11.94],
    ["Nha Trang", 109.196, 12.238],
    ["Đà Nẵng", 108.202, 16.054],
  ].map(([name, lng, lat], i) => ({
    id: `stop-${i}`,
    location_id: `22222222-2222-4222-8222-22222222222${i}`,
    stop_order: i + 1,
    location_name_snapshot: name,
    visited_at_snapshot: null,
    location: {
      id: `place-${i}`,
      name,
      city: name,
      country: "Việt Nam",
      coordinates: { lng, lat },
    },
  })),
};
let shared = null,
  loseResponse = true,
  conflictOnce = false,
  blockMapbox = false,
  socket,
  send,
  evaluate;
const mutations = [],
  checks = [],
  errors = [];
const normal = {
  id: "55555555-5555-4555-8555-555555555555",
  author_id: id,
  post_type: "location",
  location_id: id,
  content: "Bài đăng địa điểm vẫn hoạt động",
  images: [],
  rating: 4,
  visited_at: "2026-01-01",
  visibility: "public",
  likes_count: 0,
  saves_count: 0,
  comments_count: 0,
  created_at: new Date().toISOString(),
  author: user,
  location: { id, name: "Địa điểm thông thường" },
};
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
  let seq = 0;
  const pending = new Map();
  send = (method, params = {}) =>
    new Promise((done, reject) => {
      const requestId = ++seq;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`CDP timeout ${method}`));
      }, 30000);
      pending.set(requestId, { done, reject, timer });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const waiting = pending.get(message.id);
    if (waiting) {
      pending.delete(message.id);
      clearTimeout(waiting.timer);
      message.error
        ? waiting.reject(new Error(message.error.message))
        : waiting.done(message.result);
    }
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.text);
    if (message.method !== "Fetch.requestPaused") return;
    void (async () => {
      const { requestId, request } = message.params;
      const path = new URL(request.url).pathname;
      if (request.url.includes("api.mapbox.com"))
        return send(
          blockMapbox ? "Fetch.failRequest" : "Fetch.continueRequest",
          { requestId, ...(blockMapbox ? { errorReason: "Failed" } : {}) },
        );
      if (path === "/share-test-preview.png")
        return send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "image/png" }],
          body: png.toString("base64"),
        });
      const write =
        !["GET", "HEAD"].includes(request.method) &&
        !path.endsWith("/auth/refresh");
      if (write)
        mutations.push({
          method: request.method,
          path,
          body: request.postData,
        });
      let body = {},
        code = 200;
      if (path.endsWith("/auth/refresh"))
        body = { accessToken: "test-only-token", expiresIn: 900 };
      else if (path.endsWith("/users/me")) body = user;
      else if (path.includes("/journeys/")) body = journey;
      else if (path.includes("/posts/journey/")) body = { post: shared };
      else if (path.endsWith("/uploads/images")) {
        body = { url: imageUrl, width: 1600, height: 1600, bytes: 10000 };
        code = 201;
      } else if (path.endsWith("/posts/journey") && request.method === "POST") {
        const input = JSON.parse(request.postData);
        if (conflictOnce) {
          conflictOnce = false;
          journey = {
            ...journey,
            revision: journey.revision + 1,
            title: "Hành trình mới từ cửa sổ khác",
          };
          return send("Fetch.fulfillRequest", {
            requestId,
            responseCode: 409,
            responseHeaders: [
              { name: "Content-Type", value: "application/json" },
            ],
            body: Buffer.from(
              JSON.stringify({
                message: "Hành trình đã thay đổi. Hãy tải lại preview.",
              }),
            ).toString("base64"),
          });
        }
        shared ??= {
          id: postId,
          author_id: id,
          post_type: "journey",
          journey_id: id,
          preview_revision: journey.revision,
          content: input.content,
          images: [input.preview_image_url],
          rating: null,
          visited_at: null,
          location_id: null,
          location: null,
          visibility: "public",
          likes_count: 0,
          saves_count: 0,
          comments_count: 0,
          is_liked: false,
          is_saved: false,
          created_at: new Date().toISOString(),
          author: user,
          journey: {
            id,
            title: journey.title,
            revision: journey.revision,
            status: journey.status,
            visibility: journey.visibility,
            stop_count: 3,
            preview_names: journey.stops.map((s) => s.location_name_snapshot),
          },
        };
        await pause(500);
        code = loseResponse ? 500 : 201;
        body = loseResponse
          ? { message: "Response lost after commit" }
          : { post: shared, created: true };
        loseResponse = false;
      } else if (path.endsWith("/posts/feed"))
        body = {
          data: shared ? [shared, normal] : [normal],
          count: shared ? 2 : 1,
          page: 1,
          pageSize: 12,
          hasMore: false,
        };
      else if (path.endsWith(`/posts/${postId}`)) body = shared;
      else if (path.endsWith("/like")) {
        shared.is_liked = request.method === "POST";
        shared.likes_count = +shared.is_liked;
        body = { liked: shared.is_liked, likes_count: shared.likes_count };
      } else if (path.endsWith("/save")) {
        shared.is_saved = request.method === "POST";
        shared.saves_count = +shared.is_saved;
        body = { saved: shared.is_saved, saves_count: shared.saves_count };
      } else if (path.endsWith("/comments")) {
        if (request.method === "POST") {
          shared.comments_count = 1;
          body = {
            comment: {
              id: "66666666-6666-4666-8666-666666666666",
              post_id: postId,
              author_id: id,
              parent_id: null,
              content: JSON.parse(request.postData).content,
              likes_count: 0,
              reply_count: 0,
              created_at: new Date().toISOString(),
              author: user,
            },
            post: { id: postId, comments_count: 1 },
            parent: null,
          };
          code = 201;
        } else
          body = { data: [], count: 0, page: 1, pageSize: 20, hasMore: false };
      } else if (path.includes("unread")) body = { count: 0 };
      else if (path.includes("notifications")) body = { data: [], count: 0 };
      else if (write)
        throw new Error(`Unexpected mutation ${request.method} ${path}`);
      await send("Fetch.fulfillRequest", {
        requestId,
        responseCode: code,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(body)).toString("base64"),
      });
    })().catch((error) => {
      // Closing a map cancels intercepted tile requests before CDP can fulfill them.
      if (error.message !== "Invalid InterceptionId.")
        errors.push(error.message);
    });
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
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if(!el || el.disabled) throw new Error('Missing or disabled: '+${JSON.stringify(selector)}); el.click(); })()`,
    );
  const clickText = (value) =>
    evaluate(
      `(() => { const el = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(value)}); if(!el || el.disabled) throw new Error('Missing button '+${JSON.stringify(value)}); el.click(); })()`,
    );
  const setText = (selector, value) =>
    evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); })()`,
    );
  const navigate = async (path) => {
    await send("Page.navigate", { url: `${web}${path}` });
    await until(
      () => evaluate("document.readyState === 'complete'"),
      "navigation",
    );
  };
  const open = async () => {
    await until(
      () =>
        evaluate(
          "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Chia sẻ lên Feed')",
        ),
      "share entry",
    );
    await clickText("Chia sẻ lên Feed");
    await until(
      () => evaluate("!!document.querySelector('[role=dialog]')"),
      "share dialog",
    );
  };
  const shot = async (name) => {
    const result = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(artifacts, name), Buffer.from(result.data, "base64"));
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", {
    patterns: [
      { urlPattern: "*/api/v1/*" },
      { urlPattern: "*/share-test-preview.png" },
      { urlPattern: "*://api.mapbox.com/*" },
    ],
  });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem('wandermap-auth',JSON.stringify({state:{profile:${JSON.stringify(user)}},version:0}));`,
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await navigate(`/journey/${id}`);
  await open();
  await until(
    () =>
      evaluate(
        "document.querySelector('[role=dialog]').textContent.includes('Chỉ có thể chia sẻ')",
      ),
    "private guard",
  );
  assert.equal(mutations.length, 0);
  await click('button[aria-label="Đóng chia sẻ hành trình"]');
  assert.equal(journey.status, "draft");
  checks.push(
    "private/draft preview never publishes, uploads or changes the Journey",
  );

  journey = { ...journey, visibility: "public", status: "published" };
  await navigate(`/journey/${id}`);
  await open();
  await until(
    () =>
      evaluate(
        "!!document.querySelector('img[alt^=Preview]') || !!document.querySelector('[role=dialog] [role=alert]')",
      ),
    "real map preview",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('[role=dialog] [role=alert]')?.innerText ?? null",
    ),
    null,
  );
  assert.deepEqual(
    await evaluate(
      "document.querySelector('img[alt^=Preview]').decode().then(()=>{const i=document.querySelector('img[alt^=Preview]');return [i.naturalWidth,i.naturalHeight]})",
    ),
    [1600, 1600],
  );
  await setText(
    'textarea[aria-label="Caption hành trình"]',
    "Kỷ niệm không cần có bài check-in trước đó",
  );
  await shot("desktop-share-preview.png");
  assert.equal(mutations.length, 0);
  checks.push(
    "real WebGL poster at 1600×1600, editable caption, no upload until Publish",
  );

  await clickText("Đăng bài");
  await until(
    () =>
      evaluate(
        "!!document.querySelector('button[aria-label=\"Đóng chia sẻ hành trình\"]:disabled')",
      ),
    "publish locks duplicate clicks and close",
  );
  await until(
    () => evaluate("!!document.querySelector('[role=dialog] [role=alert]')"),
    "lost response error",
  );
  assert.equal(
    await evaluate("document.querySelector('textarea').value"),
    "Kỷ niệm không cần có bài check-in trước đó",
  );
  assert.equal(
    mutations.filter((m) => m.path.endsWith("/uploads/images")).length,
    1,
  );
  await clickText("Đăng bài");
  await until(
    () =>
      evaluate(
        `location.pathname==='/post/${postId}' && !!document.querySelector('section[aria-label="Hành trình được chia sẻ"]')`,
      ),
    "shared post detail",
  );
  assert.equal(
    mutations.filter((m) => m.path.endsWith("/posts/journey")).length,
    1,
  );
  assert.equal(
    mutations.filter((m) => m.path.endsWith("/uploads/images")).length,
    1,
  );
  assert.equal(
    JSON.parse(mutations.find((m) => m.path.endsWith("/posts/journey")).body)
      .journey_id,
    id,
  );
  checks.push(
    "lost response preserves caption; retry opens the committed post without another upload or share request",
  );

  await click('button[aria-label="Thích bài đăng"]');
  await until(
    () =>
      evaluate(
        "!!document.querySelector('button[aria-label=\"Bỏ thích bài đăng\"]')",
      ),
    "like",
  );
  await click('button[aria-label="Lưu bài đăng"]');
  await until(
    () =>
      evaluate(
        "!!document.querySelector('button[aria-label=\"Bỏ lưu bài đăng\"]')",
      ),
    "save",
  );
  await click('button[aria-label="Mở bình luận"]');
  await until(
    () => evaluate("!!document.querySelector('textarea')"),
    "comment form",
  );
  await setText("textarea", "Hành trình đáng nhớ");
  await click('button[aria-label="Gửi bình luận"]');
  await until(
    () =>
      mutations.some(
        (m) => m.path.endsWith("/comments") && m.method === "POST",
      ),
    "comment request",
  );
  await until(
    () => evaluate("document.body.textContent.includes('Hành trình đáng nhớ')"),
    "comment rendered",
  );
  checks.push(
    "Journey detail shares Like/Save/Comment controls and existing API contracts",
  );

  await navigate("/feed");
  await until(
    () =>
      evaluate(
        "document.body.textContent.includes('Bài đăng địa điểm vẫn hoạt động') && !!document.querySelector('section[aria-label] a[href^=\"/journey/\"]')",
      ),
    "mixed feed",
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[aria-label=\"Đánh giá 4 trên 5 sao\"]').length",
    ),
    1,
  );
  assert.equal(
    await evaluate("document.querySelectorAll('article').length >= 2"),
    true,
  );
  await click('button[aria-label="Phóng to ảnh hành trình"]');
  await until(
    () => evaluate("!!document.querySelector('[role=dialog]')"),
    "image lightbox",
  );
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await until(
    () => evaluate("!document.querySelector('[role=dialog]')"),
    "Escape closes lightbox",
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  assert.equal(
    await evaluate("document.documentElement.scrollWidth <= innerWidth"),
    true,
  );
  await shot("mobile-mixed-feed.png");
  checks.push(
    "mixed Feed preserves normal post stars/content; Journey lightbox closes on Escape; 390px has no overflow",
  );

  await navigate(`/journey/${id}`);
  await open();
  await until(
    () =>
      evaluate(
        "document.querySelector('[role=dialog]').textContent.includes('Hành trình đã có bài chia sẻ')",
      ),
    "existing share",
  );
  assert.equal(
    mutations.filter((m) => m.path.endsWith("/posts/journey")).length,
    1,
  );
  await click('button[aria-label="Đóng chia sẻ hành trình"]');
  shared = null;
  blockMapbox = true;
  await navigate(`/journey/${id}`);
  await open();
  await until(
    () => evaluate("!!document.querySelector('[role=dialog] [role=alert]')"),
    "Mapbox failure",
  );
  await setText(
    'textarea[aria-label="Caption hành trình"]',
    "Caption vẫn còn sau lỗi bản đồ",
  );
  await evaluate(
    "[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Ảnh bìa hiện tại')).querySelector('input').click()",
  );
  await until(
    () => evaluate("!!document.querySelector('img[alt^=Preview]')"),
    "existing cover option",
  );
  assert.equal(
    await evaluate("document.querySelector('textarea').value"),
    "Caption vẫn còn sau lỗi bản đồ",
  );
  await shot("mobile-share-cover.png");
  await evaluate(
    `(() => { const input=document.querySelector('input[type=file]'); const transfer=new DataTransfer(); transfer.items.add(new File(['bad'],'bad.svg',{type:'image/svg+xml'})); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true})); })()`,
  );
  await until(
    () =>
      evaluate(
        "document.querySelector('[role=dialog]').textContent.includes('tối đa 10 MB')",
      ),
    "file validation",
  );
  await evaluate(
    `(() => { const input=document.querySelector('input[type=file]'); const transfer=new DataTransfer(); transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png.toString("base64"))}), c=>c.charCodeAt(0))],'cover.png',{type:'image/png'})); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true})); })()`,
  );
  await until(
    () =>
      evaluate(
        "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Đăng bài' && !b.disabled)",
      ),
    "custom file decoded and ready",
  );
  assert.equal(
    await evaluate("document.documentElement.scrollWidth <= innerWidth"),
    true,
  );
  await click('button[aria-label="Đóng chia sẻ hành trình"]');
  assert.equal(
    mutations.filter((m) => m.path.endsWith("/posts/journey")).length,
    1,
  );
  checks.push(
    "existing share opens its post; Mapbox failure allows another cover and cancel without losing Journey data",
  );
  conflictOnce = true;
  await open();
  await until(
    () =>
      evaluate("!!document.querySelector('[role=dialog] input[type=radio]')"),
    "another saved preview",
  );
  await evaluate(
    "[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Ảnh bìa hiện tại')).querySelector('input').click()",
  );
  await setText(
    'textarea[aria-label="Caption hành trình"]',
    "Giữ lời kể khi tải lại hành trình",
  );
  await until(
    () =>
      evaluate(
        "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Đăng bài' && !b.disabled)",
      ),
    "cover ready",
  );
  await clickText("Đăng bài");
  await until(
    () =>
      evaluate(
        "document.querySelector('[role=dialog]').textContent.includes('Tải lại bản xem trước')",
      ),
    "revision conflict",
  );
  assert.equal(
    await evaluate(
      "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Đăng bài').disabled",
    ),
    true,
  );
  await clickText("Tải lại bản xem trước");
  await until(
    () =>
      evaluate(
        "document.querySelector('[role=dialog]').textContent.includes('Hành trình mới từ cửa sổ khác')",
      ),
    "refreshed journey",
  );
  assert.equal(
    await evaluate("document.querySelector('textarea').value"),
    "Giữ lời kể khi tải lại hành trình",
  );
  await until(
    () =>
      evaluate(
        "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Đăng bài' && !b.disabled)",
      ),
    "refreshed preview ready",
  );
  await clickText("Đăng bài");
  await until(
    () =>
      evaluate(
        `location.pathname==='/post/${postId}' && !document.querySelector('[role=dialog]')`,
      ),
    "revised share posted",
  );
  const latest = JSON.parse(
    mutations.filter((m) => m.path.endsWith("/posts/journey")).at(-1).body,
  );
  assert.equal(latest.revision, journey.revision);
  assert.equal(latest.content, "Giữ lời kể khi tải lại hành trình");
  checks.push(
    "409 requires refreshing the saved Journey preview, preserves caption and posts the new revision",
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        checks,
        artifacts,
        mutations: mutations.map(({ method, path }) => `${method} ${path}`),
      },
      null,
      2,
    ),
  );
} catch (error) {
  try {
    console.error(
      await evaluate(
        "({url:location.href,text:document.body.innerText.slice(-5000)})",
      ),
    );
  } catch {}
  throw error;
} finally {
  socket?.close();
  chrome.kill();
  await pause(500);
  const resolved = resolve(profile);
  assert.equal(dirname(resolved), resolve(tmpdir()));
  assert.ok(basename(resolved).startsWith("wandermap-journey-share-"));
  await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
}
