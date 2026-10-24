import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { journeyShareTarget, locationShareTarget, postShareTarget, prepareSharedMessage, shareAttemptKey } from "../src/lib/messaging/share.ts";

const id = randomUUID(), author = { id: randomUUID(), username: "ban_dong_hanh", display_name: "Bạn đồng hành", avatar_url: null };
const location = { id: randomUUID(), name: "Hồ Tuyền Lâm", address: "Đà Lạt, Lâm Đồng", category: "mountain", city: "Đà Lạt", country: "Việt Nam" };
const post = { id, content: "Bình minh bên hồ 🌿", images: ["https://example.test/sunrise.webp"], visibility: "public", author, location };

test("a share sends a reference and optional trimmed caption, never a client preview or coordinates", () => {
  for (const type of ["shared_post", "shared_location", "shared_journey"]) {
    const input = prepareSharedMessage({ type, id }, "  Hẹn nhau ở Đà Lạt 🌿\nĐi nhé!  ");
    assert.deepEqual(Object.keys(input).sort(), ["client_message_id", "content", "message_type", "shared_resource_id"]);
    assert.equal(input.content, "Hẹn nhau ở Đà Lạt 🌿\nĐi nhé!");
    assert.equal(input.message_type, type);
    assert.equal(input.shared_resource_id, id);
    assert.match(input.client_message_id, /^[0-9a-f-]{36}$/);
    assert.equal(prepareSharedMessage({ type, id }, " \n\t ").content, null, "empty caption is valid for a resource message");
  }
});

test("an unchanged failed share keeps its original idempotency body while edits create a new operation", () => {
  const target = { type: "shared_post", id };
  const first = prepareSharedMessage(target, "Cùng đi nhé!");
  assert.equal(prepareSharedMessage(target, "  Cùng đi nhé!  ", first), first);
  for (const next of [prepareSharedMessage(target, "Lời nhắn khác", first), prepareSharedMessage({ ...target, id: randomUUID() }, first.content, first), prepareSharedMessage({ ...target, type: "shared_location" }, first.content, first)]) {
    assert.notEqual(next.client_message_id, first.client_message_id);
  }
  assert.notEqual(prepareSharedMessage(target, first.content).client_message_id, first.client_message_id, "a new confirmed submission is intentional");
});

test("share attempts are scoped to the exact resource and destination, including destination kind", () => {
  const destination = { kind: "user", id: randomUUID() };
  const target = { type: "shared_post", id };
  const keys = [shareAttemptKey(target, destination), shareAttemptKey(target, { ...destination, id: randomUUID() }), shareAttemptKey(target, { ...destination, kind: "conversation" }), shareAttemptKey({ ...target, type: "shared_journey" }, destination)];
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(shareAttemptKey(target, destination), shareAttemptKey(target, { kind: "conversation", id: randomUUID(), recipient_id: destination.id }), "selecting the same person via recent chat or username reuses the pending/failed operation");
});

test("post previews include author, thumbnail, caption and location without changing the original post", () => {
  const target = postShareTarget(post);
  assert.equal(target.restriction, null);
  assert.equal(target.type, "shared_post");
  assert.deepEqual(target.preview, { available: true, id, title: post.content, image_url: post.images[0], author, location: { id: location.id, name: location.name }, address: null, category: null });
  assert.equal(post.visibility, "public");
});

test("private posts and private or unpublished journey-backed posts explain why sharing is unavailable", () => {
  assert.ok(postShareTarget({ ...post, visibility: "private" }).restriction);
  assert.equal(postShareTarget({ ...post, visibility: "followers" }).restriction, null, "the API decides whether the chosen recipient follows the author");
  for (const journey of [{ visibility: "private", status: "published" }, { visibility: "public", status: "draft" }]) assert.ok(postShareTarget({ ...post, post_type: "journey", location: null, journey }).restriction);
});

test("location targets use canonical identity and existing metadata; journey targets require public publication", () => {
  assert.deepEqual(locationShareTarget(location).preview, { available: true, id: location.id, title: location.name, image_url: null, author: null, location: { id: location.id, name: location.name }, address: location.address, category: location.category });
  assert.equal(locationShareTarget({ ...location, address: null }).preview.address, "Đà Lạt, Việt Nam");
  const journey = { id, title: "Lên đường về miền Trung", author, cover_image_url: "https://example.test/journey.webp", visibility: "public", status: "published" };
  assert.equal(journeyShareTarget(journey).restriction, null);
  assert.equal(journeyShareTarget(journey).preview.image_url, journey.cover_image_url);
  assert.ok(journeyShareTarget({ ...journey, status: "draft" }).restriction);
  assert.ok(journeyShareTarget({ ...journey, visibility: "private" }).restriction);
});
