import test from "node:test";
import assert from "node:assert/strict";
import {
  CHANNEL_MESSAGE_MAX_LENGTH,
  decodeChannelMessageCursor,
  encodeChannelMessageCursor,
  validateChannelMessageText
} from "../domain/index.js";

void test("validates message body content and enforces its documented code-point limit", () => {
  assert.deepEqual(validateChannelMessageText(" \n "), { ok: false, error: "message_required" });
  assert.deepEqual(validateChannelMessageText("a".repeat(CHANNEL_MESSAGE_MAX_LENGTH + 1)), {
    ok: false,
    error: "message_too_long"
  });
  assert.deepEqual(validateChannelMessageText("🙂".repeat(CHANNEL_MESSAGE_MAX_LENGTH)), {
    ok: true,
    text: "🙂".repeat(CHANNEL_MESSAGE_MAX_LENGTH)
  });
  assert.deepEqual(validateChannelMessageText("  hello  "), { ok: true, text: "  hello  " });
});

void test("round-trips an exact timestamp and ID cursor and rejects malformed cursors", () => {
  const cursor = { createdAt: new Date("2026-10-15T12:00:00.000Z"), id: "message-1" };
  const encoded = encodeChannelMessageCursor(cursor);
  assert.deepEqual(decodeChannelMessageCursor(encoded), { ok: true, cursor });
  assert.deepEqual(decodeChannelMessageCursor("not-a-cursor"), { ok: false });
  assert.deepEqual(decodeChannelMessageCursor(Buffer.from(JSON.stringify({
    createdAt: "not-a-date",
    id: "message-1"
  })).toString("base64url")), { ok: false });
});
