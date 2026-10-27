import { isDeepStrictEqual } from "node:util";
import type { MongoDatabase, MongoTransaction } from "../../../integrations/mongodb/index.js";
import {
  DIRECT_CONVERSATIONS_COLLECTION,
  DIRECT_CONVERSATIONS_COLLECTION_VALIDATOR,
  DIRECT_CONVERSATIONS_INDEXES,
  DIRECT_MESSAGES_COLLECTION,
  DIRECT_MESSAGES_COLLECTION_VALIDATOR,
  DIRECT_MESSAGES_INDEXES,
  type DirectConversationDocument,
  type DirectMessageDocument
} from "../models/index.js";
import type { DirectMessageStorage } from "../repositories/index.js";
import {
  assertMessageReactionsInitialized,
  initializeMessageReactions,
  listStoredMessageReactions,
  MESSAGE_REACTIONS_COLLECTION,
  type MessageReactionDocument,
  type StoredMessageReaction,
  toggleStoredMessageReaction
} from "../../message-reactions/public/index.js";

const storageUnavailable = Object.assign(new Error("Direct message storage is unavailable."), {
  kind: "direct-message-storage-unavailable" as const
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isCollectionAlreadyExists = (error: unknown): boolean => isRecord(error) && error.code === 48;
const isDuplicateKey = (error: unknown): boolean => isRecord(error) && error.code === 11000;
const isUnsupportedTransaction = (error: unknown): boolean =>
  isRecord(error) && (error.code === 20 || error.code === 26 || error.code === 303);

const ensureCollection = async (
  database: MongoDatabase,
  name: string,
  validator: unknown
): Promise<void> => {
  try {
    await database.createCollection(name, {
      validator: validator as never,
      validationLevel: "strict",
      validationAction: "error"
    });
  } catch (error: unknown) {
    if (!isCollectionAlreadyExists(error)) throw error;
    await database.command({
      collMod: name,
      validator: validator as never,
      validationLevel: "strict",
      validationAction: "error"
    });
  }
};

const assertCollection = async (
  database: MongoDatabase,
  collection: Readonly<{
    name: string;
    validator: unknown;
    indexes: readonly Readonly<{ keys: unknown; options: Readonly<{ name: string; unique: boolean }> }>[];
    readIndexes: () => Promise<readonly Readonly<{
      name?: string;
      key: unknown;
      unique?: boolean;
      partialFilterExpression?: unknown;
      weights?: unknown;
    }>[]>;
  }>
): Promise<void> => {
  const metadata = await database.listCollections({ name: collection.name }).next();
  const options = isRecord(metadata) && "options" in metadata ? metadata.options : undefined;
  if (!isRecord(options) || !isDeepStrictEqual(options.validator, collection.validator)) {
    throw storageUnavailable;
  }
  const actualIndexes = await collection.readIndexes();
  for (const expected of collection.indexes) {
    const actual = actualIndexes.find(({ name }) => name === expected.options.name);
    const expectedKeys = isRecord(expected.keys) ? expected.keys : {};
    const textFields = Object.entries(expectedKeys)
      .filter(([, value]) => value === "text")
      .map(([field]) => field);
    const keyMatches = actual && textFields.length > 0
      ? isRecord(actual.key)
        && actual.key._fts === "text"
        && actual.key._ftsx === 1
        && isDeepStrictEqual(actual.weights, Object.fromEntries(textFields.map((field) => [field, 1])))
      : actual && isDeepStrictEqual(actual.key, expectedKeys);
    if (!actual || !keyMatches
      || Boolean(actual.unique) !== expected.options.unique) {
      throw storageUnavailable;
    }
  }
};

export const createMongoDirectMessageStorage = (
  database: MongoDatabase,
  withTransaction: MongoTransaction
): DirectMessageStorage => {
  const conversations = database.collection<DirectConversationDocument>(DIRECT_CONVERSATIONS_COLLECTION);
  const messages = database.collection<DirectMessageDocument>(DIRECT_MESSAGES_COLLECTION);
  const reactions = database.collection<MessageReactionDocument>(MESSAGE_REACTIONS_COLLECTION);
  let readiness: Promise<void> | null = null;
  const ensureReady = async (): Promise<void> => {
    if (!readiness) {
      readiness = Promise.all([
        assertCollection(database, {
          name: DIRECT_CONVERSATIONS_COLLECTION,
          validator: DIRECT_CONVERSATIONS_COLLECTION_VALIDATOR,
          indexes: DIRECT_CONVERSATIONS_INDEXES,
          readIndexes: () => conversations.indexes()
        }),
        assertCollection(database, {
          name: DIRECT_MESSAGES_COLLECTION,
          validator: DIRECT_MESSAGES_COLLECTION_VALIDATOR,
          indexes: DIRECT_MESSAGES_INDEXES,
          readIndexes: () => messages.indexes()
        })
      ]).then(() => assertMessageReactionsInitialized(database)).then(() => undefined).catch((error: unknown) => {
        if (isUnsupportedTransaction(error)
          || (isRecord(error) && error.kind === "message-reaction-storage-unavailable")) {
          throw storageUnavailable;
        }
        throw error;
      });
    }
    const currentReadiness = readiness;
    try {
      await currentReadiness;
    } catch (error: unknown) {
      if (readiness === currentReadiness) readiness = null;
      throw error;
    }
  };
  return Object.freeze({
    initialize: async (): Promise<void> => {
      await ensureCollection(database, DIRECT_CONVERSATIONS_COLLECTION, DIRECT_CONVERSATIONS_COLLECTION_VALIDATOR);
      await ensureCollection(database, DIRECT_MESSAGES_COLLECTION, DIRECT_MESSAGES_COLLECTION_VALIDATOR);
      for (const index of DIRECT_CONVERSATIONS_INDEXES) {
        await conversations.createIndex(index.keys, index.options);
      }
      for (const index of DIRECT_MESSAGES_INDEXES) {
        await messages.createIndex(index.keys, index.options);
      }
      await initializeMessageReactions(database);
    },
    openForMember: async (workspaceId, draft) => {
      await ensureReady();
      try {
        return await withTransaction(async (session) => {
          const existing = await conversations.findOne(
            { workspaceId, pairKey: draft.pairKey },
            { session }
          );
          if (existing) return Object.freeze({ kind: "opened" as const, conversation: existing, created: false });
          await conversations.insertOne(draft, { session });
          return Object.freeze({ kind: "opened" as const, conversation: draft, created: true });
        });
      } catch (error: unknown) {
        if (isUnsupportedTransaction(error)) throw storageUnavailable;
        if (!isDuplicateKey(error)) throw error;
        const existing = await conversations.findOne({ workspaceId, pairKey: draft.pairKey });
        if (!existing) throw error;
        return Object.freeze({ kind: "opened" as const, conversation: existing, created: false });
      }
    },
    listForMember: async (workspaceId, userId) => {
      await ensureReady();
      return conversations.find({ workspaceId, participantIds: userId })
        .sort({ lastActivityAt: -1, _id: -1 })
        .limit(50)
        .toArray();
    },
    findForMember: async (workspaceId, conversationId, userId) => {
      await ensureReady();
      return conversations.findOne({
        _id: conversationId,
        workspaceId,
        participantIds: userId
      });
    },
    listMessagesForMember: async (workspaceId, conversationId, userId, query) => {
      await ensureReady();
      return withTransaction(async (session) => {
        const conversation = await conversations.findOne({
          _id: conversationId,
          workspaceId,
          participantIds: userId
        }, { session });
        if (!conversation) return null;
        const filter = query.before
          ? {
            workspaceId,
            conversationId,
            hiddenForUserIds: { $nin: [userId] },
            $or: [
              { createdAt: { $lt: query.before.createdAt } },
              { createdAt: query.before.createdAt, _id: { $lt: query.before.id } }
            ]
          }
          : { workspaceId, conversationId, hiddenForUserIds: { $nin: [userId] } };
        const page = await messages.find(filter, { session })
          .sort({ createdAt: -1, _id: -1 })
          .limit(query.pageSize + 1)
          .toArray();
        return Object.freeze(page);
      }).catch((error: unknown) => {
        if (isUnsupportedTransaction(error)) throw storageUnavailable;
        throw error;
      });
    },
    createMessageForMember: async (workspaceId, conversationId, userId, message) => {
      await ensureReady();
      try {
        return await withTransaction(async (session) => {
          const conversation = await conversations.updateOne(
            { _id: conversationId, workspaceId, participantIds: userId },
            { $max: { lastActivityAt: message.createdAt } },
            { session }
          );
          if (conversation.matchedCount === 0) return false;
          await messages.insertOne(message, { session });
          return true;
        });
      } catch (error: unknown) {
        if (isUnsupportedTransaction(error)) throw storageUnavailable;
        throw error;
      }
    },
    findAttachmentForMember: async (workspaceId, conversationId, userId, messageId, attachmentId) => {
      await ensureReady();
      return withTransaction(async (session) => {
        const conversation = await conversations.findOne({
          _id: conversationId,
          workspaceId,
          participantIds: userId
        }, { session });
        if (!conversation) return null;
        const message = await messages.findOne({
          _id: messageId,
          workspaceId,
          conversationId,
          hiddenForUserIds: { $nin: [userId] }
        }, { session });
        return message?.attachments?.find(({ id }) => id === attachmentId) ?? null;
      }).catch((error: unknown) => {
        if (isUnsupportedTransaction(error)) throw storageUnavailable;
        throw error;
      });
    },
    deleteMessageForMember: async (workspaceId, conversationId, userId, messageId, scope, isWorkspaceAdmin) => {
      await ensureReady();
      try {
        return await withTransaction(async (session) => {
          const conversation = await conversations.findOne({
            _id: conversationId,
            workspaceId,
            participantIds: userId
          }, { session });
          if (!conversation) return Object.freeze({ kind: "not-found" as const });
          const message = await messages.findOne({
            _id: messageId,
            workspaceId,
            conversationId
          }, { session });
          if (!message) return Object.freeze({ kind: "not-found" as const });
          if (scope === "me") {
            const hidden = await messages.updateOne(
              { _id: messageId, workspaceId, conversationId },
              { $addToSet: { hiddenForUserIds: userId } },
              { session }
            );
            if (hidden.matchedCount === 0) return Object.freeze({ kind: "not-found" as const });
            return Object.freeze({ kind: "deleted" as const, attachments: Object.freeze([]) });
          }
          if (message.senderId !== userId && !isWorkspaceAdmin) {
            return Object.freeze({ kind: "forbidden" as const });
          }
          const deleted = await messages.deleteOne({ _id: messageId, workspaceId, conversationId }, { session });
          if (deleted.deletedCount === 0) return Object.freeze({ kind: "not-found" as const });
          await reactions.deleteMany({
            workspaceId,
            scope: "direct-message",
            parentId: conversationId,
            messageId
          }, { session });
          return Object.freeze({
            kind: "deleted" as const,
            attachments: Object.freeze([...(message.attachments ?? [])])
          });
        });
      } catch (error: unknown) {
        if (isUnsupportedTransaction(error)) throw storageUnavailable;
        throw error;
      }
    },
    listReactionsForMember: async (workspaceId, conversationId, userId, messageIds) => {
      if (messageIds.length === 0) return Object.freeze([]);
      await ensureReady();
      return withTransaction(async (session) => {
        const conversation = await conversations.findOne({
          _id: conversationId,
          workspaceId,
          participantIds: userId
        }, { session });
        if (!conversation) return Object.freeze([]);
        return listStoredMessageReactions(database, session, {
          workspaceId,
          scope: "direct-message",
          parentId: conversationId,
          messageIds,
          userId
        });
      }).catch((error: unknown) => {
        if (isUnsupportedTransaction(error)) throw storageUnavailable;
        throw error;
      });
    },
    toggleReactionForMember: async (workspaceId, conversationId, userId, messageId, emoji, now) => {
      await ensureReady();
      const toggle = async (retryDuplicate: boolean): Promise<Readonly<{
        kind: "updated";
        reactions: readonly StoredMessageReaction[];
      }> | Readonly<{ kind: "not-found" }>> => withTransaction(async (session) => {
        const conversation = await conversations.findOne({
          _id: conversationId,
          workspaceId,
          participantIds: userId
        }, { session });
        const message = await messages.findOne({
          _id: messageId,
          workspaceId,
          conversationId,
          hiddenForUserIds: { $nin: [userId] }
        }, { session });
        if (!conversation || !message) return Object.freeze({ kind: "not-found" as const });
        try {
          await toggleStoredMessageReaction(database, session, {
            workspaceId,
            scope: "direct-message",
            parentId: conversationId,
            messageId,
            userId,
            emoji,
            now
          });
        } catch (error: unknown) {
          if (!retryDuplicate || !isDuplicateKey(error)) throw error;
          throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
            kind: "message-reaction-duplicate-retry" as const
          });
        }
        const groups = await listStoredMessageReactions(database, session, {
          workspaceId,
          scope: "direct-message",
          parentId: conversationId,
          messageIds: [messageId],
          userId
        });
        return Object.freeze({ kind: "updated" as const, reactions: groups });
      }).catch((error: unknown) => {
        if (isUnsupportedTransaction(error)) throw storageUnavailable;
        throw error;
      });
      try {
        return await toggle(true);
      } catch (error: unknown) {
        if (!isRecord(error) || error.kind !== "message-reaction-duplicate-retry") throw error;
        return toggle(false);
      }
    }
  });
};
