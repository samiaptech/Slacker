import test from "node:test";
import assert from "node:assert/strict";
import {
  createDirectMessagePairKey,
  createDirectMessageRepository,
  createDirectMessageService,
  type DirectConversationDocument,
  type DirectMessageDocument,
  type DirectMessageStorage
} from "../index.js";

const createMemoryStorage = (): DirectMessageStorage => {
  const conversations = new Map<string, DirectConversationDocument>();
  const messages = new Map<string, DirectMessageDocument[]>();
  return Object.freeze({
    initialize: () => Promise.resolve(),
    openForMember: (workspaceId, conversation) => {
      const existing = conversations.get(`${workspaceId}:${conversation.pairKey}`);
      if (existing) return Promise.resolve(Object.freeze({
        kind: "opened" as const,
        conversation: existing,
        created: false
      }));
      conversations.set(`${workspaceId}:${conversation.pairKey}`, conversation);
      messages.set(conversation._id, []);
      return Promise.resolve(Object.freeze({ kind: "opened" as const, conversation, created: true }));
    },
    listForMember: (workspaceId, userId) => {
      return Promise.resolve([...conversations.values()].filter((conversation) =>
        conversation.workspaceId === workspaceId && conversation.participantIds.includes(userId)));
    },
    findForMember: (workspaceId, conversationId, userId) => Promise.resolve(
      [...conversations.values()].find((conversation) =>
        conversation.workspaceId === workspaceId && conversation._id === conversationId
        && conversation.participantIds.includes(userId)) ?? null
    ),
    listMessagesForMember: (workspaceId, conversationId, userId, query) => {
      const conversation = [...conversations.values()].find((entry) =>
        entry.workspaceId === workspaceId && entry._id === conversationId && entry.participantIds.includes(userId));
      if (!conversation) return Promise.resolve(null);
      const matchingMessages = messages.get(conversationId) ?? [];
      const before = query.before;
      const eligible = before
        ? matchingMessages.filter((message) =>
          message.createdAt < before.createdAt
          || (message.createdAt.getTime() === before.createdAt.getTime() && message._id < before.id))
        : matchingMessages;
      const newestFirst = [...eligible].sort((left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() || right._id.localeCompare(left._id));
      return Promise.resolve(newestFirst.slice(0, query.pageSize + 1));
    },
    createMessageForMember: (workspaceId, conversationId, userId, message) => {
      const conversation = [...conversations.values()].find((entry) =>
        entry.workspaceId === workspaceId && entry._id === conversationId && entry.participantIds.includes(userId));
      if (!conversation) return Promise.resolve(false);
      messages.get(conversationId)?.push(message);
      return Promise.resolve(true);
    }
  });
};

const createService = (
  storage: DirectMessageStorage,
  isWorkspaceMember: (workspaceId: string, userId: string) => Promise<"member" | "not-member" | "unavailable"> =
    (workspaceId, userId) => Promise.resolve(
      workspaceId === "workspace-1" && ["alice", "bob"].includes(userId) ? "member" : "not-member"
    )
) => createDirectMessageService({
  repository: createDirectMessageRepository(storage),
  isWorkspaceMember,
  createId: (() => {
    let sequence = 0;
    return () => `id-${String(++sequence)}`;
  })(),
  now: () => new Date("2026-10-20T00:00:00.000Z"),
  findUsersByIds: (userIds) => Promise.resolve(userIds.map((id) => ({
    id,
    name: id === "bob" ? "Bob" : "Alice",
    image: null
  })))
});

void test("opens one canonical DM for the same workspace member pair", async () => {
  const service = createService(createMemoryStorage());
  const first = await service.open("workspace-1", "alice", "bob");
  const reopened = await service.open("workspace-1", "bob", "alice");
  assert.equal(first.kind, "opened");
  assert.equal(reopened.kind, "opened");
  assert.equal(first.created, true);
  assert.equal(reopened.created, false);
  assert.equal(reopened.conversation.id, first.conversation.id);
  assert.deepEqual(reopened.conversation.otherParticipant, { id: "alice", name: "Alice", image: null });
  assert.equal(createDirectMessagePairKey("alice", "bob"), createDirectMessagePairKey("bob", "alice"));
});

void test("reports unavailable workspace membership without creating a DM", async () => {
  const service = createService(createMemoryStorage(), () => Promise.resolve("unavailable"));
  assert.deepEqual(
    await service.open("workspace-1", "alice", "bob"),
    { kind: "workspace-unavailable" }
  );
});

void test("rejects self DMs and recipients outside the active workspace", async () => {
  const service = createService(createMemoryStorage());
  assert.deepEqual(await service.open("workspace-1", "alice", "alice"), { kind: "self" });
  assert.deepEqual(await service.open("workspace-1", "alice", "outsider"), { kind: "recipient-unavailable" });
});

void test("stores messages only for participants and rejects blank text", async () => {
  const service = createService(createMemoryStorage());
  const opened = await service.open("workspace-1", "alice", "bob");
  assert.equal(opened.kind, "opened");
  assert.deepEqual(
    await service.send("workspace-1", opened.conversation.id, "alice", " \t "),
    { kind: "invalid", error: "message_required" }
  );
  const sent = await service.send("workspace-1", opened.conversation.id, "alice", "Hello privately");
  assert.equal(sent.kind, "sent");
  assert.equal((await service.listMessages("workspace-1", opened.conversation.id, "outsider", {
    pageSize: 50,
    before: null
  })).kind, "not-found");
  const history = await service.listMessages("workspace-1", opened.conversation.id, "bob", {
    pageSize: 50,
    before: null
  });
  assert.equal(history.kind, "listed");
  assert.equal(history.messages[0]?.text, "Hello privately");
});
