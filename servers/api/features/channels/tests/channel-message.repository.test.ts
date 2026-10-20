import test from "node:test";
import assert from "node:assert/strict";
import { encodeChannelMessageCursor, type ChannelMessage } from "../domain/index.js";
import type { ChannelMessageDocument } from "../models/index.js";
import { createChannelMessageRepository, type ChannelMessageStorage } from "../repositories/index.js";

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
    createForMember: () => Promise.resolve("created")
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
    createdAt
  });
});
