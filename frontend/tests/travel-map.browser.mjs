// Node 22+, Chrome and isolated local test web/API servers backed by a disposable database.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const web = process.env.WANDERMAP_TEST_WEB_URL;
const api = process.env.WANDERMAP_TEST_API_URL;
for (const address of [web, api])
  assert.ok(
    address && ["localhost", "127.0.0.1"].includes(new URL(address).hostname),
    "Explicit localhost test URLs are required.",
  );
const profile = await mkdtemp(join(tmpdir(), "wandermap-step3-browser-"));
const artifacts = await mkdtemp(join(tmpdir(), "wandermap-step3-screenshots-"));
const chrome = spawn(
  process.env.WANDERMAP_BROWSER_PATH ??
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  [
    "--headless=new",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--window-size=1440,1100",
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
let socket;
let diagnose;
const checks = [];
const errors = [];
const mapResponses = [];
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
  let failNext = false;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Fetch.requestPaused") {
      const fail =
        failNext && ["POST", "PATCH"].includes(message.params.request.method);
      if (fail) failNext = false;
      void send(fail ? "Fetch.failRequest" : "Fetch.continueRequest", {
        requestId: message.params.requestId,
        ...(fail ? { errorReason: "Failed" } : {}),
      });
    }
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.text);
    if (
      message.method === "Network.responseReceived" &&
      message.params.response.url.includes("api.mapbox.com")
    )
      mapResponses.push(message.params.response.status);
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    clearTimeout(waiting.timeout);
    if (message.error) waiting.reject(new Error(message.error.message));
    else waiting.done(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((done, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30000);
      pending.set(id, { done, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
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
  const waitFor = (expression, label) =>
    until(() => evaluate(expression), label);
  const click = (text) =>
    evaluate(
      `(() => { const el=[...document.querySelectorAll('button')].find(b=>!b.disabled && b.textContent.trim()===${JSON.stringify(text)}); if(!el) throw new Error('Missing button '+${JSON.stringify(text)}); el.focus(); el.click(); })()`,
    );
  const selectorClick = (selector) =>
    evaluate(
      `(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Missing control'); el.focus(); el.click(); })()`,
    );
  const fill = async (selector, text) => {
    await evaluate(
      `(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Missing field'); el.focus(); el.select(); })()`,
    );
    await send("Input.insertText", { text });
  };
  const select = (selector, value) =>
    evaluate(
      `(() => { const el=document.querySelector(${JSON.stringify(selector)}); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`,
    );
  // Inspect the existing react-map-gl context through CDP; no production debug globals.
  const mapState = (selector) =>
    evaluate(`(() => {
    const root=document.querySelector(${JSON.stringify(selector)});
    const element=root?.querySelector('[mapboxgl-children]');
    if(!element) return null;
    let fiber=element[Object.keys(element).find(key=>key.startsWith('__reactFiber$'))];
    while(fiber) {
      const ref=fiber.memoizedProps?.value?.map;
      if(ref?.getMap) {
        const map=ref.getMap(); const canvas=map.getCanvas();
        const source=map.getSource('travel-points'); const data=source?._data;
        return { loaded:map.loaded(), moving:map.isMoving(), zoom:map.getZoom(), width:canvas.clientWidth, height:canvas.clientHeight,
          rendered:map.getLayer('travel-dots') ? map.queryRenderedFeatures({layers:['travel-dots']}).length : 0,
          positions:typeof data==='object' ? data.features.map(f=>{const p=map.project(f.geometry.coordinates); return [Math.round(p.x),Math.round(p.y)];}) : [],
          bounds:map.getBounds().toArray() };
      }
      fiber=fiber.return;
    }
    return null;
  })()`);
  const dragStop = async (fromName, toName, touch = false) => {
    const bounds = await evaluate(
      `(() => { const names=${JSON.stringify([fromName, toName])}; return names.map(name=>{ const r=[...document.querySelectorAll('[role=dialog] button')].find(b=>b.getAttribute('aria-label')==='Kéo để sắp xếp '+name).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};}); })()`,
    );
    const [from, to] = bounds;
    if (touch)
      await send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: from.x, y: from.y, id: 1 }],
      });
    else {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from });
      await send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        ...from,
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
    }
    for (let step = 1; step <= 12; step++) {
      const position = { x: from.x, y: from.y + ((to.y - from.y) * step) / 12 };
      if (touch)
        await send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ ...position, id: 1 }],
        });
      else
        await send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...position,
          button: "left",
          buttons: 1,
        });
      await pause(35);
    }
    if (touch)
      await send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    else
      await send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: from.x,
        y: to.y,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
    await pause(400);
  };
  const capture = async (name) => {
    await pause(1600);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(artifacts, name), Buffer.from(shot.data, "base64"));
  };
  diagnose = async () => {
    await capture("failure.png");
    console.error(
      JSON.stringify(
        {
          artifacts,
          page: await evaluate("location.pathname"),
          text: await evaluate("document.body.innerText.slice(-2400)"),
        },
        null,
        2,
      ),
    );
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const credentials = {
    email: `journey_${suffix}@example.test`,
    password: `Test-only-${randomUUID()}`,
    username: `journey_${suffix}`,
    display_name: "Người gom những hành trình",
  };
  async function response(path, body, method = "POST", token) {
    return fetch(`${api}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async function call(path, body, method = "POST", token) {
    const res = await response(path, body, method, token);
    assert.ok(res.ok, `${method} ${path}: ${res.status}`);
    return res.json();
  }
  const session = await call("/auth/register", credentials);
  const places = [];
  for (const [name, lng, lat, date, visibility] of [
    ["Cần Thơ", 105.788, 10.045, "2024-02-29", "private"],
    ["Đà Lạt", 108.458, 11.94, "2025-12-31", "public"],
    ["Nha Trang", 109.196, 12.238, "2026-07-20", "public"],
    ["Đà Nẵng", 108.202, 16.054, null, "private"],
  ]) {
    const place = await call(
      "/locations",
      { name, city: name, country: "Việt Nam", coordinates: { lng, lat } },
      "POST",
      session.accessToken,
    );
    const mark = await call(
      "/users/me/visited-locations",
      { location_id: place.id, visited_at: date, visibility },
      "POST",
      session.accessToken,
    );
    places.push({ ...place, mark });
  }
  await call(
    `/users/me/visited-locations/${places[0].mark.id}/visits`,
    { visited_at: "2026-01-01" },
    "POST",
    session.accessToken,
  );
  const repeatedInput = {
    request_id: randomUUID(),
    title: "Parallel create",
    stops: places.slice(0, 2).map(({ id }) => ({ location_id: id })),
  };
  const repeated = await Promise.all(
    Array.from({ length: 4 }, () =>
      call("/journeys", repeatedInput, "POST", session.accessToken),
    ),
  );
  assert.equal(new Set(repeated.map((item) => item.id)).size, 1);
  const races = await Promise.all(
    ["First writer", "Second writer"].map((title) =>
      response(
        `/journeys/${repeated[0].id}`,
        { revision: 1, title },
        "PATCH",
        session.accessToken,
      ),
    ),
  );
  assert.deepEqual(races.map((res) => res.status).sort(), [200, 409]);
  await call(
    `/journeys/${repeated[0].id}?revision=2`,
    undefined,
    "DELETE",
    session.accessToken,
  );
  checks.push(
    "real concurrent creation is idempotent; concurrent updates reject the stale revision",
  );

  await send("Page.navigate", {
    url: `${web}/auth/login?next=${encodeURIComponent(`/profile/${credentials.username}`)}`,
  });
  await waitFor(
    "!!document.querySelector('input[name=email]') && Object.keys(document.querySelector('input[name=email]')).some(k=>k.startsWith('__reactProps$'))",
    "hydrated login",
  );
  await fill("input[name=email]", credentials.email);
  await fill("input[name=password]", credentials.password);
  await click("Đăng nhập");
  await waitFor("!!document.querySelector('[role=tab]')", "profile");
  await click("Bản đồ của tôi");
  await waitFor(
    "document.querySelector('[aria-label=\"My Travel Map\"] strong')?.textContent==='4'",
    "owner map statistics",
  );
  assert.deepEqual(
    await evaluate(
      "[...document.querySelectorAll('[aria-label=\"My Travel Map\"] strong')].map(el=>el.textContent)",
    ),
    ["4", "4", "0"],
  );
  await select('select[aria-label="Lọc theo năm ghé thăm"]', "2026");
  await waitFor(
    "document.querySelector('[aria-label=\"My Travel Map\"] strong')?.textContent==='2'",
    "year filter",
  );
  await fill('input[aria-label="Tìm trên bản đồ du lịch"]', "can tho");
  await waitFor(
    "document.querySelector('[aria-label=\"My Travel Map\"] strong')?.textContent==='1'",
    "accent-insensitive search",
  );
  await click("Xóa bộ lọc");
  await waitFor(
    "document.querySelector('[aria-label=\"My Travel Map\"] strong')?.textContent==='4'",
    "clear filters",
  );
  await evaluate(
    "document.querySelector('[aria-label=\"My Travel Map\"]').scrollIntoView({block:'start'})",
  );
  await capture("travel-map-desktop.png");
  const ownMap = '[aria-label="Bản đồ các địa điểm đã đến"]';
  const ownerCamera = await mapState(ownMap);
  await selectorClick(`${ownMap} button[aria-label="Zoom in"]`);
  await until(
    async () => (await mapState(ownMap))?.zoom > ownerCamera.zoom + 0.8,
    "zoom button changes the camera",
  );
  const zoomed = await mapState(ownMap);
  const canvas = await evaluate(
    `(() => { const r=document.querySelector(${JSON.stringify(ownMap)}+' canvas').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`,
  );
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: canvas.x,
    y: canvas.y,
    deltaY: -300,
    deltaX: 0,
  });
  await until(
    async () => (await mapState(ownMap))?.zoom > zoomed.zoom + 0.1,
    "scroll-wheel zoom",
  );
  await selectorClick(`${ownMap} button[aria-label="Xem toàn bộ bản đồ"]`);
  checks.push("map navigation buttons and scroll-wheel zoom work");
  checks.push(
    "profile integrates map, filtered list and consistent statistics",
  );

  await evaluate(
    "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Tạo hành trình').click()",
  );
  await waitFor(
    "!!document.querySelector('input[name=title]')",
    "journey builder",
  );
  await fill("input[name=title]", "Một dải ký ức Việt Nam");
  await fill(
    "textarea[name=description]",
    "Những thành phố, những người bạn và lời hẹn quay lại.",
  );
  await waitFor(
    "[...document.querySelectorAll('[role=dialog] button')].some(b=>b.textContent.trim()==='Cần Thơ' && !b.disabled)",
    "visited choices loaded",
  );
  for (const name of ["Cần Thơ", "Đà Lạt", "Nha Trang"]) await click(name);
  await selectorClick('button[aria-label="Đưa điểm 3 lên"]');
  await pause(550); // Finish the previous row layout animation before starting a new drag.
  const stopNames = () =>
    evaluate(
      "[...document.querySelectorAll('[aria-label=\"Thứ tự điểm đến\"] li p:first-child')].map(el=>el.textContent)",
    );
  await dragStop("Cần Thơ", "Nha Trang");
  assert.deepEqual(await stopNames(), ["Nha Trang", "Cần Thơ", "Đà Lạt"]);
  await selectorClick('button[aria-label="Đưa điểm 2 lên"]');
  checks.push(
    "desktop drag handle and accessible reorder buttons update the route order",
  );
  await selectorClick('button[aria-label="Xem trước hành trình"]');
  await waitFor(
    "!document.querySelector('input[name=title]') && document.body.innerText.includes('Một dải ký ức Việt Nam')",
    "live preview",
  );
  await until(async () => {
    const state = await mapState('[aria-label="Bản đồ hành trình"]');
    return (
      state &&
      !state.moving &&
      state.rendered >= 3 &&
      state.positions.length === 3 &&
      state.positions.every(
        ([x, y]) =>
          x >= 30 && y >= 30 && x <= state.width - 30 && y <= state.height - 30,
      )
    );
  }, "preview automatically fits every stop after resizing");
  await capture("journey-preview-desktop.png");
  await selectorClick('button[aria-label="Tiếp tục chỉnh sửa"]');
  failNext = true;
  await send("Fetch.enable", {
    patterns: [
      { urlPattern: `${web}/api/v1/journeys`, requestStage: "Request" },
    ],
  });
  await click("Lưu bản nháp");
  await waitFor(
    "document.body.innerText.includes('Chưa thể lưu thay đổi')",
    "save failure",
  );
  assert.equal(
    await evaluate("document.querySelector('input[name=title]').value"),
    "Một dải ký ức Việt Nam",
  );
  await send("Fetch.disable");
  await click("Lưu bản nháp");
  await waitFor(
    "!document.querySelector('[role=dialog]') && document.body.innerText.includes('Một dải ký ức Việt Nam')",
    "draft saved",
  );
  const saved = (
    await call(
      `/journeys?username=${credentials.username}`,
      undefined,
      "GET",
      session.accessToken,
    )
  ).data[0];
  let journey = await call(
    `/journeys/${saved.id}`,
    undefined,
    "GET",
    session.accessToken,
  );
  assert.deepEqual(
    journey.stops.map((stop) => stop.location_id),
    [places[0].id, places[2].id, places[1].id],
  );
  assert.equal(
    (await response(`/journeys/${saved.id}`, undefined, "GET")).status,
    404,
  );
  checks.push(
    "builder selection, immediate reorder, preview, failed-save recovery and private draft",
  );

  await selectorClick(`button[aria-label="Sửa ${saved.title}"]`);
  await waitFor("!!document.querySelector('input[name=title]')", "edit draft");
  await call(
    `/journeys/${saved.id}`,
    { revision: 1, description: "Updated in another session" },
    "PATCH",
    session.accessToken,
  );
  await fill("input[name=title]", "Nội dung chưa lưu vẫn còn");
  await click("Lưu bản nháp");
  await waitFor(
    "document.body.innerText.includes('đã được cập nhật ở nơi khác')",
    "revision conflict",
  );
  assert.equal(
    await evaluate("document.querySelector('input[name=title]').value"),
    "Nội dung chưa lưu vẫn còn",
  );
  await selectorClick('button[aria-label="Đóng trình tạo hành trình"]');
  await click("Bỏ thay đổi");
  await selectorClick(`button[aria-label="Sửa ${saved.title}"]`);
  await waitFor("!!document.querySelector('input[name=title]')", "fresh edit");
  await select("select[name=visibility]", "public");
  await click("Hoàn tất hành trình");
  await waitFor(
    "document.body.innerText.includes('Công khai hành trình?')",
    "explicit public disclosure",
  );
  await click("Công khai hành trình");
  await waitFor("!document.querySelector('[role=dialog]')", "published");
  journey = await call(`/journeys/${saved.id}`, undefined, "GET");
  assert.equal(journey.status, "published");
  assert.equal(journey.stops[0].visit_id, undefined);
  checks.push(
    "stale edit retains form; publication requires confirmation and exposes only journey snapshots",
  );

  await selectorClick(`button[aria-label="Sửa ${saved.title}"]`);
  await waitFor("!!document.querySelector('input[name=title]')", "mobile edit");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await evaluate(
    "document.querySelector('[role=dialog] fieldset').parentElement.scrollTop=0",
  );
  await pause(500);
  assert.ok(
    await evaluate(
      "(() => { const r=document.querySelector('[role=dialog]').getBoundingClientRect(); return r.left>=-1 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1; })()",
    ),
    "Mobile editor fits viewport",
  );
  await capture("journey-builder-mobile.png");
  await evaluate("document.documentElement.classList.add('dark')");
  await capture("journey-builder-mobile-dark.png");
  await evaluate(
    "document.querySelector('[aria-label=\"Thứ tự điểm đến\"]').scrollIntoView({block:'center',behavior:'instant'})",
  );
  await pause(350);
  await dragStop("Đà Lạt", "Nha Trang", true);
  assert.deepEqual(await stopNames(), ["Cần Thơ", "Đà Lạt", "Nha Trang"]);
  checks.push("mobile touch drag reorders stops");
  await selectorClick('button[aria-label="Đóng trình tạo hành trình"]');
  await click("Bỏ thay đổi");
  await evaluate(
    "document.querySelector('[aria-label=\"My Travel Map\"]').scrollIntoView({block:'start'})",
  );
  await capture("travel-map-mobile-dark.png");
  assert.equal(
    await evaluate("document.documentElement.scrollWidth > innerWidth + 1"),
    false,
  );
  checks.push(
    "mobile bottom sheet, full-screen editor and dark theme fit without horizontal overflow",
  );

  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: `${web}/journey/${saved.id}` });
  await waitFor(
    "document.querySelector('h1')?.textContent==='Một dải ký ức Việt Nam'",
    "journey detail",
  );
  await capture("journey-detail-desktop.png");
  await call(
    `/users/me/visited-locations/${places[0].mark.id}`,
    undefined,
    "DELETE",
    session.accessToken,
  );
  const historical = await call(`/journeys/${saved.id}`, undefined, "GET");
  assert.equal(historical.stops[0].visited_at_snapshot, "2026-01-01");
  assert.equal(
    (await call(`/users/${credentials.username}/travel-map`, undefined, "GET"))
      .statistics.location_count,
    2,
  );
  checks.push(
    "shared detail stays intact after deleting a private visited mark; public map still hides private marks",
  );
  assert.deepEqual(errors, [], "No uncaught browser exceptions");
  console.log(
    JSON.stringify(
      {
        checks,
        artifacts,
        mapbox: {
          successfulResponses: mapResponses.filter((status) => status < 400)
            .length,
          failedResponses: mapResponses.filter((status) => status >= 400)
            .length,
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  await diagnose?.();
  throw error;
} finally {
  socket?.close();
  chrome.kill();
  await pause(500);
  assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
  assert.ok(basename(profile).startsWith("wandermap-step3-browser-"));
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 300,
  });
}
