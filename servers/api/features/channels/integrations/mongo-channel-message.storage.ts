import { isDeepStrictEqual } from "node:util";
import type {
  MongoDatabase,
  MongoTransaction,
  MongoTransactionOperation
} from "../../../integrations/mongodb/index.js";
import {
  CHANNEL_MESSAGES_COLLECTION,
  CHANNEL_MESSAGES_COLLECTION_VALIDATOR,
  CHANNEL_MESSAGES_INDEXES,
  CHANNEL_MEMBERSHIPS_COLLECTION,
  CHANNELS_COLLECTION,
  type ChannelMessageDocument,
  type ChannelMembershipDocument,
  type ChannelDocument
} from "../models/index.js";
import type { ChannelMessageStorage, ChannelMessageStorageResult } from "../repositories/index.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isCollectionAlreadyExists = (error: unknown): boolean =>
  isRecord(error) && error.code === 48;

const storageUnavailable = Object.assign(new Error("Channel message storage is unavailable."), {
  kind: "channel-storage-unavailable" as const
});

const ensureCollection = async (database: MongoDatabase): Promise<void> => {
  try {
    await database.createCollection(CHANNEL_MESSAGES_COLLECTION, {
      validator: CHANNEL_MESSAGES_COLLECTION_VALIDATOR,
      validationLevel: "strict",
      validationAction: "error"
    });
  } catch (error: unknown) {
    if (!isCollectionAlreadyExists(error)) throw error;
    await database.command({
      collMod: CHANNEL_MESSAGES_COLLECTION,
      validator: CHANNEL_MESSAGES_COLLECTION_VALIDATOR,
      validationLevel: "strict",
      validationAction: "error"
    });
  }
};

const assertInitialized = async (
  database: MongoDatabase,
  messages: Readonly<{
    indexes: () => Promise<readonly Readonly<{
      name?: string;
      key: unknown;
      unique?: boolean;
      weights?: unknown;
    }>[]>
  }>
): Promise<void> => {
  const metadata = await database.listCollections({ name: CHANNEL_MESSAGES_COLLECTION }).next();
  const options = isRecord(metadata) && "options" in metadata ? metadata.options : undefined;
  if (!isRecord(options) || !isDeepStrictEqual(options.validator, CHANNEL_MESSAGES_COLLECTION_VALIDATOR)) {
    throw storageUnavailable;
  }
  const indexes = await messages.indexes();
  for (const expected of CHANNEL_MESSAGES_INDEXES) {
    const actual = indexes.find(({ name }) => name === expected.options.name);
    const textFields = Object.entries(expected.keys)
      .filter(([, value]) => value === "text")
      .map(([field]) => field);
    const keyMatches = actual && textFields.length > 0
      ? isRecord(actual.key)
        && actual.key._fts === "text"
        && actual.key._ftsx === 1
        && isDeepStrictEqual(actual.weights, Object.fromEntries(textFields.map((field) => [field, 1])))
      : actual && isDeepStrictEqual(actual.key, expected.keys);
    if (!actual || !keyMatches
      || Boolean(actual.unique) !== expected.options.unique) {
      throw storageUnavailable;
    }
  }
};

export const createMongoChannelMessageStorage = (
  database: MongoDatabase,
  withTransaction: MongoTransaction
): ChannelMessageStorage => {
  const messages = database.collection<ChannelMessageDocument>(CHANNEL_MESSAGES_COLLECTION);
  const channels = database.collection<ChannelDocument>(CHANNELS_COLLECTION);
  const memberships = database.collection<ChannelMembershipDocument>(CHANNEL_MEMBERSHIPS_COLLECTION);
  let readiness: Promise<void> | null = null;
  const ensureReady = async (): Promise<void> => {
    if (!readiness) readiness = assertInitialized(database, messages);
    const currentReadiness = readiness;
    try {
      await currentReadiness;
    } catch (error: unknown) {
      if (readiness === currentReadiness) readiness = null;
      throw error;
    }
  };
  const runTransaction: MongoTransaction = async <Result>(
    operation: MongoTransactionOperation<Result>
  ): Promise<Result> => {
    try {
      return await withTransaction(operation);
    } catch (error: unknown) {
      if (isRecord(error) && (error.code === 20 || error.code === 26 || error.code === 303)) {
        throw storageUnavailable;
      }
      throw error;
    }
  };

  return Object.freeze({
    initialize: async (): Promise<void> => {
      await ensureCollection(database);
      for (const index of CHANNEL_MESSAGES_INDEXES) {
        await messages.createIndex(index.keys, index.options);
      }
    },
    findForMember: async (workspaceId, channelId, userId, query): Promise<ChannelMessageStorageResult> => {
      await ensureReady();
      return runTransaction(async (session) => {
        const channel = await channels.findOne(
          { _id: channelId, workspaceId },
          { session }
        );
        const membership = await memberships.findOne({ channelId, userId }, { session });
        if (!channel || !membership) return Object.freeze({ kind: "channel-unavailable" as const });
        const filter = query.before
          ? {
            channelId,
            $or: [
              { createdAt: { $lt: query.before.createdAt } },
              { createdAt: query.before.createdAt, _id: { $lt: query.before.id } }
            ]
          }
          : { channelId };
        const page = await messages.find(filter, { session })
          .sort({ createdAt: -1, _id: -1 })
          .limit(query.pageSize + 1)
          .toArray();
        return Object.freeze({ kind: "listed" as const, messages: Object.freeze(page) });
      });
    },
    findAttachmentForMember: async (workspaceId, channelId, userId, messageId, attachmentId) => {
      await ensureReady();
      return runTransaction(async (session) => {
        const channel = await channels.findOne({ _id: channelId, workspaceId }, { session });
        const membership = await memberships.findOne({ channelId, userId }, { session });
        if (!channel || !membership) return null;
        const message = await messages.findOne({ _id: messageId, channelId }, { session });
        return message?.attachments?.find(({ id }) => id === attachmentId) ?? null;
      });
    },
    createForMember: async (workspaceId, channelId, userId, message): Promise<"created" | "channel-unavailable"> => {
      await ensureReady();
      return runTransaction(async (session) => {
        const membership = await memberships.findOne({ channelId, userId }, { session });
        if (!membership) return "channel-unavailable";
        const locked = await channels.updateOne(
          { _id: channelId, workspaceId, lifecycleState: "active" },
          { $inc: { membershipRevision: 1 } },
          { session }
        );
        if (locked.matchedCount === 0) return "channel-unavailable";
        await messages.insertOne(message, { session });
        return "created";
      });
    }
  });
};
