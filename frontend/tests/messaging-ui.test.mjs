import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  MESSAGE_MAX_LENGTH, conversationPreview, isMessageRead, matchesConversation, messageTextLength,
  mergeDisplayMessages, orderedConversations, safeMessageHref, validateMessageText,
} from "../src/lib/messaging/model.ts";

const owner = randomUUID(), recipient = randomUUID(), chat = randomUUID();
const now = "2026-10-23T12:00:00.000Z";
const message = (sequence = "1", extra = {}) => ({
  id: randomUUID(), conversation_id: chat, sender_id: owner, sequence,
  client_message_id: randomUUID(), message_type: "text", content: "Hẹn nhau ở Đà Lạt 🌿",
  shared_resource: null, created_at: now, updated_at: now, deleted_at: null, ...extra,
});
const local = (extra = {}) => ({
  client_message_id: randomUUID(), conversation_id: chat, sender_id: owner,
  content: "Một chuyến đi mới", created_at: now, status: "pending", ...extra,
});
const conversation = (extra = {}) => ({
  id: chat, type: "direct", created_at: now, updated_at: now, last_message_at: now,
  recipient: { id: recipient, username: "nguyen_duc", display_name: "Nguyễn Đức", avatar_url: null, is_active: true },
  can_send: true, blocked_by_me: false, read_state: { last_read_sequence: null, last_read_at: null },
  recipient_read_state: { last_read_sequence: null, last_read_at: null }, unread_count: 0,
  last_message: message(), ...extra,
});

test("conversation activity keeps microseconds/UUID order and the first fresh snapshot across overlapping pages", () => {
  const a = conversation({ id: "10000000-0000-4000-8000-000000000000", last_message_at: "2026-10-24T12:00:00.123001Z", unread_count: 4 });
  const b = conversation({ id: "20000000-0000-4000-8000-000000000000", last_message_at: "2026-10-24T19:00:00.123002+07:00" });
  const c = conversation({ id: "30000000-0000-4000-8000-000000000000", last_message_at: b.last_message_at });
  const empty = conversation({ id: randomUUID(), last_message_at: null, created_at: "2026-10-24T12:00:00.124Z" });
  const result = orderedConversations([a, b, c, { ...a, unread_count: 0 }, empty]);
  assert.deepEqual(result.map((row) => row.id), [empty.id, c.id, b.id, a.id]);
  assert.equal(result.at(-1), a);
  assert.equal(result.at(-1).unread_count, 4);
});

test("message validation rejects Unicode whitespace and keeps the original draft intact", () => {
  for (const text of ["", " \t\r\n ", "\u00a0\u2003\u202f\ufeff"]) {
    assert.equal(typeof validateMessageText(text), "string");
  }
  const draft = "  Hẹn ở Đà Nẵng 🗺️\nMang theo máy ảnh nhé!  ";
  assert.equal(validateMessageText(draft), null);
  assert.equal(draft, "  Hẹn ở Đà Nẵng 🗺️\nMang theo máy ảnh nhé!  ");
});

test("message length matches backend trim and PostgreSQL Unicode code-point limits", () => {
  assert.equal(MESSAGE_MAX_LENGTH, 4000);
  for (const character of ["ế", "🙂"]) {
    assert.equal(messageTextLength(` \n${character.repeat(4000)}\u00a0 `), 4000);
    assert.equal(validateMessageText(` \n${character.repeat(4000)}\u00a0 `), null, character);
    assert.equal(typeof validateMessageText(character.repeat(4001)), "string", character);
  }
  for (const presentationSequence of ["🗺️", "☀︎"]) {
    assert.equal(messageTextLength(presentationSequence.repeat(2000)), 4000);
    assert.equal(validateMessageText(presentationSequence.repeat(2000)), null);
    assert.equal(typeof validateMessageText(presentationSequence.repeat(2001)), "string");
  }
  // Combining marks and ZWJ sequences are not counted as a single grapheme by the backend.
  assert.equal(validateMessageText("a\u0301".repeat(2000)), null);
  assert.equal(typeof validateMessageText("a\u0301".repeat(2001)), "string");
});

test("optimistic, REST and socket copies become one stable bubble regardless of arrival order", () => {
  const draft = local();
  const stored = message("9007199254740993", { client_message_id: draft.client_message_id });
  const pending = mergeDisplayMessages([], [draft]);
  for (const sources of [[stored, { ...stored }], [{ ...stored }, stored]]) {
    const result = mergeDisplayMessages(sources, [draft, { ...draft, status: "failed" }]);
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, "server");
    assert.equal(result[0].message.id, stored.id);
    assert.equal(result[0].key, pending[0].key);
  }
});

test("committed rows deduplicate on both server ID and sender/client identity", () => {
  const stored = message("42");
  assert.equal(mergeDisplayMessages([stored, { ...stored, client_message_id: randomUUID() }], []).length, 1);
  assert.equal(mergeDisplayMessages([stored, { ...stored, id: randomUUID() }], []).length, 1);
  const otherSender = message("43", { sender_id: recipient, client_message_id: stored.client_message_id });
  assert.equal(mergeDisplayMessages([stored, otherSender], []).length, 2);
});

