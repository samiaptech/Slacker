import test from "node:test";
import assert from "node:assert/strict";
import type { MongoDatabase, MongoTransaction } from "../../../integrations/mongodb/index.js";
import {
  CHANNEL_MESSAGES_COLLECTION,
  CHANNEL_MESSAGES_COLLECTION_VALIDATOR,
  CHANNEL_MESSAGES_INDEXES,
  CHANNEL_MEMBERSHIPS_COLLECTION,
  CHANNELS_COLLECTION
} from "../models/index.js";
import type { ChannelMessageDocument } from "../models/index.js";
import {
  MESSAGE_REACTIONS_COLLECTION,
  MESSAGE_REACTIONS_COLLECTION_VALIDATOR,
  MESSAGE_REACTIONS_INDEXES
} from "../../message-reactions/public/index.js";
import { createMongoChannelMessageStorage } from "../integrations/index.js";

void test("accepts MongoDB's normalized representation of the channel message text index", async () => {
  let metadataReads = 0;
  let indexReads = 0;
  let sessionReadsInFlight = 0;
  let overlappingSessionReads = false;
  const calls: string[] = [];
  const messages = CHANNEL_MESSAGES_INDEXES.map((index) => ({
    name: index.options.name,
    key: Object.values(index.keys).includes("text")
      ? { _fts: "text", _ftsx: 1 }
      : index.keys,
    ...(Object.values(index.keys).includes("text") ? { weights: { text: 1 } } : {}),
    unique: index.options.unique
  }));
  const reactionIndexes = MESSAGE_REACTIONS_INDEXES.map((index) => ({
    name: index.options.name,
    key: index.keys,
    unique: index.options.unique,
    ...(index.options.name === "message_reaction_active_user_unique"
      ? { partialFilterExpression: { active: true } }
      : {})
  }));
  const database = {
    listCollections: ({ name }: Readonly<{ name: string }>) => ({
      next: () => {
        metadataReads += 1;
        return Promise.resolve({
          name,
          options: { validator: name === MESSAGE_REACTIONS_COLLECTION
            ? MESSAGE_REACTIONS_COLLECTION_VALIDATOR
            : CHANNEL_MESSAGES_COLLECTION_VALIDATOR }
        });

        void test("requires channel membership, hides per user, and restricts global deletion to authors or admins", async () => {
          const attachment = {
            id: "attachment-1",
            name: "file.txt",
            mimeType: "text/plain",
            size: 4,
            publicId: "private/file",
            resourceType: "raw" as const,
            format: "txt"
          };
          const calls: string[] = [];
          const message = {
            _id: "message-1",
            channelId: "channel-1",
            senderId: "author-1",
            text: "hello",
            createdAt: new Date(),
            attachments: [attachment]
          };
          const definitions = CHANNEL_MESSAGES_INDEXES.map((index) => ({
            name: index.options.name,
            key: Object.values(index.keys).includes("text") ? { _fts: "text", _ftsx: 1 } : index.keys,
            ...(Object.values(index.keys).includes("text") ? { weights: { text: 1 } } : {}),
            unique: index.options.unique
          }));
          const database = {
            listCollections: ({ name }: Readonly<{ name: string }>) => ({
              next: () => Promise.resolve({
                name,
                options: { validator: name === MESSAGE_REACTIONS_COLLECTION
                  ? MESSAGE_REACTIONS_COLLECTION_VALIDATOR
                  : CHANNEL_MESSAGES_COLLECTION_VALIDATOR }
              })
            }),
            collection: (name: string) => ({
              indexes: () => Promise.resolve(name === MESSAGE_REACTIONS_COLLECTION
                ? reactionIndexes
                : definitions),
              findOne: () => Promise.resolve(name === CHANNELS_COLLECTION
                ? { _id: "channel-1", workspaceId: "workspace-1" }
                : name === CHANNEL_MEMBERSHIPS_COLLECTION ? { channelId: "channel-1", userId: "member-1" } : message),
              updateOne: (_filter: unknown, update: unknown) => {
                calls.push(`update:${name}:${JSON.stringify(update)}`);
                return Promise.resolve({ matchedCount: 1 });
              },
              deleteOne: () => {
                calls.push(`delete:${name}`);
                return Promise.resolve({ deletedCount: 1 });
              },
              deleteMany: () => Promise.resolve({ deletedCount: 0 })
            })
          } as unknown as MongoDatabase;
          const storage = createMongoChannelMessageStorage(database, (operation) => operation({} as never));

          assert.deepEqual(await storage.deleteForMember(
            "workspace-1", "channel-1", "member-1", "message-1", "me", false
          ), { kind: "deleted", attachments: [] });
          assert.equal(calls.some((call) => call.includes("$addToSet")), true);
          assert.deepEqual(await storage.deleteForMember(
            "workspace-1", "channel-1", "member-1", "message-1", "everyone", false
          ), { kind: "forbidden" });
          assert.equal(calls.some((call) => call.startsWith(`delete:${CHANNEL_MESSAGES_COLLECTION}`)), false);
          assert.deepEqual(await storage.deleteForMember(
            "workspace-1", "channel-1", "member-1", "message-1", "everyone", true
          ), { kind: "deleted", attachments: [attachment] });
          assert.equal(calls.some((call) => call === `delete:${CHANNEL_MESSAGES_COLLECTION}`), true);
        });
      }
    }),
    collection: (name: string) => ({
      indexes: () => {
        indexReads += 1;
        return Promise.resolve(name === MESSAGE_REACTIONS_COLLECTION ? reactionIndexes : messages);
      },
      findOne: async (_filter: unknown, options?: Readonly<{ session?: unknown }>) => {
        if (options?.session) {
          sessionReadsInFlight += 1;
          if (sessionReadsInFlight > 1) overlappingSessionReads = true;
          await new Promise((resolve) => setTimeout(resolve, 0));
          sessionReadsInFlight -= 1;
        }
        calls.push(`findOne:${name}`);
        return name === CHANNELS_COLLECTION ? { _id: "channel-1" } : {
          _id: "membership-1",
          channelId: "channel-1",
          userId: "user-1"
        };
      },
      updateOne: () => {
        calls.push(`updateOne:${name}`);
        return Promise.resolve({ matchedCount: 1 });
      },
      insertOne: () => {
        calls.push(`insertOne:${name}`);
        return Promise.resolve({});
      },
      find: () => ({
        sort: () => ({
          limit: () => ({ toArray: () => Promise.resolve([]) })
        })
      }),
      aggregate: () => ({ toArray: () => Promise.resolve([]) })
    })
  } as unknown as MongoDatabase;
  const withTransaction: MongoTransaction = (operation) => operation({} as never);

  const storage = createMongoChannelMessageStorage(database, withTransaction);
  const result = await storage.findForMember("workspace-1", "channel-1", "user-1", { pageSize: 20, before: null });
  assert.deepEqual(result, { kind: "listed", messages: [] });
  await storage.findForMember("workspace-1", "channel-1", "user-1", { pageSize: 20, before: null });
  await storage.findForMember("workspace-1", "channel-1", "user-1", { pageSize: 20, before: null });
  assert.equal(metadataReads, 2);
  assert.equal(indexReads, 2);
  assert.deepEqual(await storage.listReactionsForMember?.(
    "workspace-1", "channel-1", "user-1", ["message-1"]
  ), []);
  assert.equal(overlappingSessionReads, false);

  calls.length = 0;
  assert.equal(await storage.createForMember("workspace-1", "channel-1", "user-1", {
    _id: "message-1",
    channelId: "channel-1",
    senderId: "user-1",
    text: "hello",
    createdAt: new Date("2026-10-22T00:00:00.000Z")
  }), "created");
  assert.deepEqual(calls, [
    `findOne:${CHANNEL_MEMBERSHIPS_COLLECTION}`,
    `updateOne:${CHANNELS_COLLECTION}`,
    `insertOne:${CHANNEL_MESSAGES_COLLECTION}`
  ]);
});

