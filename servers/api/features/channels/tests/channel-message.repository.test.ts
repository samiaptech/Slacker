import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeChannelMessageCursor,
  encodeChannelMessageCursor,
  type ChannelMessage,
  type ChannelMessageCursor
} from "../domain/index.js";
import type { ChannelMessageDocument } from "../models/index.js";
import {
  createChannelMessageRepository,
  type ChannelMessageRepository,
  type ChannelMessageStorage
} from "../repositories/index.js";

const createdAt = new Date("2026-10-15T12:00:00.000Z");
const documents: readonly ChannelMessageDocument[] = [
  { _id: "message-3", channelId: "channel-1", senderId: "user-1", text: "third", createdAt },
  { _id: "message-2", channelId: "channel-1", senderId: "user-1", text: "second", createdAt },
  { _id: "message-1", channelId: "channel-1", senderId: "user-1", text: "first", createdAt }
];

void test("maps newest-first storage pages to chronological output with an ID cursor tie-breaker", async () => {
  const storage: ChannelMessageStorage = {
    initialize: () => Promise.resolve(),
    findForMember: () => Promise.resolve({ kind: "listed", messages: documents }),
    createForMember: () => Promise.resolve("created"),
    editForMember: () => Promise.resolve({ kind: "not-found" }),
    deleteForMember: () => Promise.resolve({ kind: "not-found" })
  };
  const repository = createChannelMessageRepository(storage);
  const page = await repository.findForMember("workspace-1", "channel-1", "user-1", {
    pageSize: 2,
    before: null
  });
  assert.equal(page.kind, "listed");
  assert.deepEqual(page.messages.map(({ id }) => id), ["message-2", "message-3"]);
  assert.equal(page.nextCursor, encodeChannelMessageCursor({ createdAt, id: "message-2" }));

  let received: ChannelMessageDocument | null = null;
  const writing = createChannelMessageRepository({
    ...storage,
    createForMember: (_workspaceId, _channelId, _userId, message) => {
      received = message;
      return Promise.resolve("created");
    }
  });
  const message: ChannelMessage = { id: "message-new", channelId: "channel-1", senderId: "user-1", text: "new", createdAt };
  assert.equal(await writing.createForMember("workspace-1", "channel-1", "user-1", message), "created");
  assert.deepEqual(received, {
    _id: "message-new",
    channelId: "channel-1",
    senderId: "user-1",
    text: "new",
    createdAt,
    type: "message"
  });
});

void test("pages through equal-timestamp messages without gaps or duplicates", async () => {
  const messages: readonly ChannelMessageDocument[] = Array.from({ length: 5 }, (_, index) => ({
    _id: `message-${String(index + 1)}`,
    channelId: "channel-1",
    senderId: "user-1",
    text: `message ${String(index + 1)}`,
    createdAt
  }));
  const repository = createChannelMessageRepository({
    initialize: () => Promise.resolve(),
    findForMember: (_workspaceId, _channelId, _userId, query) => {
      const eligible = messages.filter((message) => !query.before
        || message.createdAt < query.before.createdAt
        || (message.createdAt.getTime() === query.before.createdAt.getTime()
          && message._id < query.before.id));
      const newestFirst = [...eligible].sort((left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() || right._id.localeCompare(left._id));
      return Promise.resolve({
        kind: "listed",
        messages: newestFirst.slice(0, query.pageSize + 1)
      });
    },
    createForMember: () => Promise.resolve("created"),
    editForMember: () => Promise.resolve({ kind: "not-found" }),
    deleteForMember: () => Promise.resolve({ kind: "not-found" })
  });
  const pages: string[][] = [];
  let cursor: ChannelMessageCursor | null = null;
  let hasMore = true;
  while (hasMore) {
    const page: Awaited<ReturnType<ChannelMessageRepository["findForMember"]>> =
      await repository.findForMember("workspace-1", "channel-1", "user-1", {
        pageSize: 2,
        before: cursor
      });
    if (page.kind !== "listed") {
      throw new Error("The test member unexpectedly lost channel access.");
    }
    pages.push(page.messages.map(({ id }) => id));
    if (page.nextCursor === null) {
      hasMore = false;
      continue;
    }
    const decoded = decodeChannelMessageCursor(page.nextCursor);
    const oldest = page.messages[0];
    assert.ok(oldest);
    cursor = { createdAt: oldest.createdAt, id: oldest.id };
    assert.deepEqual(decoded, { ok: true, cursor });
  }

  assert.deepEqual(pages, [["message-4", "message-5"], ["message-2", "message-3"], ["message-1"]]);
  const allReceived = pages.flat();
  assert.deepEqual(allReceived.slice().sort(), messages.map(({ _id }) => _id).sort());
  assert.equal(new Set(allReceived).size, messages.length);
});

void test("maps thread replies in chronological pages and preserves the root summary", async () => {
  const lastReplyAt = new Date("2026-10-15T12:02:00.000Z");
  const root: ChannelMessageDocument = {
    _id: "root-1",
    channelId: "channel-1",
    senderId: "user-1",
    text: "question",
    createdAt,
    threadReplyCount: 2,
    threadLastReplyAt: lastReplyAt
  };
  const replies: readonly ChannelMessageDocument[] = [
    { _id: "reply-2", channelId: "channel-1", senderId: "user-2", text: "second", createdAt: lastReplyAt, threadRootId: "root-1" },
    { _id: "reply-1", channelId: "channel-1", senderId: "user-2", text: "first", createdAt, threadRootId: "root-1" }
  ];
  const newestReply = replies[0];
  if (!newestReply) throw new Error("The test thread requires a newest reply.");
  const repository = createChannelMessageRepository({
    initialize: () => Promise.resolve(),
    findForMember: () => Promise.resolve({ kind: "listed", messages: [] }),
    createForMember: () => Promise.resolve("created"),
    findThreadForMember: () => Promise.resolve({ kind: "listed", root, replies }),
    createThreadReplyForMember: () => Promise.resolve({
      kind: "created",
      reply: newestReply,
      thread: { replyCount: 2, lastReplyAt }
    }),
    editForMember: () => Promise.resolve({ kind: "not-found" }),
    deleteForMember: () => Promise.resolve({ kind: "not-found" })
  });

  const findThreadForMember = repository.findThreadForMember;
  if (!findThreadForMember) throw new Error("Thread repository is not configured.");
  const page = await findThreadForMember(
    "workspace-1", "channel-1", "user-1", "root-1", { pageSize: 1, before: null }
  );
  assert.equal(page.kind, "listed");
  assert.deepEqual(page.root.thread, { replyCount: 2, lastReplyAt });
  const firstReply = page.replies[0];
  assert.ok(firstReply);
  assert.equal(firstReply.id, "reply-2");
  assert.equal(firstReply.threadRootId, "root-1");
  assert.equal(page.nextCursor, encodeChannelMessageCursor({ createdAt: lastReplyAt, id: "reply-2" }));
});
