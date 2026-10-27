import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { MongoDatabase, MongoTransactionSession } from "../../integrations/mongodb/index.js";
import {
  MESSAGE_REACTION_USERS_LIMIT,
  MESSAGE_REACTIONS_COLLECTION,
  MESSAGE_REACTIONS_COLLECTION_VALIDATOR,
  MESSAGE_REACTIONS_INDEXES,
  type MessageReactionDocument,
  type MessageReactionScope,
  type StoredMessageReaction
} from "./model.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isCollectionAlreadyExists = (error: unknown): boolean => isRecord(error) && error.code === 48;

const reactionCollection = (database: MongoDatabase) =>
  database.collection<MessageReactionDocument>(MESSAGE_REACTIONS_COLLECTION);

const deactivateLegacyDuplicateReactions = async (database: MongoDatabase): Promise<void> => {
  const duplicates = await reactionCollection(database).aggregate<Readonly<{
    _id: Readonly<{
      workspaceId: string;
      scope: MessageReactionScope;
      parentId: string;
      messageId: string;
      userId: string;
    }>;
    keepId: string;
  }>>([
    { $match: { active: true } },
    { $sort: { updatedAt: -1, _id: 1 } },
    {
      $group: {
        _id: {
          workspaceId: "$workspaceId",
          scope: "$scope",
          parentId: "$parentId",
          messageId: "$messageId",
          userId: "$userId"
        },
        keepId: { $first: "$_id" },
        count: { $sum: 1 }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();
  for (const duplicate of duplicates) {
    await reactionCollection(database).updateMany({
      ...duplicate._id,
      active: true,
      _id: { $ne: duplicate.keepId }
    }, { $set: { active: false } });
  }
};

export const initializeMessageReactions = async (database: MongoDatabase): Promise<void> => {
  try {
    await database.createCollection(MESSAGE_REACTIONS_COLLECTION, {
      validator: MESSAGE_REACTIONS_COLLECTION_VALIDATOR,
      validationLevel: "strict",
      validationAction: "error"
    });
  } catch (error: unknown) {
    if (!isCollectionAlreadyExists(error)) throw error;
    await database.command({
      collMod: MESSAGE_REACTIONS_COLLECTION,
      validator: MESSAGE_REACTIONS_COLLECTION_VALIDATOR,
      validationLevel: "strict",
      validationAction: "error"
    });
  }
  const collection = reactionCollection(database);
  await deactivateLegacyDuplicateReactions(database);
  for (const index of MESSAGE_REACTIONS_INDEXES) {
    await collection.createIndex(index.keys, index.options);
  }
};

export const assertMessageReactionsInitialized = async (database: MongoDatabase): Promise<void> => {
  const metadata = await database.listCollections({ name: MESSAGE_REACTIONS_COLLECTION }).next();
  const options = isRecord(metadata) && "options" in metadata ? metadata.options : undefined;
  if (!isRecord(options) || !isDeepStrictEqual(options.validator, MESSAGE_REACTIONS_COLLECTION_VALIDATOR)) {
    throw Object.assign(new Error("Message reaction storage is unavailable."), {
      kind: "message-reaction-storage-unavailable" as const
    });
  }
  const indexes = await reactionCollection(database).indexes();
  for (const expected of MESSAGE_REACTIONS_INDEXES) {
    const actual = indexes.find(({ name }) => name === expected.options.name);
    const expectedPartialFilter = "partialFilterExpression" in expected.options
      ? expected.options.partialFilterExpression
      : undefined;
    if (!actual
      || !isDeepStrictEqual(actual.key, expected.keys)
      || Boolean(actual.unique) !== expected.options.unique
      || !isDeepStrictEqual(actual.partialFilterExpression, expectedPartialFilter)) {
      throw Object.assign(new Error("Message reaction storage is unavailable."), {
        kind: "message-reaction-storage-unavailable" as const
      });
    }
  }
};

export type MessageReactionTarget = Readonly<{
  workspaceId: string;
  scope: MessageReactionScope;
  parentId: string;
  messageId: string;
  userId: string;
  emoji: MessageReactionDocument["emoji"];
  now: Date;
}>;

const reactionId = (target: MessageReactionTarget): string => createHash("sha256")
  .update(JSON.stringify([
    target.workspaceId,
    target.scope,
    target.parentId,
    target.messageId,
    target.emoji,
    target.userId
  ]))
  .digest("hex");

export const toggleStoredMessageReaction = async (
  database: MongoDatabase,
  session: MongoTransactionSession,
  target: MessageReactionTarget
): Promise<boolean> => {
  const _id = reactionId(target);
  const collection = reactionCollection(database);
  const current = await collection.findOne({ _id }, { session });
  if (current?.active) {
    await collection.updateOne(
      { _id },
      { $set: { active: false, updatedAt: target.now } },
      { session }
    );
    return false;
  }

  await collection.updateMany({
    workspaceId: target.workspaceId,
    scope: target.scope,
    parentId: target.parentId,
    messageId: target.messageId,
    userId: target.userId,
    active: true,
    emoji: { $ne: target.emoji }
  }, { $set: { active: false, updatedAt: target.now } }, { session });
  await collection.updateOne(
    { _id },
    [{
      $set: {
        _id: { $literal: _id },
        workspaceId: { $literal: target.workspaceId },
        scope: { $literal: target.scope },
        parentId: { $literal: target.parentId },
        messageId: { $literal: target.messageId },
        emoji: { $literal: target.emoji },
        userId: { $literal: target.userId },
        active: { $literal: true },
        updatedAt: { $literal: target.now }
      }
    }],
    { upsert: true, session }
  );
  return true;
};

type ReactionAggregation = Readonly<{
  messageId: string;
  emoji: MessageReactionDocument["emoji"];
  count: number;
  userIds: readonly string[];
  usersTruncated: boolean;
  reactedByMe: boolean;
}>;

export const listStoredMessageReactions = async (
  database: MongoDatabase,
  session: MongoTransactionSession,
  input: Readonly<{
    workspaceId: string;
    scope: MessageReactionScope;
    parentId: string;
    messageIds: readonly string[];
    userId: string;
  }>
): Promise<readonly StoredMessageReaction[]> => {
  if (input.messageIds.length === 0) return Object.freeze([]);
  const groups = await reactionCollection(database).aggregate<ReactionAggregation>([
    {
      $match: {
        workspaceId: input.workspaceId,
        scope: input.scope,
        parentId: input.parentId,
        messageId: { $in: input.messageIds },
        active: true
      }
    },
    { $sort: { emoji: 1, userId: 1 } },
    {
      $group: {
        _id: { messageId: "$messageId", emoji: "$emoji" },
        count: { $sum: 1 },
        userIds: { $firstN: { input: "$userId", n: MESSAGE_REACTION_USERS_LIMIT } },
        mine: { $max: { $cond: [{ $eq: ["$userId", input.userId] }, 1, 0] } }
      }
    },
    {
      $project: {
        _id: 0,
        messageId: "$_id.messageId",
        emoji: "$_id.emoji",
        count: 1,
        userIds: 1,
        usersTruncated: { $gt: ["$count", MESSAGE_REACTION_USERS_LIMIT] },
        reactedByMe: { $gt: ["$mine", 0] }
      }
    },
    { $sort: { messageId: 1, emoji: 1 } }
  ], { session }).toArray();
  return Object.freeze(groups.map((group) => Object.freeze({
    messageId: group.messageId,
    emoji: group.emoji,
    count: group.count,
    userIds: Object.freeze([...group.userIds]),
    usersTruncated: group.usersTruncated,
    reactedByMe: group.reactedByMe
  })));
};
