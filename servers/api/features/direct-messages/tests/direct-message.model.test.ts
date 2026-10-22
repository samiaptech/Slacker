import test from "node:test";
import assert from "node:assert/strict";
import { DIRECT_MESSAGES_INDEXES } from "../models/index.js";

void test("direct message persistence includes the bounded search text index", () => {
  const searchIndex = DIRECT_MESSAGES_INDEXES.find(({ options }) => options.name === "direct_messages_text");
  assert.ok(searchIndex);
  assert.deepEqual(searchIndex.keys, { text: "text" });
});
