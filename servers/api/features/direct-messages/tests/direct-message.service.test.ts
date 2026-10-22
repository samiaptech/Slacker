import test from "node:test";
import assert from "node:assert/strict";
import {
  createDirectMessagePairKey,
  createDirectMessageRepository,
  createDirectMessageService,
  type DirectMessageService,
  type DirectConversationDocument,
  type DirectMessageDocument,
  type DirectMessageStorage
} from "../index.js";
import { decodeDirectMessageCursor, type DirectMessageCursor } from "../domain/index.js";
import type { ChatAttachmentRecord } from "../../../types/chat/index.js";

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
    ),
  attachmentStorage?: Readonly<{
    upload: (file: Readonly<{ buffer: Buffer; name: string; size: number }>) => Promise<ChatAttachmentRecord>;
    delete: (attachment: ChatAttachmentRecord) => Promise<void>;
    download: (attachment: ChatAttachmentRecord) => Promise<Buffer>;
  }>,
  findUsersByIds: (userIds: readonly string[]) => Promise<readonly Readonly<{
    id: string;
    name: string;
    image: string | null;
  }>[]>
    = (userIds) => Promise.resolve(userIds.map((id) => ({
      id,
      name: id === "bob" ? "Bob" : "Alice",
      image: null
    })))
) => createDirectMessageService({
  repository: createDirectMessageRepository(storage),
  ...(attachmentStorage ? { attachmentStorage } : {}),
  isWorkspaceMember,
  createId: (() => {
    let sequence = 0;
    return () => `id-${String(++sequence)}`;
  })(),
  now: () => new Date("2026-10-20T00:00:00.000Z"),
  findUsersByIds
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

  void test("persists private attachments on a DM and blocks uploads from non-participants", async () => {
    const attachment: ChatAttachmentRecord = {
      id: "attachment-1",
      name: "report.pdf",
      mimeType: "application/pdf",
      size: 5,
      publicId: "nutshyll/chat/private-report",
      resourceType: "raw",
      format: "pdf"
    };
    let uploadCount = 0;
    const attachmentStorage = {
      upload: () => {
        uploadCount += 1;
        return Promise.resolve(attachment);
      },
      delete: () => Promise.resolve(),
      download: () => Promise.resolve(Buffer.from("%PDF-"))
    };
    const storage = createMemoryStorage();
    const service = createService(storage, undefined, attachmentStorage);
    const opened = await service.open("workspace-1", "alice", "bob");
    assert.equal(opened.kind, "opened");

    const sent = await service.send("workspace-1", opened.conversation.id, "alice", "", [{
      buffer: Buffer.from("%PDF-"),
      name: "report.pdf",
      size: 5
    }]);
    assert.equal(sent.kind, "sent");
    assert.deepEqual(sent.message.attachments, [attachment]);
    assert.equal(sent.message.text, "");

    const denied = await service.send("workspace-1", opened.conversation.id, "mallory", "", [{
      buffer: Buffer.from("%PDF-"),
      name: "report.pdf",
      size: 5
    }]);
    assert.equal(denied.kind, "not-found");
    assert.equal(uploadCount, 1);
  });
  assert.equal(history.kind, "listed");
  assert.equal(history.messages[0]?.text, "Hello privately");
});

void test("uses the authenticated sender profile without a post-persistence profile query", async () => {
  let profileLookups = 0;
  const service = createService(createMemoryStorage(), undefined, undefined, (userIds) => {
    profileLookups += 1;
    return Promise.resolve(userIds.map((id) => ({ id, name: "Alice", image: null })));
  });
  const opened = await service.open("workspace-1", "alice", "bob");
  assert.equal(opened.kind, "opened");
  profileLookups = 0;

  const result = await service.send(
    "workspace-1",
    opened.conversation.id,
    "alice",
    "Hello",
    [],
    { name: "Alice", image: null }
  );

  assert.equal(result.kind, "sent");
  assert.equal(profileLookups, 0);
});

void test("paginates equal-timestamp DM history without gaps or duplicate messages", async () => {
  const service: DirectMessageService = createService(createMemoryStorage());
  const opened = await service.open("workspace-1", "alice", "bob");
  assert.ok("conversation" in opened);

  const sentIds: string[] = [];
  for (let index = 1; index <= 5; index += 1) {
    const result = await service.send("workspace-1", opened.conversation.id, "alice", `message ${String(index)}`);
    assert.ok("message" in result);
    sentIds.push(result.message.id);
  }

  const pages: string[][] = [];
  let before: DirectMessageCursor | null = null;
  let hasMore = true;
  while (hasMore) {
    const page = await service.listMessages("workspace-1", opened.conversation.id, "bob", {
      pageSize: 2,
      before
    });
    if (!("messages" in page)) {
      throw new Error("The test participant unexpectedly lost DM history access.");
    }
    pages.push(page.messages.map(({ id }) => id));
    if (!page.nextCursor) {
      hasMore = false;
      continue;
    }
    const decoded = decodeDirectMessageCursor(page.nextCursor);
    const oldest = page.messages[0];
    assert.ok(oldest);
    before = { createdAt: oldest.createdAt, id: oldest.id };
    assert.deepEqual(decoded, { ok: true, cursor: before });
  }

  assert.deepEqual(pages, [["id-5", "id-6"], ["id-3", "id-4"], ["id-2"]]);
  const receivedIds = pages.flat();
  assert.deepEqual(receivedIds.slice().sort(), sentIds.slice().sort());
  assert.equal(new Set(receivedIds).size, sentIds.length);
});
