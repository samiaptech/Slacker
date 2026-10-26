import test from "node:test";
import assert from "node:assert/strict";
import type { MongoDatabase } from "../../../integrations/mongodb/index.js";
import {
  NOTIFICATIONS_COLLECTION,
  NOTIFICATIONS_COLLECTION_VALIDATOR,
  NOTIFICATIONS_INDEXES
} from "../model.js";
import { createMongoNotificationStorage } from "../mongo-storage.js";

void test("initializes durable notification storage and deduplicates per recipient and event", async () => {
  const documents = new Map<string, Record<string, unknown>>();
  const members = ["actor-1", "mention-1", "member-2"].map((userId) => ({ userId }));
  const notificationCollection = {
    createIndex: () => Promise.resolve("index"),
    indexes: () => Promise.resolve(NOTIFICATIONS_INDEXES.map((index) => ({
      name: index.options.name,
      key: index.keys,
      unique: index.options.unique
    }))),
    updateOne: (
      filter: Readonly<{ recipientId: string; eventId: string }>,
      update: { $setOnInsert: Record<string, unknown> }
    ) => {
      const key = `${filter.recipientId}:${filter.eventId}`;
      if (documents.has(key)) return Promise.resolve({ upsertedCount: 0 });
      documents.set(key, update.$setOnInsert);
      return Promise.resolve({ upsertedCount: 1 });
    }
  };
  const database = {
    createCollection: () => Promise.resolve(undefined),
    command: () => Promise.resolve(undefined),
    listCollections: () => ({
      next: () => Promise.resolve({
        name: NOTIFICATIONS_COLLECTION,
        options: { validator: NOTIFICATIONS_COLLECTION_VALIDATOR }
      })
    }),
    collection: (name: string) => name === NOTIFICATIONS_COLLECTION
      ? notificationCollection
      : name === "channel_memberships"
        ? { find: () => ({ toArray: () => Promise.resolve(members) }) }
        : { findOne: () => Promise.resolve(null) }
  } as unknown as MongoDatabase;

  const storage = createMongoNotificationStorage(database);
  await storage.initialize();
  const event = {
    eventId: "message-1",
    workspaceId: "workspace-1",
    resource: { type: "channel" as const, id: "channel-1" },
    type: "channel_message" as const,
    actor: { id: "actor-1", name: "Actor" },
    createdAt: new Date("2026-10-26T09:00:00.000Z")
  };
  const first = await storage.createForChannel(event, ["mention-1"]);
  const duplicate = await storage.createForChannel(event, ["mention-1"]);

  assert.deepEqual(first.map(({ recipientId, type }) => [recipientId, type]), [
    ["mention-1", "mention"],
    ["member-2", "channel_message"]
  ]);
  assert.deepEqual(duplicate, []);
  assert.equal(documents.has("actor-1:message-1"), false);
});
