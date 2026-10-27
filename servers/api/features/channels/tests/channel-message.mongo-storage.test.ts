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
import {
  MESSAGE_REACTIONS_COLLECTION,
  MESSAGE_REACTIONS_COLLECTION_VALIDATOR,
  MESSAGE_REACTIONS_INDEXES
} from "../../message-reactions/index.js";
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
