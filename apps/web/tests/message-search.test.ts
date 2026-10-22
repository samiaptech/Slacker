import test from "node:test";
import assert from "node:assert/strict";
import { messageSearchResponseSchema, parseMessageSearchTarget } from "../features/message-search/public";

void test("validates pending message-jump targets without accepting malformed storage data", () => {
  assert.deepEqual(parseMessageSearchTarget(JSON.stringify({
    type: "direct",
    conversationId: "conversation-1",
    messageId: "message-1"
  })), {
    type: "direct",
    conversationId: "conversation-1",
    messageId: "message-1"
  });
  assert.equal(parseMessageSearchTarget("not-json"), null);
  assert.equal(parseMessageSearchTarget(JSON.stringify({ type: "channel", conversationId: "c-1" })), null);
});

void test("validates safe message search result details and pagination", () => {
  const result = {
    id: "message-1",
    snippet: "A roadmap decision for the launch.",
    createdAt: "2026-10-20T12:00:00.000Z",
    sender: { id: "user-1", name: "Member", image: null },
    conversation: { type: "channel", id: "channel-1", name: "#general" }
  };
  assert.deepEqual(messageSearchResponseSchema.parse({
    query: "roadmap",
    page: 1,
    results: [result],
    hasMore: true,
    truncated: false
  }).results, [result]);
  assert.equal(messageSearchResponseSchema.safeParse({
    query: "roadmap",
    page: 1,
    results: [{ ...result, sender: { ...result.sender, email: "private@example.test" } }],
    hasMore: false,
    truncated: false
  }).success, false);
});