void test("edits channel messages only for members/authors and compares editedAt in the write filter", async () => {
  const message = {
    _id: "message-1",
    channelId: "channel-1",
    senderId: "author",
    text: "original",
    createdAt: new Date("2026-10-22T00:00:00.000Z")
  };
  const indexes = CHANNEL_MESSAGES_INDEXES.map((index) => ({
    name: index.options.name,
    key: Object.values(index.keys).includes("text") ? { _fts: "text", _ftsx: 1 } : index.keys,
    ...(Object.values(index.keys).includes("text") ? { weights: { text: 1 } } : {}),
    unique: index.options.unique
  }));
  const reactionIndexes = MESSAGE_REACTIONS_INDEXES.map((index) => ({
    name: index.options.name,
    key: index.keys,
    unique: index.options.unique,
    ...(index.options.name === "message_reaction_active_user_unique"
      ? { partialFilterExpression: { active: true } }
      : {})
  }));
  let writeFilter: unknown;
  let writeUpdate: unknown;
  const database = {
    listCollections: ({ name }: Readonly<{ name: string }>) => ({
      next: () => Promise.resolve({
        name,
        options: { validator: name === MESSAGE_REACTIONS_COLLECTION
          ? MESSAGE_REACTIONS_COLLECTION_VALIDATOR
          : CHANNEL_MESSAGES_COLLECTION_VALIDATOR }
      })
    }),
    collection: (name: string) => ({
      indexes: () => Promise.resolve(name === MESSAGE_REACTIONS_COLLECTION ? reactionIndexes : indexes),
      findOne: (filter: Readonly<Record<string, unknown>>) => Promise.resolve(
        name === CHANNELS_COLLECTION
          ? { _id: "channel-1", workspaceId: "workspace-1" }
          : name === CHANNEL_MEMBERSHIPS_COLLECTION
            ? filter.userId === "author" ? { channelId: "channel-1", userId: "author" } : null
            : message
      ),
      updateOne: (filter: unknown, update: unknown) => {
        writeFilter = filter;
        writeUpdate = update;
        return Promise.resolve({ matchedCount: 1 });
      },
      aggregate: () => ({ toArray: () => Promise.resolve([]) })
    })
  } as unknown as MongoDatabase;
  const storage = createMongoChannelMessageStorage(database, (operation) => operation({} as never));
  const expectedEditedAt = new Date("2026-10-22T00:00:00.000Z");
  const editedAt = new Date("2026-10-22T00:00:00.001Z");

  assert.deepEqual(await storage.editForMember(
    "workspace-1", "channel-1", "outsider", "message-1", "edited", null, editedAt
  ), { kind: "not-found" });
  assert.deepEqual(await storage.editForMember(
    "workspace-1", "channel-1", "author", "message-1", "edited", expectedEditedAt, editedAt
  ), { kind: "conflict" });
  const edited = await storage.editForMember(
    "workspace-1", "channel-1", "author", "message-1", "edited", null, editedAt
  );
  assert.equal(edited.kind, "updated");
  assert.deepEqual((writeFilter as { $or: unknown }).$or, [
    { editedAt: { $exists: false } },
    { editedAt: null }
  ]);
  assert.deepEqual(writeUpdate, { $set: { text: "edited", editedAt } });
});

