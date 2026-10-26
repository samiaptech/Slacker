import test from "node:test";
import assert from "node:assert/strict";
import { createChannelMessageRequestCache } from "../features/channels/components/channel-message-request";

const request = {
  apiBaseUrl: "http://localhost:4000",
  workspaceId: "workspace-a",
  userId: "user-a",
  channelId: "channel-a",
  limit: 50
} as const;

void test("shares only in-flight channel history requests for the same user and scope", async () => {
  const resolveRequests: Array<(value: Readonly<{ status: number; body: unknown }>) => void> = [];
  let calls = 0;
  const cache = createChannelMessageRequestCache(() => {
    calls += 1;
    return new Promise((resolve) => { resolveRequests.push(resolve); });
  });

  const first = cache(request);
  const duplicate = cache(request);
  assert.equal(first, duplicate);
  assert.equal(calls, 1);

  const otherUser = cache({ ...request, userId: "user-b" });
  assert.notEqual(first, otherUser);
  assert.equal(calls, 2);

  const result = Object.freeze({ status: 200, body: { messages: [] } });
  resolveRequests.forEach((resolve) => resolve(result));
  await Promise.all([first, otherUser]);
  const next = cache(request);
  assert.equal(calls, 3);
  resolveRequests[2]?.(result);
  assert.deepEqual(await next, result);
});
