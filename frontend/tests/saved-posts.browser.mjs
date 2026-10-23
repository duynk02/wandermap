// Saved collection regression: Node 22+, Chrome and local web/API servers. Reads a public profile for SSR;
// browser API requests and saves are fixtures, all other mutations are blocked. No database writes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";

const web = process.env.WANDERMAP_TEST_WEB_URL;
const api = process.env.WANDERMAP_TEST_API_URL;
for (const url of [web, api])
  assert.ok(
    url && ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
    "Explicit local test web/API URLs required",
  );
const feed = await (await fetch(`${api}/posts/feed?pageSize=1`)).json();
const username =
  process.env.WANDERMAP_TEST_USERNAME ?? feed.data?.[0]?.author?.username;
assert.ok(
  username,
  "Supply WANDERMAP_TEST_USERNAME for an existing public profile if the local feed is empty",
);
const profileResponse = await fetch(
  `${api}/users/${encodeURIComponent(username)}`,
);
assert.ok(profileResponse.ok, "Public profile must exist for SSR");
const user = await profileResponse.json();
const publicProfilePosts = await (await fetch(`${api}/posts/by-author/${encodeURIComponent(username)}?pageSize=50`)).json();
const savedPostId = "88888888-8888-4888-8888-888888888888";
const savedPost = {
  id: savedPostId, author_id: "99999999-9999-4999-8999-999999999999", post_type: "location",
  content: "Bài của người khác để kiểm tra lưu", images: [], rating: 5, visited_at: "2026-10-23",
  visibility: "public", likes_count: 0, saves_count: 0, comments_count: 0,
  created_at: "2026-10-23T00:00:00Z", updated_at: "2026-10-23T00:00:00Z",
  author: { id: "99999999-9999-4999-8999-999999999999", username: "saved_author", display_name: "Tác giả bài đã lưu", avatar_url: null },
  location: { id: "77777777-7777-4777-8777-777777777777", name: "Điểm kiểm thử", city: "Đà Lạt", country: "Việt Nam", coordinates: { lat: 11.94, lng: 108.44 } },
};
let hasSavedPost = false;
const savedMutations = [];
const currentSavedPost = () => ({ ...savedPost, is_saved: hasSavedPost, saves_count: hasSavedPost ? 1 : 0 });
const profilePath = `/profile/${encodeURIComponent(username)}`;
const profileDirectory = await mkdtemp(
  join(tmpdir(), "wandermap-saved-posts-"),
);
const artifacts = await mkdtemp(
  join(tmpdir(), "wandermap-saved-posts-shots-"),
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
    `--user-data-dir=${profileDirectory}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const pause = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, name) {
  const end = Date.now() + 90_000;
  while (Date.now() < end) {
    if (await check()) return;
    await pause();
  }
  throw new Error(`Timed out: ${name}`);
}
let socket, send, evaluate;
const checks = [],
  mutations = [],
  exceptions = [];
try {
  let port;
  await until(async () => {
    try {
      port = (
        await readFile(join(profileDirectory, "DevToolsActivePort"), "utf8")
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
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown")
      exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const path = new URL(request.url).pathname;
      const save = path === `/api/v1/posts/${savedPostId}/save` && ["POST", "DELETE"].includes(request.method);
      if (save) { hasSavedPost = request.method === "POST"; savedMutations.push(request.method); }
      const mutation = !save &&
        !["GET", "HEAD"].includes(request.method) &&
        !path.endsWith("/auth/refresh");
      if (mutation) mutations.push(`${request.method} ${path}`);
      const empty = {
        data: [],
        count: 0,
        hasMore: false,
        page: 1,
        pageSize: 20,
      };
      const result = save ? { saved: hasSavedPost, saves_count: hasSavedPost ? 1 : 0 }
        : path.endsWith("/posts/feed") ? { ...empty, data: [currentSavedPost()], count: 1 }
        : path.endsWith("/posts/saved") ? { ...empty, pageSize: 12, data: hasSavedPost ? [currentSavedPost()] : [], count: hasSavedPost ? 1 : 0 }
        : publicProfilePosts.data?.some((post) => path === `/api/v1/posts/${post.id}`) ? publicProfilePosts.data.find((post) => path === `/api/v1/posts/${post.id}`)
        : path.endsWith("/auth/refresh")
        ? { accessToken: "test-only-token", expiresIn: 900 }
        : path.endsWith("/users/me")
          ? { ...user, email: "saved-test@example.test" }
          : path.includes("unread") ? { count: 0 } : empty;
      void send("Fetch.fulfillRequest", {
        requestId,
        responseCode: mutation ? 403 : 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(result)).toString("base64"),
      }).catch((error) => {
        // SPA navigation/reload can cancel a request before CDP fulfills its fixture.
        if (!error.message.includes("Invalid InterceptionId"))
          exceptions.push(error.message);
      });
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
  const click = async (selector) => {
    await until(
      () =>
        evaluate(
          `(()=>{const e=document.querySelector(${JSON.stringify(selector)});return !!e && Object.keys(e).some(k=>k.startsWith('__reactProps$'))})()`,
        ),
      "hydrated control",
    );
    await evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.click()})()`,
    );
  };
  const route = (path) =>
    until(
      () => evaluate(`location.pathname===${JSON.stringify(path)}`),
      "destination",
    );
  const profileReady = () =>
    until(
      () =>
        evaluate(
          `!!document.querySelector('nav[aria-label="Điều hướng hồ sơ"]') && !!history.state?.wandermapNavigation`,
        ),
      "profile header",
    );
  const capture = async (name) => {
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      join(artifacts, name),
      Buffer.from(screenshot.data, "base64"),
    );
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.bringToFront");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/v1/*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `if(location.origin===${JSON.stringify(new URL(web).origin)})localStorage.setItem('wandermap-auth',JSON.stringify({state:{profile:${JSON.stringify(user)}},version:0}))`,
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: `${web}/feed` });
  await click('button[aria-label="Lưu bài đăng"]');
  await until(() => evaluate(`!!document.querySelector('button[aria-label="Bỏ lưu bài đăng"]')`), "save from feed");
  await click('a[aria-label="Hồ sơ cá nhân"]');
  await route(profilePath);
  await profileReady();
  await click('[role="tab"][id$="trigger-saved"]');
  const savedCard = () => evaluate(`Array.from(document.querySelectorAll('[role="tabpanel"] article')).some(e=>e.textContent.includes(${JSON.stringify(savedPost.content)}))`);
  await until(savedCard, "saved post card on own profile");
  assert.equal(await evaluate(`document.querySelector('[role="tabpanel"] a[href="/post/${savedPostId}"]')!==null`), true);
  assert.equal(await evaluate(`document.querySelector('[role="tabpanel"] button[aria-label="Bỏ lưu bài đăng"]').getAttribute('aria-pressed')`), "true");
  checks.push("saving another author's post from Feed displays its card and target in the profile saved tab");
  await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 850, deviceScaleFactor: 2, mobile: true });
  await evaluate("localStorage.setItem('theme','dark')");
  await send("Page.reload", { ignoreCache: true });
  await until(savedCard, "saved list survives reload");
  assert.equal(await evaluate("new URLSearchParams(location.search).get('tab')"), "saved");
  assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
  await capture("saved-post-mobile-dark.png");
  checks.push("saved tab survives reload and fits the 320px mobile dark layout");
  await click('[role="tabpanel"] button[aria-label="Bỏ lưu bài đăng"]');
  await until(() => evaluate("document.body.textContent.includes('Chưa có bài viết đã lưu')"), "unsave removes card and shows empty state");
  assert.deepEqual(savedMutations, ["POST", "DELETE"]);
  checks.push("unsaving from the saved card refreshes the collection immediately without reloading");
  assert.deepEqual(mutations, []);
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ checks, artifacts }, null, 2));
} catch (error) {
  if (send) {
    const shot = await send("Page.captureScreenshot", { format: "png" }).catch(
      () => null,
    );
    if (shot)
      await writeFile(
        join(artifacts, "failure.png"),
        Buffer.from(shot.data, "base64"),
      );
  }
  console.error(JSON.stringify({ artifacts, exceptions }));
  throw error;
} finally {
  socket?.close();
  chrome.kill();
  await pause(500);
  assert.equal(dirname(resolve(profileDirectory)), resolve(tmpdir()));
  assert.ok(
    basename(profileDirectory).startsWith("wandermap-saved-posts-"),
  );
  await rm(profileDirectory, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 300,
  });
}
