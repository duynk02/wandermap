// Node 22+, Chrome and local web/API servers. Reads one public profile for SSR;
// browser API requests are fixtures, all mutations are blocked. No database writes.
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
const profilePath = `/profile/${encodeURIComponent(username)}`;
const journeyPath = "/journey/11111111-1111-4111-8111-111111111111";
const journey = {
  id: journeyPath.split("/").at(-1),
  user_id: user.id,
  title: "Hành trình kiểm tra điều hướng",
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
  stop_count: 0,
  preview_names: [],
};
const profileDirectory = await mkdtemp(
  join(tmpdir(), "wandermap-profile-navigation-"),
);
const artifacts = await mkdtemp(
  join(tmpdir(), "wandermap-profile-navigation-shots-"),
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
      exceptions.push(message.params.exceptionDetails.text);
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const path = new URL(request.url).pathname;
      const mutation =
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
      const result = path.endsWith("/auth/refresh")
        ? { accessToken: "test-only-token", expiresIn: 900 }
        : path.endsWith("/users/me")
          ? { ...user, email: "navigation@example.test" }
          : path.endsWith("/travel-map")
            ? {
                statistics: {
                  location_count: 0,
                  visit_count: 0,
                  journey_count: 1,
                },
                points: [],
                options: { years: [], countries: [] },
              }
            : path.endsWith("/journeys")
              ? { ...empty, data: [journey], count: 1 }
              : path.includes("/journeys/")
                ? journey
                : path.includes("/posts/") ||
                    path.endsWith("/visited-locations")
                  ? empty
                  : path.includes("/locations/")
                    ? []
                    : path.includes("unread")
                      ? { count: 0 }
                      : user;
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
  await click('a[aria-label="Hồ sơ cá nhân"]');
  await route(profilePath);
  await profileReady();
  assert.deepEqual(
    await evaluate(
      `Array.from(document.querySelectorAll('nav[aria-label="Điều hướng hồ sơ"] a')).map(a=>[a.getAttribute('aria-label'),a.getAttribute('href')])`,
    ),
    [
      ["Bản tin", "/feed"],
      ["Khám phá", "/explore"],
    ],
  );
  const profileHistoryLength = await evaluate("history.length");
  await click('[role="tab"][value="map"], [role="tab"][id$="trigger-map"]');
  await until(
    () => evaluate("new URLSearchParams(location.search).get('tab')==='map'"),
    "profile map tab",
  );
  await click(`a[href="${journeyPath}"]`);
  await route(journeyPath);
  await until(
    () =>
      evaluate(
        "document.body?.innerText.includes('Hành trình kiểm tra điều hướng')",
      ),
    "journey",
  );
  await send("Page.reload", { ignoreCache: true });
  await until(
    () =>
      evaluate(
        "document.body?.innerText.includes('Hành trình kiểm tra điều hướng')",
      ),
    "journey reload",
  );
  await click("article > button");
  await route(profilePath);
  await profileReady();
  assert.equal(
    await evaluate("new URLSearchParams(location.search).get('tab')"),
    "map",
  );
  assert.equal(
    await evaluate("history.length"),
    profileHistoryLength + 1,
    "Back does not push a duplicate profile entry",
  );
  await click('button[aria-label="Quay lại"]');
  await route("/feed");
  checks.push(
    "Feed → Profile map → Journey → reload → Back → original Profile map → Back → Feed, with no duplicate history entry",
  );
  await evaluate("history.forward()");
  await route(profilePath);
  await profileReady();
  assert.equal(
    await evaluate("new URLSearchParams(location.search).get('tab')"),
    "map",
  );
  await click('nav[aria-label="Điều hướng hồ sơ"] a[aria-label="Khám phá"]');
  await route("/explore");
  checks.push(
    "Browser forward retains the map tab; Profile Compass links directly to Explore",
  );
  await send("Page.navigate", { url: `${web}${profilePath}` });
  await profileReady();
  await send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 850,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await evaluate("localStorage.setItem('theme','dark')");
  await send("Page.reload", { ignoreCache: true });
  await profileReady();
  await until(
    () => evaluate(`!!document.querySelector('button[aria-label="Cài đặt"]')`),
    "owner settings",
  );
  const bounds = await evaluate(
    `Array.from(document.querySelectorAll('nav[aria-label="Điều hướng hồ sơ"] a')).map(a=>{const r=a.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height}})`,
  );
  assert.ok(
    bounds.every(
      (r) => r.left >= 0 && r.right <= 320 && r.width >= 44 && r.height >= 44,
    ),
  );
  assert.equal(
    await evaluate("document.documentElement.scrollWidth > innerWidth"),
    false,
  );
  await capture("profile-mobile-dark.png");
  await evaluate(
    `document.querySelector('nav[aria-label="Điều hướng hồ sơ"] a[aria-label="Bản tin"]').focus()`,
  );
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await route("/feed");
  checks.push(
    "320px mobile/dark owner header fits both 44px icons with Theme/Settings; keyboard Enter opens Feed",
  );
  await send("Page.navigate", { url: "about:blank" });
  await send("Page.navigate", { url: `${web}${journeyPath}` });
  await route(journeyPath);
  await until(
    () =>
      evaluate(
        "document.body?.innerText.includes('Hành trình kiểm tra điều hướng')",
      ),
    "direct journey",
  );
  assert.equal(
    await evaluate("history.state.wandermapNavigation.canGoBack"),
    false,
  );
  await click("article > button");
  await route(profilePath);
  await profileReady();
  assert.equal(
    await evaluate("new URLSearchParams(location.search).get('tab')"),
    "map",
  );
  await click('button[aria-label="Quay lại"]');
  await route("/feed");
  checks.push(
    "Direct Journey entry falls back to Profile map with replace, then Profile Back falls back to Feed without a Journey loop",
  );
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
  console.error(JSON.stringify({ artifacts }));
  throw error;
} finally {
  socket?.close();
  chrome.kill();
  await pause(500);
  assert.equal(dirname(resolve(profileDirectory)), resolve(tmpdir()));
  assert.ok(
    basename(profileDirectory).startsWith("wandermap-profile-navigation-"),
  );
  await rm(profileDirectory, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 300,
  });
}
