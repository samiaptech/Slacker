import test from "node:test";
import assert from "node:assert/strict";
import { getRestoredHistoryScrollTop, type HistoryScrollAnchor } from "../features/conversation-history";

const anchor: HistoryScrollAnchor = {
  messageId: "message-50",
  messageTop: 180,
  scrollTop: 620,
  scrollHeight: 1_200
};

void test("keeps the same message at the same viewport position after older history is prepended", () => {
  assert.equal(getRestoredHistoryScrollTop(anchor, 560, 1_800), 1_000);
});

void test("falls back to the scroll-height delta when the anchored message is unavailable", () => {
  assert.equal(getRestoredHistoryScrollTop(anchor, null, 1_800), 1_220);
});
