import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { ApiError } from "../src/lib/api/client.ts";

const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/messaging/session.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  let owner = "A", version = 1;
  const value = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name === "@/lib/api/client") return { ApiError, getAuthSessionVersion: () => version };
    if (name === "@/stores/authStore") return { useAuthStore: { getState: () => ({ user: owner ? { id: owner } : null }) } };
    throw new Error(`Unexpected import ${name}`);
  }, value, value.exports);
  return { ...value.exports, switch: (next, session = version + 1) => { owner = next; version = session; } };
}

test("private query refuses an old owner before sending HTTP", async () => {
  const h = harness(); let calls = 0;
  await assert.rejects(h.readMessagingSession("B", async () => { calls++; }), { code: "AUTH_SESSION_CHANGED" });
  assert.equal(calls, 0);
});

for (const next of ["B", "A", null]) test(`a successful old response is discarded after session changes to ${next}`, async () => {
  const h = harness(); let release;
  const result = h.readMessagingSession("A", () => new Promise((resolve) => { release = resolve; }));
  h.switch(next); release({ unread_conversations: 9 });
  await assert.rejects(result, { code: "AUTH_SESSION_CHANGED" });
});

test("ordinary token rotation within the same session does not discard private responses", async () => {
  const h = harness(); let release;
  const result = h.readMessagingSession("A", () => new Promise((resolve) => { release = resolve; }));
  h.switch("A", 1); release({ unread_conversations: 2 });
  assert.deepEqual(await result, { unread_conversations: 2 });
});
