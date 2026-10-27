import test from "node:test";
import assert from "node:assert/strict";
import type { MongoDatabase, MongoTransaction } from "../../../integrations/mongodb/index.js";
import {
  DIRECT_CONVERSATIONS_COLLECTION,
  DIRECT_CONVERSATIONS_COLLECTION_VALIDATOR,
  DIRECT_CONVERSATIONS_INDEXES,
  DIRECT_MESSAGES_COLLECTION,
  DIRECT_MESSAGES_COLLECTION_VALIDATOR,
  DIRECT_MESSAGES_INDEXES
} from "../models/index.js";
import {
  MESSAGE_REACTIONS_COLLECTION,
  MESSAGE_REACTIONS_COLLECTION_VALIDATOR,
  MESSAGE_REACTIONS_INDEXES
} from "../../message-reactions/public/index.js";
import { createMongoDirectMessageStorage } from "../integrations/index.js";

const collectionDefinitions = [
  {
    name: DIRECT_CONVERSATIONS_COLLECTION,
    validator: DIRECT_CONVERSATIONS_COLLECTION_VALIDATOR,
    indexes: DIRECT_CONVERSATIONS_INDEXES
  },
  {
    name: DIRECT_MESSAGES_COLLECTION,
    validator: DIRECT_MESSAGES_COLLECTION_VALIDATOR,
    indexes: DIRECT_MESSAGES_INDEXES
  },
  {
    name: MESSAGE_REACTIONS_COLLECTION,
    validator: MESSAGE_REACTIONS_COLLECTION_VALIDATOR,
    indexes: MESSAGE_REACTIONS_INDEXES
  }
];

void test("accepts MongoDB's normalized direct-message text index during readiness checks", async () => {
  let metadataReads = 0;
  let indexReads = 0;
  const database = {
    listCollections: ({ name }: Readonly<{ name: string }>) => ({
      next: () => {
        metadataReads += 1;
        const definition = collectionDefinitions.find((collection) => collection.name === name);
        return Promise.resolve(definition
          ? { name, options: { validator: definition.validator } }
          : null);
      }
    }),
    collection: (name: string) => ({
      indexes: () => {
        indexReads += 1;
        return Promise.resolve(
            collectionDefinitions.find((collection) => collection.name === name)?.indexes.map((index) => ({
            name: index.options.name,
            key: Object.values(index.keys).includes("text")
              ? { _fts: "text", _ftsx: 1 }
            : index.keys,
            ...(Object.values(index.keys).includes("text") ? { weights: { text: 1 } } : {}),
            unique: index.options.unique,
            ...(index.options.name === "message_reaction_active_user_unique"
              ? { partialFilterExpression: { active: true } }
              : {})
            })) ?? []
        );
      },
      find: () => ({
        sort: () => ({
          limit: () => ({ toArray: () => Promise.resolve([]) })
        })
      })
    })
  } as unknown as MongoDatabase;
  const withTransaction: MongoTransaction = (operation) => operation({} as never);

  const storage = createMongoDirectMessageStorage(database, withTransaction);
  const result = await storage.listForMember("workspace-1", "user-1");
  await storage.listForMember("workspace-1", "user-1");
  await storage.listForMember("workspace-1", "user-1");

  assert.deepEqual(result, []);
  assert.equal(metadataReads, 3);
  assert.equal(indexReads, 3);
});

void test("scopes DM deletion to participants, persists personal hides, and applies admin override", async () => {
  const message = {
    _id: "message-1",
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    senderId: "alice",
    text: "private",
    createdAt: new Date()
  };
  const calls: Readonly<{ name: string; operation: string; value?: unknown }>[] = [];
  let historyFilter: unknown;
  let attachmentFilter: unknown;
  const database = {
    listCollections: ({ name }: Readonly<{ name: string }>) => ({
      next: () => {
        const definition = collectionDefinitions.find((entry) => entry.name === name);
        return Promise.resolve(definition
          ? { name, options: { validator: definition.validator } }
          : null);
      }
    }),
    collection: (name: string) => ({
      indexes: () => Promise.resolve(collectionDefinitions.find((entry) => entry.name === name)?.indexes.map((index) => ({
        name: index.options.name,
        key: Object.values(index.keys).includes("text") ? { _fts: "text", _ftsx: 1 } : index.keys,
        ...(Object.values(index.keys).includes("text") ? { weights: { text: 1 } } : {}),
        unique: index.options.unique,
        ...(index.options.name === "message_reaction_active_user_unique"
          ? { partialFilterExpression: { active: true } }
          : {})
      })) ?? []),
      findOne: (filter: Readonly<Record<string, unknown>>) => {
        if (name === DIRECT_MESSAGES_COLLECTION) attachmentFilter = filter;
        return Promise.resolve(name === DIRECT_CONVERSATIONS_COLLECTION
          ? filter.participantIds === "outsider" ? null : {
            _id: "conversation-1",
            workspaceId: "workspace-1",
            participantIds: ["alice", "bob"]
          }
          : message);
      },
      find: (filter: unknown) => {
        historyFilter = filter;
        const cursor = {
          sort: () => cursor,
          limit: () => cursor,
          toArray: () => Promise.resolve([])
        };
        return cursor;
      },
      updateOne: (_filter: unknown, update: unknown) => {
        calls.push({ name, operation: "update", value: update });
        return Promise.resolve({ matchedCount: 1 });
      },
      deleteOne: () => {
        calls.push({ name, operation: "delete" });
        return Promise.resolve({ deletedCount: 1 });
      },
      deleteMany: () => {
        calls.push({ name, operation: "deleteMany" });
        return Promise.resolve({ deletedCount: 0 });
      }
    })
  } as unknown as MongoDatabase;
  const storage = createMongoDirectMessageStorage(database, (operation) => operation({} as never));
  await storage.listMessagesForMember("workspace-1", "conversation-1", "bob", { pageSize: 20, before: null });
  assert.deepEqual((historyFilter as { hiddenForUserIds: unknown }).hiddenForUserIds, { $nin: ["bob"] });
  const findAttachmentForMember = storage.findAttachmentForMember;
  assert.ok(findAttachmentForMember);
  await findAttachmentForMember("workspace-1", "conversation-1", "bob", "message-1", "file-1");
  assert.deepEqual((attachmentFilter as { hiddenForUserIds: unknown }).hiddenForUserIds, { $nin: ["bob"] });

  assert.deepEqual(await storage.deleteMessageForMember(
    "workspace-1", "conversation-1", "outsider", "message-1", "everyone", true
  ), { kind: "not-found" });
  assert.deepEqual(await storage.deleteMessageForMember(
    "workspace-1", "conversation-1", "bob", "message-1", "everyone", false
  ), { kind: "forbidden" });
  assert.deepEqual(await storage.deleteMessageForMember(
    "workspace-1", "conversation-1", "bob", "message-1", "me", false
  ), { kind: "deleted", attachments: [] });
  assert.deepEqual(await storage.deleteMessageForMember(
    "workspace-1", "conversation-1", "bob", "message-1", "everyone", true
  ), { kind: "deleted", attachments: [] });
  assert.equal(calls.filter(({ operation }) => operation === "update").length, 1);
  assert.equal(calls.filter(({ operation }) => operation === "delete").length, 1);
});
