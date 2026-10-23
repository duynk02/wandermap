import assert from "node:assert/strict";
import test from "node:test";
import { observeBrowserResume } from "../src/lib/realtime/browser-resume.ts";

test("foreground/online are throttled hints and all browser listeners are removed", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const browser = new EventTarget(), document = new EventTarget();
  document.visibilityState = "visible";
  globalThis.window = browser; globalThis.document = document;
  let checks = 0, offline = 0;
  const stop = observeBrowserResume(() => checks++, () => offline++);
  try {
    browser.dispatchEvent(new Event("online"));
    for (let i=0; i<20; i++) document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(checks, 1);
    document.visibilityState = "hidden";
    t.mock.timers.tick(15_000);
    browser.dispatchEvent(new Event("online"));
    assert.equal(checks, 1);
    document.visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(checks, 2);
    browser.dispatchEvent(new Event("offline")); assert.equal(offline, 1);
    stop(); t.mock.timers.tick(15_000);
    browser.dispatchEvent(new Event("online")); browser.dispatchEvent(new Event("offline"));
    assert.equal(checks, 2); assert.equal(offline, 1);
  } finally {
    stop();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});
