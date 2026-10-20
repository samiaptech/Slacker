import { isDeepStrictEqual } from "node:util";
import type { MongoDatabase } from "../../../integrations/mongodb/index.js";
import type { MongoTransaction } from "../../../integrations/mongodb/index.js";
import type { ChannelStorage, ChannelStorageUnavailableError, ChannelWriteTransaction } from "../repositories/index.js";
import {
  CHANNELS_COLLECTION,
  CHANNELS_COLLECTION_VALIDATOR,
  CHANNELS_INDEXES,
  CHANNEL_CREATION_REQUESTS_COLLECTION,
  CHANNEL_CREATION_REQUESTS_COLLECTION_VALIDATOR,
  CHANNEL_CREATION_REQUESTS_INDEXES,
  CHANNEL_MEMBERSHIPS_COLLECTION,
  CHANNEL_MEMBERSHIPS_COLLECTION_VALIDATOR,
  CHANNEL_MEMBERSHIPS_INDEXES,
  type ChannelCreationRequestDocument,
  type ChannelDocument,
  type ChannelMembershipDocument
} from "../models/index.js";

type MongoFailure = Readonly<{ code?: unknown }>;
type ChannelIndexDefinition = Readonly<{
  keys: unknown;
  options: unknown;
}>;
type ChannelCollectionEntry = Readonly<{
  name: string;
  validator: unknown;
  createIndex: (keys: unknown, options: unknown) => Promise<string>;
  readIndexes: () => Promise<readonly Readonly<{
      name?: string;
      key: unknown;
      unique?: boolean;
      partialFilterExpression?: unknown;
    }>[]>
  expectedIndexes: readonly ChannelIndexDefinition[];
}>;

const isCollectionAlreadyExists = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as MongoFailure).code === 48;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const storageUnavailable: ChannelStorageUnavailableError = Object.assign(new Error("Channel storage is unavailable."), {
  kind: "channel-storage-unavailable" as const
});

const toPersistenceError = (error: unknown): unknown => {
  if (!isRecord(error)) return error;
  if (error.code === 20 || error.code === 303) return storageUnavailable;
  if (error.code !== 11000) return error;
  const keyPattern = isRecord(error.keyPattern) ? error.keyPattern : {};
  const constraint = "actorId" in keyPattern && "key" in keyPattern
    ? "idempotency-key"
    : "name" in keyPattern && "workspaceId" in keyPattern
      ? "active-name"
      : "other";
  return Object.freeze({ kind: "channel-duplicate-key", constraint });
};

const ensureCollection = async (
  database: MongoDatabase,
  collectionName: string,
  validator: unknown
): Promise<void> => {
  try {
    await database.createCollection(collectionName, {
      validator: validator as never,
      validationLevel: "strict",
      validationAction: "error"
    });
  } catch (error: unknown) {
    if (!isCollectionAlreadyExists(error)) throw error;
    await database.command({
      collMod: collectionName,
      validator: validator as never,
      validationLevel: "strict",
      validationAction: "error"
    });
  }
};

const assertInitialized = async (
  database: MongoDatabase,
  collections: readonly ChannelCollectionEntry[]
): Promise<void> => {
  for (const entry of collections) {
    const metadata = await database.listCollections({ name: entry.name }).next();
    const options = isRecord(metadata) && "options" in metadata ? metadata.options : undefined;
    if (!isRecord(options) || !isDeepStrictEqual(options.validator, entry.validator)) {
      throw storageUnavailable;
    }
    const indexes = await entry.readIndexes();
      for (const expected of entry.expectedIndexes) {
      const expectedOptions = expected.options as Readonly<{ name: string; unique: boolean; partialFilterExpression?: unknown }>;
      const actual = indexes.find((index) => index.name === expectedOptions.name);
      if (!actual || !isDeepStrictEqual(actual.key, expected.keys)
        || Boolean(actual.unique) !== expectedOptions.unique
        || !isDeepStrictEqual(actual.partialFilterExpression, expectedOptions.partialFilterExpression)) {
        throw storageUnavailable;
      }
    }
  }
};

