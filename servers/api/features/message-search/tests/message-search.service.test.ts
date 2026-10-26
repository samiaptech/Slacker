import test from "node:test";
import assert from "node:assert/strict";
import {
  createMessageSearchRepository,
  createMessageSearchService,
  normalizeMessageSearchQuery,
  createMessageSnippet,
  type MessageSearchCandidate,
  type MessageSearchStorage
} from "../index.js";
import type { SharedRateLimiter } from "../../../integrations/mongodb/index.js";

const candidates: readonly MessageSearchCandidate[] = Object.freeze([
  Object.freeze({
    id: "channel-message",
    senderId: "author",
    text: "A roadmap decision for the spring release.",
    createdAt: new Date("2026-10-20T12:00:00.000Z"),
    score: 1.2,
    conversation: Object.freeze({ type: "channel" as const, id: "channel-1", name: "general" })
  }),
  Object.freeze({
    id: "direct-message",
    senderId: "peer",
    text: "The roadmap is ready.",
    createdAt: new Date("2026-10-20T12:00:00.000Z"),
    score: 1.8,
    conversation: Object.freeze({ type: "direct" as const, id: "dm-1", otherParticipantId: "peer" })
  })
]);

const createService = (
  overrides: Partial<MessageSearchStorage> = {},
  rateLimiter: SharedRateLimiter = {
    consume: () => Promise.resolve({ allowed: true, retryAfterSeconds: 0 })
  }
) => {
  const calls: Readonly<Record<string, unknown>>[] = [];
  const storage: MessageSearchStorage = {
    searchForMember: (workspaceId, userId, query, page) => {
      calls.push({ workspaceId, userId, query, page });
      return Promise.resolve({
        candidates,
        hasMore: false,
        truncated: false
      });
    },
    ...overrides
  };
  const service = createMessageSearchService({
    repository: createMessageSearchRepository(storage),
    rateLimiter,
    findUsersByIds: (ids) => Promise.resolve(ids.map((id) => ({
      id,
      name: id === "peer" ? "Direct Teammate" : "Channel Teammate",
      image: null
    })))
  });
  return { service, calls };
};

const createRollingLimiter = (now: () => number): SharedRateLimiter => {
  const eventsByKey = new Map<string, number[]>();
  return {
    consume: (key, limit, windowMs) => {
      const currentTime = now();
      const cutoff = currentTime - windowMs;
      const activeEvents = (eventsByKey.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
      if (activeEvents.length >= limit) {
        const oldestEvent = Math.min(...activeEvents);
        return Promise.resolve({
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((oldestEvent + windowMs - currentTime) / 1_000))
        });
      }
      eventsByKey.set(key, [...activeEvents, currentTime]);
      return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
    }
  };
};

void test("normalizes plain-text queries and makes snippets safely bounded", () => {
  assert.equal(normalizeMessageSearchQuery('Roadmap "$where" 2026'), "Roadmap where 2026");
  assert.equal(normalizeMessageSearchQuery("!@#$%^"), "");
  const snippet = createMessageSnippet(`${"x".repeat(100)} roadmap decision${"y".repeat(100)}`, "roadmap");
  assert.ok(snippet.startsWith("…"));
  assert.ok(snippet.endsWith("…"));
  assert.ok(snippet.includes("roadmap decision"));
  assert.ok(snippet.length <= 182);
});

void test("searches with authenticated scope and returns relevance-ranked privacy-safe result DTOs", async () => {
  const { service, calls } = createService();
  const result = await service.search("workspace-1", "user-1", "roadmap", 1);

  assert.equal(result.kind, "listed");
  assert.deepEqual(calls[0], {
    workspaceId: "workspace-1",
    userId: "user-1",
    query: "roadmap",
    page: 1
  });
  assert.deepEqual(result.response.results.map(({ id }) => id), ["direct-message", "channel-message"]);
  assert.deepEqual(result.response.results[0]?.conversation, {
    type: "direct",
    id: "dm-1",
    name: "Direct Teammate"
  });
  assert.equal(result.response.results[1]?.conversation.name, "#general");
  assert.equal("text" in result.response.results[0], false);
});

void test("rejects invalid queries and page bounds before querying storage", async () => {
  const { service, calls } = createService();
  assert.deepEqual(await service.search("workspace-1", "user-1", "!!!", 1), { kind: "invalid" });
  assert.deepEqual(await service.search("workspace-1", "user-1", "x".repeat(101), 1), { kind: "invalid" });
  assert.deepEqual(await service.search("workspace-1", "user-1", "roadmap", 21), { kind: "invalid" });
  assert.equal(calls.length, 0);
});

void test("limits each member to 30 searches per rolling minute without recording query text", async () => {
  let currentTime = 1_000;
  const { service, calls } = createService({}, createRollingLimiter(() => currentTime));
  for (let index = 0; index < 30; index += 1) {
    assert.equal((await service.search("workspace-1", "user-1", `roadmap ${String(index)}`, 1)).kind, "listed");
  }
  assert.deepEqual(await service.search("workspace-1", "user-1", "private content", 1), {
    kind: "rate-limited",
    retryAfterSeconds: 60
  });
  currentTime += 60_001;
  assert.equal((await service.search("workspace-1", "user-1", "roadmap", 1)).kind, "listed");
  assert.equal(calls.length, 31);
});

void test("shares the 30-search quota across independent service instances by user", async () => {
  let currentTime = 1_000;
  const rateLimiter = createRollingLimiter(() => currentTime);
  const first = createService({}, rateLimiter).service;
  const second = createService({}, rateLimiter).service;
  for (let index = 0; index < 30; index += 1) {
    const service = index % 2 === 0 ? first : second;
    assert.equal((await service.search("workspace-1", "user-1", "roadmap", 1)).kind, "listed");
  }
  assert.deepEqual(await second.search("workspace-1", "user-1", "roadmap", 1), {
    kind: "rate-limited",
    retryAfterSeconds: 60
  });
  assert.equal((await second.search("workspace-1", "user-2", "roadmap", 1)).kind, "listed");
  currentTime += 60_001;
  assert.equal((await first.search("workspace-1", "user-1", "roadmap", 1)).kind, "listed");
});

void test("surfaces unavailable search storage instead of returning empty results", async () => {
  const error = Object.assign(new Error("text index missing"), { kind: "message-search-storage-unavailable" });
  const { service } = createService({
    searchForMember: () => Promise.reject(error)
  });
  assert.deepEqual(await service.search("workspace-1", "user-1", "roadmap", 1), { kind: "unavailable" });
});

void test("fails search closed when shared rate-limit storage is unavailable", async () => {
  const { service, calls } = createService({}, {
    consume: () => Promise.reject(new Error("MongoDB unavailable"))
  });
  assert.deepEqual(await service.search("workspace-1", "user-1", "roadmap", 1), { kind: "unavailable" });
  assert.equal(calls.length, 0);
});
