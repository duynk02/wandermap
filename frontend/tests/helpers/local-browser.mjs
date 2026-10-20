import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function launchLocalBrowser() {
  const executable = [
    process.env.WANDERMAP_TEST_BROWSER,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find((candidate) => candidate && existsSync(candidate));
  if (!executable)
    throw new Error(
      "Set WANDERMAP_TEST_BROWSER to a local Chrome/Edge executable.",
    );
  const directory = await mkdtemp(
    path.join(tmpdir(), "wandermap-profile-browser-"),
  );
  const browser = spawn(
    executable,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-extensions",
      "--disable-sync",
      "--remote-debugging-port=0",
      `--user-data-dir=${directory}`,
      "about:blank",
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  let launchError;
  browser.on("error", (error) => {
    launchError = error;
  });
  let client;

  const close = async () => {
    try {
      await client?.send("Browser.close");
    } catch {
      /* Closing can disconnect the protocol first. */
    }
    client?.socket.close();
    if (browser.exitCode === null) {
      const stopped = new Promise((resolve) => browser.once("exit", resolve));
      browser.kill();
      await Promise.race([stopped, pause(5000)]);
    }
    // Delete only the unique browser profile created by this invocation.
    const target = path.resolve(directory);
    if (
      path.dirname(target) !== path.resolve(tmpdir()) ||
      !path.basename(target).startsWith("wandermap-profile-browser-")
    ) {
      throw new Error("Unexpected browser cleanup directory.");
    }
    await rm(target, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  };

  try {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (launchError) throw launchError;
      if (browser.exitCode !== null)
        throw new Error("Headless browser exited before starting.");
      try {
        port = Number(
          (
            await readFile(path.join(directory, "DevToolsActivePort"), "utf8")
          ).split("\n")[0],
        );
        if (port > 0) break;
      } catch {
        /* Browser is still starting. */
      }
      await pause(100);
    }
    if (!port)
      throw new Error(
        "Headless browser did not expose its local test endpoint.",
      );
    const tabs = await (
      await fetch(`http://127.0.0.1:${port}/json/list`)
    ).json();
    const tab = tabs.find((entry) => entry.type === "page");
    if (!tab) throw new Error("No browser test page was created.");
    client = new BrowserClient(tab.webSocketDebuggerUrl);
    await client.ready;
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Network.enable");
    return { client, close };
  } catch (error) {
    await close();
    throw error;
  }
}

class BrowserClient extends EventEmitter {
  constructor(url) {
    super();
    this.sequence = 0;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener(
        "error",
        () => reject(new Error("Cannot connect to the headless browser.")),
        { once: true },
      );
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error)
          pending.reject(
            new Error(`${pending.method}: ${message.error.message}`),
          );
        else pending.resolve(message.result);
      } else this.emit(message.method, message.params);
    });
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Headless browser disconnected."));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Browser command timed out: ${method}`));
      }, 60_000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        `Browser evaluation failed: ${result.exceptionDetails.text}`,
      );
    return result.result.value;
  }

  async waitFor(expression, label, timeout = 60_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate(expression)) return;
      } catch {
        /* Navigation replaces the execution context. */
      }
      await pause(200);
    }
    throw new Error(`Timed out waiting for ${label}.`);
  }

  async navigate(url) {
    await this.send("Page.navigate", { url });
  }

  async fill(selector, value) {
    const range = await this.evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.type === 'range'`,
    );
    if (!range) {
      await this.evaluate(
        `(() => { const input=document.querySelector(${JSON.stringify(selector)}); if(!input) throw new Error('Missing input'); input.focus(); input.select(); })()`,
      );
      await this.send("Input.insertText", { text: String(value) });
      await this.evaluate(
        `document.querySelector(${JSON.stringify(selector)}).blur()`,
      );
      return;
    }
    await this.evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) throw new Error('Missing input');
      input.focus();
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new Event('change', {bubbles: true}));
      input.blur();
    })()`);
  }

  async click(text, dialogTitle) {
    const point = await this.evaluate(`(() => {
      const title = ${JSON.stringify(dialogTitle ?? null)};
      const root = title ? [...document.querySelectorAll('[role="dialog"]')].find(node => node.querySelector('h2')?.textContent.trim() === title) : document;
      const button = root && [...root.querySelectorAll('button')].find(node => (node.textContent.trim() === ${JSON.stringify(text)} || node.getAttribute('aria-label') === ${JSON.stringify(text)}) && node.getClientRects().length);
      if (!button || button.disabled) throw new Error('Missing or disabled button');
      button.scrollIntoView({block:'center', behavior:'instant'});
      const rect=button.getBoundingClientRect();
      return {x:rect.x+rect.width/2, y:rect.y+rect.height/2};
    })()`);
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...point,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...point,
      button: "left",
      clickCount: 1,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...point,
      button: "left",
      clickCount: 1,
    });
  }

  async chooseFile(file) {
    const { root } = await this.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await this.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "input[type=file]",
    });
    if (!nodeId) throw new Error("Missing avatar file input.");
    await this.send("DOM.setFileInputFiles", { nodeId, files: [file] });
  }

  async key(key, code) {
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      windowsVirtualKeyCode: code,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      windowsVirtualKeyCode: code,
    });
  }
}
