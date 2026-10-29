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
  const members = [
    { userId: "actor-1" },
    { userId: "mention-1", notificationPreference: "mentions_only" as const },
    { userId: "member-2" },
    { userId: "mentions-only-unmentioned", notificationPreference: "mentions_only" as const },
    { userId: "muted-user", notificationPreference: "muted" as const },
    { userId: "all-mention" }
  ];
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
        ? {
          find: () => {
            const cursor = {
              project: () => cursor,
              toArray: () => Promise.resolve(members)
            };
            return cursor;
          }
        }
        : {
          findOne: () => Promise.resolve({
            workspaceId: "workspace-1",
            participantIds: ["dm-recipient"]
          })
        }
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
  const mentionedUserIds = ["mention-1", "muted-user", "actor-1", "all-mention", "unknown-user"];
  const first = await storage.createForChannel(event, mentionedUserIds);
  const duplicate = await storage.createForChannel(event, mentionedUserIds);

  assert.deepEqual(first.map(({ recipientId, type }) => [recipientId, type]), [
    ["mention-1", "mention"],
    ["member-2", "channel_message"],
    ["all-mention", "mention"]
  ]);
  assert.deepEqual(duplicate, []);
  assert.equal(documents.has("actor-1:message-1"), false);
  assert.equal(documents.has("muted-user:message-1"), false);

  for (const [index, type] of ([
    "channel_member_joined",
    "channel_member_left",
    "channel_updated"
  ] as const).entries()) {
    const eventId = `channel-activity-${String(index)}`;
    const activity = await storage.createForChannel({ ...event, eventId, type }, []);
    assert.deepEqual(activity.map(({ recipientId, type: notificationType }) =>
      [recipientId, notificationType]), [["member-2", type], ["all-mention", type]]);
    assert.equal(documents.has(`mentions-only-unmentioned:${eventId}`), false);
    assert.equal(documents.has(`muted-user:${eventId}`), false);
  }

  const directMessage = await storage.createForDirectMessage({
    ...event,
    eventId: "direct-message",
    resource: { type: "direct_message", id: "conversation-1" },
    type: "direct_message"
  });
  assert.deepEqual(directMessage.map(({ recipientId, type }) => [recipientId, type]), [
    ["dm-recipient", "direct_message"]
  ]);
});