void test("keeps replies out of main history and updates a member-authorized root atomically", async () => {
  const indexRows = CHANNEL_MESSAGES_INDEXES.map((index) => ({
    name: index.options.name,
    key: Object.values(index.keys).includes("text")
      ? { _fts: "text", _ftsx: 1 }
      : index.keys,
    ...(Object.values(index.keys).includes("text") ? { weights: { text: 1 } } : {}),
    unique: index.options.unique
  }));
  const reactionIndexRows = MESSAGE_REACTIONS_INDEXES.map((index) => ({
    name: index.options.name,
    key: index.keys,
    unique: index.options.unique,
    ...(index.options.name === "message_reaction_active_user_unique"
      ? { partialFilterExpression: { active: true } }
      : {})
  }));
  const root: ChannelMessageDocument = {
    _id: "root-1",
    channelId: "channel-1",
    senderId: "author",
    text: "question",
    createdAt: new Date("2026-10-22T00:00:00.000Z")
  };
  const oldReply: ChannelMessageDocument = {
    _id: "reply-0",
    channelId: "channel-1",
    senderId: "member",
    text: "earlier reply",
    createdAt: new Date("2026-10-22T00:01:00.000Z"),
    threadRootId: "root-1"
  };
  const calls: Readonly<{ name: string; kind: string; filter?: unknown; update?: unknown; document?: unknown }>[] = [];
  let replyCount = 0;
  let lastReplyAt: Date | undefined;
  const currentRoot = (): ChannelMessageDocument => ({
    ...root,
    ...(replyCount > 0 && lastReplyAt
      ? { threadReplyCount: replyCount, threadLastReplyAt: lastReplyAt }
      : {})
  });
  const database = {
    listCollections: ({ name }: Readonly<{ name: string }>) => ({
      next: () => Promise.resolve({
        name,
        options: {
          validator: name === MESSAGE_REACTIONS_COLLECTION
            ? MESSAGE_REACTIONS_COLLECTION_VALIDATOR
            : CHANNEL_MESSAGES_COLLECTION_VALIDATOR
        }
      })
    }),
    collection: (name: string) => {
      const cursor = {
        sort: () => cursor,
        limit: () => cursor,
        toArray: () => Promise.resolve(name === CHANNEL_MESSAGES_COLLECTION
          ? [currentRoot(), oldReply]
          : [])
      };
      return {
        indexes: () => Promise.resolve(name === MESSAGE_REACTIONS_COLLECTION
          ? reactionIndexRows
          : indexRows),
        findOne: (filter: Readonly<Record<string, unknown>>) => {
          calls.push({ name, kind: "findOne", filter });
          return Promise.resolve(name === CHANNELS_COLLECTION
            ? { _id: "channel-1", workspaceId: "workspace-1" }
            : name === CHANNEL_MEMBERSHIPS_COLLECTION
              ? { channelId: "channel-1", userId: "member" }
              : currentRoot());
        },
        find: (filter: unknown) => {
          calls.push({ name, kind: "find", filter });
          return cursor;
        },
        updateOne: (filter: unknown, update: Readonly<Record<string, unknown>>) => {
          calls.push({ name, kind: "updateOne", filter, update });
          if (name === CHANNEL_MESSAGES_COLLECTION && "$inc" in update) {
            replyCount += 1;
            lastReplyAt = newReply.createdAt;
          }
          return Promise.resolve({ matchedCount: 1 });
        },
        insertOne: (document: ChannelMessageDocument) => {
          calls.push({ name, kind: "insertOne", document });
          return Promise.resolve({});
        }
      };
    }
  } as unknown as MongoDatabase;
  const storage = createMongoChannelMessageStorage(database, (operation) => operation({} as never));
  const newReply: ChannelMessageDocument = {
    _id: "reply-1",
    channelId: "channel-1",
    senderId: "member",
    text: "answer",
    createdAt: new Date("2026-10-22T00:02:00.000Z"),
    threadRootId: "root-1"
  };

  const mainPage = await storage.findForMember(
    "workspace-1", "channel-1", "member", { pageSize: 20, before: null }
  );
  assert.equal(mainPage.kind, "listed");
  assert.deepEqual(calls.find(({ kind }) => kind === "find")?.filter, {
    channelId: "channel-1",
    threadRootId: { $exists: false },
    hiddenForUserIds: { $nin: ["member"] }
  });

  const findThreadForMember = storage.findThreadForMember;
  if (!findThreadForMember) throw new Error("Thread storage is not configured.");
  const threadPage = await findThreadForMember(
    "workspace-1", "channel-1", "member", "root-1", { pageSize: 20, before: null }
  );
  assert.equal(threadPage.kind, "listed");
  assert.equal(threadPage.root._id, "root-1");
  const messageQueries = calls.filter(({ name, kind }) =>
    name === CHANNEL_MESSAGES_COLLECTION && kind === "find");
  assert.deepEqual(messageQueries[1]?.filter, {
    channelId: "channel-1",
    threadRootId: "root-1",
    hiddenForUserIds: { $nin: ["member"] }
  });

  const createThreadReplyForMember = storage.createThreadReplyForMember;
  if (!createThreadReplyForMember) throw new Error("Thread reply storage is not configured.");
  const created = await createThreadReplyForMember(
    "workspace-1", "channel-1", "member", "root-1", newReply
  );
  assert.equal(created.kind, "created");
  assert.deepEqual(created.thread, { replyCount: 1, lastReplyAt: newReply.createdAt });
  const parentUpdate = calls.find(({ name, kind, update }) =>
    name === CHANNEL_MESSAGES_COLLECTION && kind === "updateOne"
    && typeof update === "object" && update !== null && "$inc" in update);
  assert.deepEqual(parentUpdate?.update, {
    $inc: { threadReplyCount: 1 },
    $max: { threadLastReplyAt: newReply.createdAt }
  });
  const insert = calls.find(({ kind }) => kind === "insertOne");
  assert.deepEqual(insert?.document, newReply);
});