export const createMongoChannelStorage = (
  database: MongoDatabase,
  withTransaction: MongoTransaction
): ChannelStorage => {
  const channels = database.collection<ChannelDocument>(CHANNELS_COLLECTION);
  const memberships = database.collection<ChannelMembershipDocument>(CHANNEL_MEMBERSHIPS_COLLECTION);
  const creationRequests = database.collection<ChannelCreationRequestDocument>(CHANNEL_CREATION_REQUESTS_COLLECTION);
  const collections: readonly ChannelCollectionEntry[] = [
    { name: CHANNELS_COLLECTION, validator: CHANNELS_COLLECTION_VALIDATOR, createIndex: (keys, options) => channels.createIndex(keys as never, options as never), readIndexes: async () => channels.indexes(), expectedIndexes: CHANNELS_INDEXES },
    { name: CHANNEL_MEMBERSHIPS_COLLECTION, validator: CHANNEL_MEMBERSHIPS_COLLECTION_VALIDATOR, createIndex: (keys, options) => memberships.createIndex(keys as never, options as never), readIndexes: async () => memberships.indexes(), expectedIndexes: CHANNEL_MEMBERSHIPS_INDEXES },
    { name: CHANNEL_CREATION_REQUESTS_COLLECTION, validator: CHANNEL_CREATION_REQUESTS_COLLECTION_VALIDATOR, createIndex: (keys, options) => creationRequests.createIndex(keys as never, options as never), readIndexes: async () => creationRequests.indexes(), expectedIndexes: CHANNEL_CREATION_REQUESTS_INDEXES }
  ];

  return Object.freeze({
    initialize: async (): Promise<void> => {
      for (const entry of collections) {
        await ensureCollection(database, entry.name, entry.validator);
        for (const index of entry.expectedIndexes) await entry.createIndex(index.keys, index.options);
      }
    },
    withTransaction: async <Result>(operation: (transaction: ChannelWriteTransaction) => Promise<Result>): Promise<Result> => {
      try {
        await assertInitialized(database, collections);
        return await withTransaction((session) => operation(Object.freeze({
          insertChannel: async (document): Promise<void> => { await channels.insertOne(document, { session }); },
          insertMembership: async (document): Promise<void> => { await memberships.insertOne(document, { session }); },
          insertCreationRequest: async (document): Promise<void> => { await creationRequests.insertOne(document, { session }); },
          lockChannelForMembershipChange: async (workspaceId, channelId): Promise<ChannelDocument | null> => {
            const update = await channels.updateOne(
              { _id: channelId, workspaceId, lifecycleState: "active" },
              { $inc: { membershipRevision: 1 } },
              { session }
            );
            if (update.matchedCount === 0) return null;
            return channels.findOne({ _id: channelId, workspaceId, lifecycleState: "active" }, { session });
          },
          findMembership: (channelId, userId): Promise<ChannelMembershipDocument | null> =>
            memberships.findOne({ channelId, userId }, { session }),
          deleteMembership: async (channelId, userId): Promise<void> => {
            await memberships.deleteOne({ channelId, userId }, { session });
          }
        })));
      } catch (error: unknown) {
        throw toPersistenceError(error);
      }
    },
    findByWorkspaceAndName: (workspaceId, name): Promise<ChannelDocument | null> =>
      channels.findOne({ workspaceId, name, lifecycleState: "active" }),
    findById: (workspaceId, channelId): Promise<ChannelDocument | null> =>
      channels.findOne({ _id: channelId, workspaceId }),
    findForMember: async (workspaceId, userId): Promise<readonly ChannelDocument[]> => {
      const userMemberships = await memberships.find({ userId }).toArray();
      if (userMemberships.length === 0) return [];
      const channelIds = userMemberships.map((membership) => membership.channelId);
      return channels.find({
        _id: { $in: channelIds },
        workspaceId,
        lifecycleState: "active"
      }).sort({ name: 1, _id: 1 }).toArray();
    },
    findChannels: async (workspaceId, userId, query): Promise<readonly ChannelDocument[]> => {
      const userMemberships = await memberships.find({ userId }).toArray();
      const memberChannelIds = userMemberships.map((membership) => membership.channelId);
      if (query.scope === "joined" && memberChannelIds.length === 0) return [];

      const findPage = (filter: Parameters<typeof channels.find>[0]) =>
        channels.find(filter).sort({ name: 1 }).limit(query.pageSize + 1).toArray();
      if (query.scope === "joined") {
        const filter = query.cursor
          ? {
            _id: { $in: memberChannelIds },
            workspaceId,
            lifecycleState: "active" as const,
            name: { $gt: query.cursor.name }
          }
          : { _id: { $in: memberChannelIds }, workspaceId, lifecycleState: "active" as const };
        return findPage(filter);
      }
      const membershipFilter = memberChannelIds.length === 0 ? {} : { _id: { $nin: memberChannelIds } };
      const filter = query.cursor
        ? {
          ...membershipFilter,
          workspaceId,
          lifecycleState: "active" as const,
          visibility: "public" as const,
          name: { $gt: query.cursor.name }
        }
        : {
          ...membershipFilter,
          workspaceId,
          lifecycleState: "active" as const,
          visibility: "public" as const
        };
      return findPage(filter);
    },
    findMembership: (channelId, userId): Promise<ChannelMembershipDocument | null> =>
      memberships.findOne({ channelId, userId }),
    findMemberships: (channelId): Promise<readonly ChannelMembershipDocument[]> =>
      memberships.find({ channelId }).sort({ joinedAt: 1, _id: 1 }).toArray(),
    findCreationRequest: (workspaceId, actorId, key): Promise<ChannelCreationRequestDocument | null> =>
      creationRequests.findOne({ workspaceId, actorId, key })
  });
};
