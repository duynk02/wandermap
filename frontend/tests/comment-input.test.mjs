import assert from "node:assert/strict";
import test from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { createCommentDraft, prepareCommentInput } from "../src/lib/comment-input.ts";

test("each new comment/reply action gets one UUID and preserves an existing retry key", () => {
  const first = prepareCommentInput({ content: "Một nơi đẹp" });
  const second = prepareCommentInput({ content: "Một nơi đẹp", parent_id: "parent" });
  assert.match(first.client_request_id, /^[0-9a-f-]{36}$/i);
  assert.notEqual(first.client_request_id, second.client_request_id);
  assert.equal(second.parent_id, "parent");
  assert.deepEqual(prepareCommentInput(first), first);
});

test("manual retry of a failed draft keeps the key; success or edit starts an intentional new comment", () => {
  const draft = createCommentDraft();
  const first = draft.prepare("owner:post:root", { content: "Ký ức" });
  assert.equal(draft.prepare("owner:post:root", { content: "Ký ức" }).client_request_id, first.client_request_id);
  draft.succeeded(first.client_request_id);
  const afterSuccess = draft.prepare("owner:post:root", { content: "Ký ức" });
  assert.notEqual(afterSuccess.client_request_id, first.client_request_id, "same content after success is a new action");
  draft.changed();
  const afterEdit = draft.prepare("owner:post:root", { content: "Ký ức" });
  assert.notEqual(afterEdit.client_request_id, afterSuccess.client_request_id, "editing then reverting also starts a new draft");
  const otherOwner = draft.prepare("other:post:root", { content: "Ký ức" });
  assert.notEqual(otherOwner.client_request_id, afterEdit.client_request_id);
  const reply = draft.prepare("other:post:parent", { content: "Ký ức", parent_id: "parent" });
  assert.notEqual(reply.client_request_id, otherOwner.client_request_id);
});

test("TanStack mutation retries reuse variables and the original idempotency key", async () => {
  const client = new QueryClient();
  const attempts = [];
  const input = prepareCommentInput({ content: "Gửi lại sau mất mạng" });
  const mutation = new MutationObserver(client, {
    retry: 1,
    retryDelay: 0,
    mutationFn: async (variables) => {
      attempts.push(variables.client_request_id);
      if (attempts.length === 1) throw new Error("temporary network error");
      return { id: "same-comment" };
    },
  });
  assert.deepEqual(await mutation.mutate(input), { id: "same-comment" });
  assert.deepEqual(attempts, [input.client_request_id, input.client_request_id]);
  client.clear();
});
