import test from "node:test";
import assert from "node:assert/strict";
import type {
  MongoDatabase,
  MongoTransactionSession
} from "../../../integrations/mongodb/index.js";
import {
  MESSAGE_REACTIONS_COLLECTION,
  MESSAGE_REACTIONS_INDEXES,
  type MessageReactionDocument
} from "../model.js";
import {
  initializeMessageReactions,
  toggleStoredMessageReaction
} from "../mongo-operations.js";

const target = (emoji: MessageReactionDocument["emoji"]): Parameters<typeof toggleStoredMessageReaction>[2] => ({
  workspaceId: "workspace-1",
  scope: "channel",
  parentId: "channel-1",
  messageId: "message-1",
  userId: "member-1",
  emoji,
  now: new Date("2026-10-27T00:00:00.000Z")
});

const isPipeline = (value: unknown): value is readonly Readonly<{
  $set: Readonly<Record<string, unknown>>;
}>[] => Array.isArray(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

void test("replaces a member's reaction on the message and toggles the selected reaction off", async () => {
  const documents = new Map<string, Record<string, unknown>>();
  const collection = {
    findOne: ({ _id }: Readonly<{ _id: string }>) =>
      Promise.resolve(documents.get(_id) ?? null),
    updateMany: (filter: Readonly<Record<string, unknown>>, update: Readonly<{
      $set: Readonly<{ active: boolean; updatedAt: Date }>;
    }>) => {
      for (const [id, document] of documents) {
        const matches = Object.entries(filter).every(([key, value]) => {
          if (key === "emoji" && typeof value === "object" && value !== null && "$ne" in value) {
            return document.emoji !== value.$ne;
          }
          return document[key] === value;
        });
        if (matches) documents.set(id, { ...document, ...update.$set });
      }
      return Promise.resolve({ modifiedCount: 0 });
    },
    updateOne: (filter: Readonly<{ _id: string }>, update: unknown) => {
      const current = documents.get(filter._id) ?? {};
      let values: Readonly<Record<string, unknown>> = {};
      if (isPipeline(update)) {
        values = update[0]?.$set ?? {};
      } else if (isRecord(update) && isRecord(update.$set)) {
        values = update.$set;
      }
      const resolvedValues = Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key,
        isRecord(value) && "$literal" in value
          ? value.$literal
          : value
      ]));
      documents.set(filter._id, { ...current, ...resolvedValues });
      return Promise.resolve({ matchedCount: 1, upsertedCount: 0 });
    }
  };
  const database = {
    collection: (name: string) => {
      assert.equal(name, MESSAGE_REACTIONS_COLLECTION);
      return collection;
    }
  } as unknown as MongoDatabase;
  const session = {} as MongoTransactionSession;

  assert.equal(await toggleStoredMessageReaction(database, session, target("👍")), true);
  assert.equal(await toggleStoredMessageReaction(database, session, target("❤️")), true);
  assert.equal(await toggleStoredMessageReaction(database, session, target("❤️")), false);

  const active = [...documents.values()].filter((document) => document.active === true);
  assert.deepEqual(active, []);
  assert.deepEqual(
    [...documents.values()].filter((document) => document.emoji === "👍").map(({ active: isActive }) => isActive),
    [false]
  );
});

void test("normalizes prior multi-emoji records before creating the active-reaction uniqueness index", async () => {
  const calls: unknown[] = [];
  const keepId = "latest";
  const database = {
    createCollection: () => Promise.resolve({}),
    collection: (name: string) => {
      assert.equal(name, MESSAGE_REACTIONS_COLLECTION);
      return {
        aggregate: () => ({
          toArray: () => Promise.resolve([{
            _id: {
              workspaceId: "workspace-1",
              scope: "channel",
              parentId: "channel-1",
              messageId: "message-1",
              userId: "member-1"
            },
            keepId
          }])
        }),
        updateMany: (filter: unknown, update: unknown) => {
          calls.push({ kind: "normalize", filter, update });
          return Promise.resolve({ modifiedCount: 1 });
        },
        createIndex: (keys: unknown, options: unknown) => {
          calls.push({ kind: "index", keys, options });
          return Promise.resolve("created");
        }
      };
    }
  } as unknown as MongoDatabase;

  await initializeMessageReactions(database);

  assert.deepEqual(calls[0], {
    kind: "normalize",
    filter: {
      workspaceId: "workspace-1",
      scope: "channel",
      parentId: "channel-1",
      messageId: "message-1",
      userId: "member-1",
      active: true,
      _id: { $ne: keepId }
    },
    update: { $set: { active: false } }
  });
  const activeUniqueIndex = calls.find((call) =>
    typeof call === "object"
      && call !== null
      && "options" in call
      && (call.options as { name?: string }).name === "message_reaction_active_user_unique"
  );
  assert.ok(activeUniqueIndex);
  assert.equal(MESSAGE_REACTIONS_INDEXES[1]?.options.unique, true);
});