test("overlapping server aliases cannot leave an optimistic copy behind", () => {
  const first = message("42"), second = message("42");
  const bridge = { ...first, client_message_id: second.client_message_id };
  const drafts = [first, second].map((row) => local({ client_message_id: row.client_message_id }));
  const result = mergeDisplayMessages([first, second, bridge], drafts);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "server");
});

test("server sequence order keeps bigint precision and never assigns cursors to local messages", () => {
  const old = message("9007199254740992", { created_at: "2026-10-23T13:00:00.000Z" });
  const recent = message("9007199254740993", { created_at: "2026-10-23T11:00:00.000Z" });
  const first = local({ created_at: "2026-10-22T10:00:00.000Z" });
  const second = local({ created_at: "2026-10-23T10:00:00.000Z" });
  const server = [recent, old], drafts = [second, first];
  const result = mergeDisplayMessages(server, drafts);
  assert.deepEqual(result.map((row) => row.message), [old, recent, first, second]);
  assert.deepEqual(server, [recent, old]);
  assert.deepEqual(drafts, [second, first]);
  assert.equal("sequence" in result[2].message, false);
});

test("a newer tombstone wins over an older response and late failed state cannot replace committed data", () => {
  const original = message("7");
  const removed = { ...original, deleted_at: "2026-10-23T12:00:01.000Z", updated_at: "2026-10-23T12:00:01.000Z", content: null };
  const failed = local({ client_message_id: original.client_message_id, status: "failed", error: "Mất mạng" });
  for (const sources of [[original, removed], [removed, original]]) {
    assert.deepEqual(mergeDisplayMessages(sources, [failed])[0].message, removed);
  }
  assert.deepEqual(mergeDisplayMessages([{ ...removed, updated_at: now }, original], [failed])[0].message,
    { ...removed, updated_at: now });
});

test("retry replaces local failed state with pending using the same client key and unchanged payload", () => {
  const failed = local({ status: "failed", error: "Thử lại" });
  const retry = { ...failed, status: "pending", error: undefined };
  const result = mergeDisplayMessages([], [failed, retry]);
  assert.equal(result.length, 1);
  assert.equal(result[0].message.status, "pending");
  assert.equal(result[0].message.client_message_id, failed.client_message_id);
  assert.equal(result[0].message.content, failed.content);
});

test("read receipts use only a confirmed cursor with bigint precision", () => {
  const row = message("9007199254740993");
  assert.equal(isMessageRead(row, null), false);
  assert.equal(isMessageRead(row, "9007199254740992"), false);
  assert.equal(isMessageRead(row, "9007199254740993"), true);
  assert.equal(isMessageRead(row, "9223372036854775807"), true);
  for (const invalid of ["", "0", "-1", "01", "9007199254740993.5", "not-a-sequence", "9223372036854775808"]) {
    assert.equal(isMessageRead(row, invalid), false);
  }
});

test("conversation previews preserve text and hide removed or unavailable shared content", () => {
  assert.equal(conversationPreview(conversation({ last_message: null })), "Bắt đầu cuộc trò chuyện");
  assert.equal(conversationPreview(conversation({ last_message: message("1", { content: "<script>alert(1)</script>" }) })),
    "<script>alert(1)</script>");
  assert.equal(conversationPreview(conversation({ last_message: message("1", { deleted_at: now, content: "old private text" }) })),
    "Tin nhắn đã được xóa");
  for (const type of ["shared_post", "shared_location", "shared_journey"]) {
    assert.equal(conversationPreview(conversation({ last_message: message("1", {
      message_type: type, content: "caption", shared_resource: { available: false, title: "stale private title" },
    }) })), "Nội dung chia sẻ không còn khả dụng");
  }
  for (const [type, label] of [["shared_post", "bài viết"], ["shared_location", "địa điểm"], ["shared_journey", "hành trình"]]) {
    assert.equal(conversationPreview(conversation({ last_message: message("1", {
      message_type: type, content: null, shared_resource: { available: true },
    }) })), `Đã chia sẻ một ${label}`);
  }
});

test("conversation search supports Vietnamese accents, đ and usernames without searching private messages", () => {
  const chat = conversation();
  for (const term of ["", "  ", "NGUYEN DUC", "nguyễn đức", "nguye\u0302\u0303n", "NGUYEN_DUC", "  nguyen   duc "]) {
    assert.equal(matchesConversation(chat, term), true, term);
  }
  assert.equal(matchesConversation(chat, "Đà Lạt"), false);
  assert.equal(matchesConversation(chat, "người khác"), false);
});

test("safe message links accept absolute web URLs and Unicode while rejecting executable or obscured schemes", () => {
  assert.equal(safeMessageHref("https://example.com/travel?q=Đà%20Lạt#map"), "https://example.com/travel?q=%C4%90%C3%A0%20L%E1%BA%A1t#map");
  assert.equal(safeMessageHref(" HTTP://EXAMPLE.COM "), "http://example.com/");
  assert.equal(safeMessageHref("https://example.com/path#javascript:alert(1)"), "https://example.com/path#javascript:alert(1)");
  for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)", "//example.com", "/profile/user", "https:\\example.com", "https://", "not a URL",
    "\u0000https://example.com", "https://example.com\n/path", "https://example.com/\u007f", "https://example.com/\u0085",
    "https://name:secret@example.com", "https://name@example.com", "https://@example.com"]) {
    assert.equal(safeMessageHref(href), null, href);
  }
});
