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
import { createMongoChannelMessageStorage } from "../integrations/index.js";

void test("accepts MongoDB's normalized representation of the channel message text index", async () => {
  let metadataReads = 0;
  let indexReads = 0;
  const calls: string[] = [];
  const messages = CHANNEL_MESSAGES_INDEXES.map((index) => ({
    name: index.options.name,
    key: Object.values(index.keys).includes("text")
      ? { _fts: "text", _ftsx: 1 }
      : index.keys,
    ...(Object.values(index.keys).includes("text") ? { weights: { text: 1 } } : {}),
    unique: index.options.unique
  }));
  const database = {
    listCollections: () => ({
      next: () => {
        metadataReads += 1;
        return Promise.resolve({
          name: CHANNEL_MESSAGES_COLLECTION,
          options: { validator: CHANNEL_MESSAGES_COLLECTION_VALIDATOR }
        });
      }
    }),
    collection: (name: string) => ({
      indexes: () => {
        indexReads += 1;
        return Promise.resolve(messages);
      },
      findOne: () => {
        calls.push(`findOne:${name}`);
        return Promise.resolve(name === CHANNELS_COLLECTION ? { _id: "channel-1" } : {
          _id: "membership-1",
          channelId: "channel-1",
          userId: "user-1"
        });
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
      })
    })
  } as unknown as MongoDatabase;
  const withTransaction: MongoTransaction = (operation) => operation({} as never);

  const storage = createMongoChannelMessageStorage(database, withTransaction);
  const result = await storage.findForMember("workspace-1", "channel-1", "user-1", { pageSize: 20, before: null });
  assert.deepEqual(result, { kind: "listed", messages: [] });
  await storage.findForMember("workspace-1", "channel-1", "user-1", { pageSize: 20, before: null });
  await storage.findForMember("workspace-1", "channel-1", "user-1", { pageSize: 20, before: null });
  assert.equal(metadataReads, 1);
  assert.equal(indexReads, 1);

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
