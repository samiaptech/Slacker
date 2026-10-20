import test from "node:test";
import assert from "node:assert/strict";
import type { ChannelMessage, ChannelMessagePageQuery } from "../domain/index.js";
import type { ChannelMessageRepository } from "../repositories/index.js";
import { createChannelMessageService } from "../services/index.js";

const message: ChannelMessage = Object.freeze({
  id: "message-1",
  channelId: "channel-1",
  senderId: "user-1",
  text: "Hello, channel!",
  createdAt: new Date("2026-10-15T12:00:00.000Z")
});

const createService = (
  overrides: Partial<ChannelMessageRepository> = {},
  findUsersByIds: (ids: readonly string[]) => Promise<readonly Readonly<{
    id: string;
    name: string;
    image: string | null;
  }>[]>
    = (ids) => Promise.resolve(ids.includes("user-1")
      ? [{ id: "user-1", name: "Channel Member", image: "https://example.test/avatar.png" }]
      : [])
) => {
  const calls: Readonly<Record<string, unknown>>[] = [];
  const repository: ChannelMessageRepository = {
    initialize: () => Promise.resolve(),
    findForMember: (_workspaceId, channelId, userId, query: ChannelMessagePageQuery) => {
      calls.push({ operation: "list", channelId, userId, query });
      return Promise.resolve({
        kind: "listed" as const,
        messages: Object.freeze([message]),
        nextCursor: null
      });
    },
    createForMember: (_workspaceId, channelId, userId, record) => {
      calls.push({ operation: "send", channelId, userId, record });
      return Promise.resolve("created" as const);
    },
    ...overrides
  };
  const service = createChannelMessageService({
    repository,
    createId: () => "message-created",
    now: () => new Date("2026-10-15T12:00:00.000Z"),
    findUsersByIds
  });
  return { service, calls };
};

void test("reads only through the member-authorized repository and resolves privacy-safe sender details", async () => {
  const { service, calls } = createService();
  const result = await service.list("workspace-1", "channel-1", "user-1", { pageSize: 20, before: null });

  assert.equal(result.kind, "listed");
  const firstMessage = result.messages[0];
  assert.ok(firstMessage);
  assert.deepEqual(firstMessage.sender, {
    id: "user-1",
    name: "Channel Member",
    image: "https://example.test/avatar.png"
  });
  assert.equal("email" in firstMessage.sender, false);
  assert.deepEqual(calls[0], {
    operation: "list",
    channelId: "channel-1",
    userId: "user-1",
    query: { pageSize: 20, before: null }
  });
});

void test("uses a deliberate fallback when an author's profile is no longer available", async () => {
  const { service } = createService({
    findForMember: () => Promise.resolve({ kind: "listed", messages: [message], nextCursor: null })
  }, () => Promise.resolve([]));
  const result = await service.list("workspace-1", "channel-1", "user-1", { pageSize: 20, before: null });
  assert.equal(result.kind, "listed");
  const firstMessage = result.messages[0];
  assert.ok(firstMessage);
  assert.deepEqual(firstMessage.sender, { id: "user-1", name: "Former member", image: null });
});

void test("rejects empty or oversized text before persistence and derives author from the caller identity", async () => {
  const { service, calls } = createService();
  assert.deepEqual(await service.send("workspace-1", "channel-1", "user-1", " \t "), {
    kind: "invalid",
    error: "message_required"
  });
  assert.equal((await service.send("workspace-1", "channel-1", "user-1", "🙂".repeat(4001))).kind, "invalid");
  const result = await service.send("workspace-1", "channel-1", "user-1", "Hello");
  assert.equal(result.kind, "sent");
  assert.equal(result.message.senderId, "user-1");
  assert.equal(result.message.text, "Hello");
  assert.equal(calls.filter((call) => call.operation === "send").length, 1);
});

void test("keeps unavailable storage explicit instead of reporting a successful send", async () => {
  const storageError = Object.assign(new Error("migration required"), { kind: "channel-storage-unavailable" as const });
  const { service } = createService({
    findForMember: () => Promise.reject(storageError)
  });
  assert.deepEqual(
    await service.list("workspace-1", "channel-1", "user-1", { pageSize: 20, before: null }),
    { kind: "unavailable" }
  );
});
