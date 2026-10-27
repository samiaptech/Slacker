import test from "node:test";
import assert from "node:assert/strict";
import {
  getMessageDeleteFailure,
  getRestoredHistoryScrollTop,
  toggleMessageReaction,
  type HistoryScrollAnchor
} from "../features/conversation-history";

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

void test("reports attachment cleanup failure without treating the committed message deletion as failed", async () => {
  const response = new Response(JSON.stringify({
    error: { code: "message_delete_cleanup_failed", message: "Cleanup failed." }
  }), { status: 503 });

  assert.deepEqual(await getMessageDeleteFailure(response), {
    deletionCommitted: true,
    message: "The message was deleted, but an attached file could not be cleaned up."
  });
});

void test("keeps one local reaction per member and toggles it off when selected again", () => {
  assert.deepEqual(toggleMessageReaction([], "👍"), ["👍"]);
  assert.deepEqual(toggleMessageReaction(["👍"], "❤️"), ["❤️"]);
  assert.deepEqual(toggleMessageReaction(["❤️"], "❤️"), []);
});
