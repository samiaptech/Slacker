import test from "node:test";
import assert from "node:assert/strict";
import type { ChannelMessage, ChannelMessagePageQuery } from "../domain/index.js";
import type { ChannelMessageRepository } from "../repositories/index.js";
import type { ChatAttachmentRecord } from "../../../types/chat/index.js";
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
      : []),
  attachmentStorage?: Readonly<{
    upload: (file: Readonly<{ buffer: Buffer; name: string; size: number }>) => Promise<ChatAttachmentRecord>;
    delete: (attachment: ChatAttachmentRecord) => Promise<void>;
    download: (attachment: ChatAttachmentRecord) => Promise<Buffer>;
  }>
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
    editForMember: () => Promise.resolve({ kind: "not-found" as const }),
    deleteForMember: () => Promise.resolve({ kind: "not-found" as const }),
    ...overrides
  };
  const service = createChannelMessageService({
    repository,
    ...(attachmentStorage ? { attachmentStorage } : {}),
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

void test("loads channel sender profiles while message reactions are being fetched", async () => {
  let reactionLookupStarted = false;
  let resolveProfiles: ((profiles: readonly Readonly<{
    id: string;
    name: string;
    image: string | null;
  }>[]) => void) | undefined;
  const { service } = createService({
    listReactionsForMember: () => {
      reactionLookupStarted = true;
      return Promise.resolve([]);
    }
  }, (ids) => ids.length === 0
    ? Promise.resolve([])
    : new Promise((resolve) => {
      resolveProfiles = resolve;
    }));
  const resultPromise = service.list("workspace-1", "channel-1", "user-1", {
    pageSize: 20,
    before: null
  });
  await Promise.resolve();

  assert.ok(reactionLookupStarted);
  assert.ok(resolveProfiles);
  resolveProfiles([{ id: "user-1", name: "Channel Member", image: null }]);
  assert.equal((await resultPromise).kind, "listed");
});

void test("lists a thread with its parent and reply authors", async () => {
  const reply: ChannelMessage = {
    ...message,
    id: "reply-1",
    senderId: "user-2",
    text: "an answer",
    threadRootId: message.id,
    thread: null
  };
  const { service } = createService({
    findThreadForMember: () => Promise.resolve({
      kind: "listed",
      root: { ...message, thread: { replyCount: 1, lastReplyAt: reply.createdAt } },
      replies: [reply],
      nextCursor: null
    })
  });
  const result = await service.listThread(
    "workspace-1", "channel-1", "user-1", message.id, { pageSize: 20, before: null }
  );
  assert.equal(result.kind, "listed");
  assert.equal(result.root.thread?.replyCount, 1);
  assert.deepEqual(result.replies[0]?.sender, {
    id: "user-2",
    name: "Former member",
    image: null
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

void test("uses the authenticated sender profile without a post-persistence profile query", async () => {
  let profileLookups = 0;
  const { service } = createService({}, () => {
    profileLookups += 1;
    return Promise.resolve([]);
  });

  void test("creates a reply against the supplied root without inserting it into channel history", async () => {
    const reply = { ...message, id: "reply-1", threadRootId: "root-1", thread: null };
    const calls: unknown[] = [];
    const lastReplyAt = new Date("2026-10-15T12:01:00.000Z");
    const { service } = createService({
      createThreadReplyForMember: (workspaceId, channelId, userId, rootMessageId, record) => {
        calls.push({ workspaceId, channelId, userId, rootMessageId, record });
        return Promise.resolve({
          kind: "created",
          reply,
          thread: { replyCount: 1, lastReplyAt }
        });
      }
    });

    const result = await service.send(
      "workspace-1",
      "channel-1",
      "user-1",
      "reply text",
      [],
      { name: "Channel Member", image: null },
      "root-1"
    );
    assert.equal(result.kind, "sent");
    assert.equal(result.message.threadRootId, "root-1");
    assert.deepEqual(result.thread, { replyCount: 1, lastReplyAt });
    assert.equal(calls.length, 1);
    assert.equal((calls[0] as { rootMessageId: string }).rootMessageId, "root-1");
  });

  const result = await service.send(
    "workspace-1",
    "channel-1",
    "user-1",
    "Hello",
    [],
    { name: "Channel Member", image: null }
  );

  assert.equal(result.kind, "sent");
  assert.deepEqual(result.message.sender, {
    id: "user-1",
    name: "Channel Member",
    image: null
  });
  assert.equal(profileLookups, 0);
});

void test("keeps unavailable storage explicit instead of reporting a successful send", async () => {
  const storageError = Object.assign(new Error("migration required"), { kind: "channel-storage-unavailable" as const });
  const { service } = createService({
    findForMember: () => Promise.reject(storageError)
  });

  void test("deletes messages with persisted scope and reports attachment cleanup failures", async () => {
    const attachment: ChatAttachmentRecord = {
      id: "attachment-delete",
      name: "file.txt",
      mimeType: "text/plain",
      size: 4,
      publicId: "private/delete-me",
      resourceType: "raw",
      format: "txt"
    };
    const deletionCalls: unknown[][] = [];
    const serviceWithCleanup = createService({
      deleteForMember: (...args) => {
        deletionCalls.push(args);
        return Promise.resolve({ kind: "deleted", attachments: [attachment] });
      }
    }, undefined, {
      upload: () => Promise.resolve(attachment),
      delete: () => Promise.resolve(),
      download: () => Promise.resolve(Buffer.alloc(0))
    }).service;

    assert.deepEqual(await serviceWithCleanup.delete(
      "workspace-1", "channel-1", "user-1", "message-1", "everyone", true
    ), { kind: "deleted" });
    assert.deepEqual(deletionCalls[0], [
      "workspace-1", "channel-1", "user-1", "message-1", "everyone", true
    ]);

    const cleanupFailed = createService({
      deleteForMember: () => Promise.resolve({ kind: "deleted", attachments: [attachment] })
    }, undefined, {
      upload: () => Promise.resolve(attachment),
      delete: () => Promise.reject(new Error("Cloudinary unavailable")),
      download: () => Promise.resolve(Buffer.alloc(0))
    }).service;
    assert.deepEqual(await cleanupFailed.delete(
      "workspace-1", "channel-1", "user-1", "message-1", "everyone", false
    ), { kind: "attachment-cleanup-failed" });

    const persistenceFailed = createService({
      deleteForMember: () => Promise.reject(Object.assign(new Error("database unavailable"), {
        kind: "channel-storage-unavailable" as const
      }))
    }).service;
    assert.deepEqual(await persistenceFailed.delete(
      "workspace-1", "channel-1", "user-1", "message-1", "everyone", true
    ), { kind: "unavailable" });
  });

  void test("stores private attachment metadata with a message and supports attachment-only sends", async () => {
    const attachment: ChatAttachmentRecord = {
      id: "attachment-1",
      name: "notes.txt",
      mimeType: "text/plain",
      size: 4,
      publicId: "nutshyll/chat/private-asset",
      resourceType: "raw",
      format: "txt"
    };
    const persisted: ChannelMessage[] = [];
    const { service } = createService({
      createForMember: (_workspaceId, _channelId, _userId, message) => {
        persisted.push(message);
        return Promise.resolve("created");
      }
    }, undefined, {
      upload: () => Promise.resolve(attachment),
      delete: () => Promise.resolve(),
      download: () => Promise.resolve(Buffer.from("file"))
    });

    const result = await service.send("workspace-1", "channel-1", "user-1", "", [{
      buffer: Buffer.from("file"),
      name: "notes.txt",
      size: 4
    }]);
    assert.equal(result.kind, "sent");
    const savedMessage = persisted[0];
    assert.ok(savedMessage);
    assert.equal(savedMessage.text, "");
    assert.deepEqual(savedMessage.attachments, [attachment]);
  });

  void test("deletes uploaded assets when persistence fails and avoids upload for non-members", async () => {
    const attachment: ChatAttachmentRecord = {
      id: "attachment-2",
      name: "notes.txt",
      mimeType: "text/plain",
      size: 4,
      publicId: "nutshyll/chat/private-asset-2",
      resourceType: "raw",
      format: "txt"
    };
    let deleteCount = 0;
    let uploadCount = 0;
    const attachmentStorage = {
      upload: () => {
        uploadCount += 1;
        return Promise.resolve(attachment);
      },
      delete: () => {
        deleteCount += 1;
        return Promise.resolve();
      },
      download: () => Promise.resolve(Buffer.alloc(0))
    };
    const storageError = Object.assign(new Error("database unavailable"), {
      kind: "channel-storage-unavailable" as const
    });

    void test("edits only valid text with a monotonic editedAt and preserves sender and reaction metadata", async () => {
      const expectedEditedAt = new Date("2026-10-15T12:00:00.000Z");
      const storedMessage: ChannelMessage = Object.freeze({
        ...message,
        text: "Updated channel text",
        editedAt: new Date("2026-10-15T12:00:00.001Z")
      });
      let editCall: readonly unknown[] | undefined;
      const { service } = createService({
        editForMember: (...args) => {
          editCall = args;
          return Promise.resolve({ kind: "updated", message: storedMessage, reactions: [] });
        }
      });

      const result = await service.edit(
        "workspace-1", "channel-1", "user-1", "message-1", "Updated channel text", expectedEditedAt
      );

      assert.equal(result.kind, "updated");
      assert.equal(result.message.text, "Updated channel text");
      assert.equal(result.message.editedAt?.toISOString(), "2026-10-15T12:00:00.001Z");
      assert.deepEqual(result.message.sender, {
        id: "user-1",
        name: "Channel Member",
        image: "https://example.test/avatar.png"
      });
      assert.deepEqual(result.message.reactions, []);
      assert.deepEqual(editCall, [
        "workspace-1",
        "channel-1",
        "user-1",
        "message-1",
        "Updated channel text",
        expectedEditedAt,
        new Date("2026-10-15T12:00:00.001Z")
      ]);
    });

    void test("rejects blank and oversized edits before calling storage", async () => {
      let editCount = 0;
      const { service } = createService({
        editForMember: () => {
          editCount += 1;
          return Promise.resolve({ kind: "not-found" });
        }
      });

      assert.deepEqual(await service.edit("workspace-1", "channel-1", "user-1", "message-1", " \t ", null), {
        kind: "invalid",
        error: "message_required"
      });
      assert.deepEqual(await service.edit("workspace-1", "channel-1", "user-1", "message-1", "🙂".repeat(4001), null), {
        kind: "invalid",
        error: "message_too_long"
      });
      assert.equal(editCount, 0);
    });
    const failed = createService({
      createForMember: () => Promise.reject(storageError)
    }, undefined, attachmentStorage);
    assert.equal((await failed.service.send("workspace-1", "channel-1", "user-1", "", [{
      buffer: Buffer.from("file"),
      name: "notes.txt",
      size: 4
    }])).kind, "unavailable");
    assert.equal(deleteCount, 1);

    const denied = createService({
      findForMember: () => Promise.resolve({ kind: "channel-unavailable" as const })
    }, undefined, attachmentStorage);
    assert.equal((await denied.service.send("workspace-1", "channel-1", "user-2", "", [{
      buffer: Buffer.from("file"),
      name: "notes.txt",
      size: 4
    }])).kind, "channel-unavailable");
    assert.equal(uploadCount, 1);
  });
  assert.deepEqual(
    await service.list("workspace-1", "channel-1", "user-1", { pageSize: 20, before: null }),
    { kind: "unavailable" }
  );
});
