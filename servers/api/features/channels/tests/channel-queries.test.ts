import test from "node:test";
import assert from "node:assert/strict";
import { decodeChannelListCursor, encodeChannelListCursor } from "../domain/index.js";

void test("encodes and decodes canonical cursors scoped to a channel list", () => {
  const cursor = { scope: "joined" as const, name: "team-updates" };
  assert.deepEqual(decodeChannelListCursor(encodeChannelListCursor(cursor), "joined"), {
    ok: true,
    cursor
  });
});

void test("rejects malformed cursors, non-canonical encodings, and cursors for another scope", () => {
  const encoded = encodeChannelListCursor({ scope: "joined", name: "general" });
  assert.deepEqual(decodeChannelListCursor(encoded, "discoverable"), { ok: false });
  assert.deepEqual(decodeChannelListCursor("not-base64-json", "joined"), { ok: false });
  assert.deepEqual(
    decodeChannelListCursor(Buffer.from('{"scope":"joined","name":"General"}').toString("base64url"), "joined"),
    { ok: false }
  );
});