void test("deleting a thread root cascades replies, reactions, and attachment cleanup metadata", async () => {
  const indexRows = CHANNEL_MESSAGES_INDEXES.map((index) => ({
    name: index.options.name,
    key: Object.values(index.keys).includes("text")
      ? { _fts: "text", _ftsx: 1 }
      : index.keys,
    ...(Object.values(index.keys).includes("text") ? { weights: { text: 1 } } : {}),
    unique: index.options.unique
  }));
  const reactionIndexRows = MESSAGE_REACTIONS_INDEXES.map((index) => ({
    name: index.options.name,
    key: index.keys,
    unique: index.options.unique,
    ...(index.options.name === "message_reaction_active_user_unique"
      ? { partialFilterExpression: { active: true } }
      : {})
  }));
  const rootAttachment = {
    id: "root-file",
    name: "root.txt",
    mimeType: "text/plain",
    size: 5,
    publicId: "private/root",
    resourceType: "raw" as const,
    format: "txt"
  };
  const replyAttachment = { ...rootAttachment, id: "reply-file", publicId: "private/reply" };
  const root: ChannelMessageDocument = {
    _id: "root-1",
    channelId: "channel-1",
    senderId: "author",
    text: "question",
    createdAt: new Date("2026-10-22T00:00:00.000Z"),
    threadReplyCount: 1,
    threadLastReplyAt: new Date("2026-10-22T00:01:00.000Z"),
    attachments: [rootAttachment]
  };
  const replies: readonly ChannelMessageDocument[] = [{
    _id: "reply-1",
    channelId: "channel-1",
    senderId: "member",
    text: "answer",
    createdAt: new Date("2026-10-22T00:01:00.000Z"),
    threadRootId: "root-1",
    attachments: [replyAttachment]
  }];
  const deletes: Readonly<{ name: string; filter: unknown }>[] = [];
  const database = {
    listCollections: ({ name }: Readonly<{ name: string }>) => ({
      next: () => Promise.resolve({
        name,
        options: { validator: name === MESSAGE_REACTIONS_COLLECTION
          ? MESSAGE_REACTIONS_COLLECTION_VALIDATOR
          : CHANNEL_MESSAGES_COLLECTION_VALIDATOR }
      })
    }),
    collection: (name: string) => {
      const cursor = { toArray: () => Promise.resolve(replies) };
      return {
        indexes: () => Promise.resolve(name === MESSAGE_REACTIONS_COLLECTION
          ? reactionIndexRows
          : indexRows),
        findOne: (filter: Readonly<Record<string, unknown>>) => Promise.resolve(
          name === CHANNELS_COLLECTION
            ? { _id: "channel-1", workspaceId: "workspace-1" }
            : name === CHANNEL_MEMBERSHIPS_COLLECTION
              ? { channelId: "channel-1", userId: "author" }
              : filter._id === "root-1" ? root : null
        ),
        updateOne: () => Promise.resolve({ matchedCount: 1 }),
        find: () => cursor,
        deleteOne: () => Promise.resolve({ deletedCount: 1 }),
        deleteMany: (filter: unknown) => {
          deletes.push({ name, filter });
          return Promise.resolve({ deletedCount: 1 });
        }
      };
    }
  } as unknown as MongoDatabase;
  const storage = createMongoChannelMessageStorage(database, (operation) => operation({} as never));

  const result = await storage.deleteForMember(
    "workspace-1", "channel-1", "author", "root-1", "everyone", false
  );
  assert.deepEqual(result, {
    kind: "deleted",
    attachments: [rootAttachment, replyAttachment]
  });
  assert.deepEqual(deletes, [
    { name: CHANNEL_MESSAGES_COLLECTION, filter: { channelId: "channel-1", threadRootId: "root-1" } },
    {
      name: MESSAGE_REACTIONS_COLLECTION,
      filter: {
        workspaceId: "workspace-1",
        scope: "channel",
        parentId: "channel-1",
        messageId: { $in: ["root-1", "reply-1"] }
      }
    }
  ]);
});
