import test from "node:test";
import assert from "node:assert/strict";
import type { MongoDatabase, MongoTransaction } from "../../../integrations/mongodb/index.js";
import {
  CHANNELS_COLLECTION,
  CHANNELS_COLLECTION_VALIDATOR,
  CHANNELS_INDEXES,
  CHANNEL_CREATION_REQUESTS_COLLECTION,
  CHANNEL_CREATION_REQUESTS_COLLECTION_VALIDATOR,
  CHANNEL_CREATION_REQUESTS_INDEXES,
  CHANNEL_MEMBERSHIPS_COLLECTION,
  CHANNEL_MEMBERSHIPS_COLLECTION_VALIDATOR,
  CHANNEL_MEMBERSHIPS_INDEXES
} from "../models/index.js";
import type { ChannelListQuery } from "../domain/index.js";
import {
  createMongoChannelMembershipCleanup,
  createMongoChannelStorage
} from "../integrations/index.js";

type IndexDefinition = Readonly<{ keys: unknown; options: Readonly<{ name: string; unique: boolean; partialFilterExpression?: unknown }> }>;
type CollectionDefinition = Readonly<{ validator: unknown; indexes: readonly IndexDefinition[] }>;
const definitions = new Map<string, CollectionDefinition>([
  [CHANNELS_COLLECTION, { validator: CHANNELS_COLLECTION_VALIDATOR, indexes: CHANNELS_INDEXES }],
  [CHANNEL_MEMBERSHIPS_COLLECTION, { validator: CHANNEL_MEMBERSHIPS_COLLECTION_VALIDATOR, indexes: CHANNEL_MEMBERSHIPS_INDEXES }],
  [CHANNEL_CREATION_REQUESTS_COLLECTION, { validator: CHANNEL_CREATION_REQUESTS_COLLECTION_VALIDATOR, indexes: CHANNEL_CREATION_REQUESTS_INDEXES }]
]);

const makeDatabase = () => {
  const calls: unknown[] = [];
  const database = {
    createCollection: (name: string, options: unknown) => { calls.push({ operation: "createCollection", name, options }); return Promise.resolve({}); },
    command: (command: unknown) => { calls.push({ operation: "command", command }); return Promise.resolve({}); },
    listCollections: ({ name }: Readonly<{ name: string }>) => ({ next: () => Promise.resolve((() => {
      const definition = definitions.get(name);
      return definition ? { name, options: { validator: definition.validator } } : null;
    })()) }),
    collection: (name: string) => ({
      createIndex: (keys: unknown, options: unknown) => { calls.push({ operation: "createIndex", name, keys, options }); return Promise.resolve("created"); },
      indexes: () => Promise.resolve((definitions.get(name)?.indexes ?? []).map((index) => ({
        key: index.keys,
        name: index.options.name,
        ...(index.options.unique ? { unique: true } : {}),
        ...(index.options.partialFilterExpression === undefined
          ? {}
          : { partialFilterExpression: index.options.partialFilterExpression })
      }))),
      insertOne: (document: unknown) => { calls.push({ operation: "insertOne", name, document }); return Promise.resolve({}); },
      find: (filter: unknown) => {
        calls.push({ operation: "find", name, filter });
        const rows = name === CHANNEL_MEMBERSHIPS_COLLECTION
          ? [{ channelId: "channel-1", userId: "user-1" }]
          : [{ _id: "channel-1" }];
        return {
          toArray: () => Promise.resolve(rows),
          limit: (limit: number) => {
            calls.push({ operation: "limit", name, limit });
            return { toArray: () => Promise.resolve(rows) };
          },
          sort: (order: unknown) => {
            calls.push({ operation: "sort", name, order });
            return {
              toArray: () => Promise.resolve(rows),
              limit: (limit: number) => {
                calls.push({ operation: "limit", name, limit });
                return { toArray: () => Promise.resolve(rows) };
              }
            };
          }
        };
      },
      findOne: (filter: unknown) => { calls.push({ operation: "findOne", name, filter }); return Promise.resolve(null); }
    })
  };
  const withTransaction: MongoTransaction = (operation) => operation({} as never);
  return { database: database as unknown as MongoDatabase, calls, withTransaction };
};

void test("cleans workspace channel memberships and revises only affected public and private channels", async () => {
  const calls: unknown[] = [];
  const channels = [
    { _id: "public-channel", workspaceId: "workspace-1", membershipRevision: 2 },
    { _id: "private-channel", workspaceId: "workspace-1", membershipRevision: 4 },
    { _id: "foreign-channel", workspaceId: "workspace-2", membershipRevision: 7 }
  ];
  const memberships = [
    { channelId: "public-channel", userId: "member-1" },
    { channelId: "private-channel", userId: "member-1" },
    { channelId: "foreign-channel", userId: "member-1" }
  ];
  const readRecord = (value: unknown): Readonly<Record<string, unknown>> =>
    typeof value === "object" && value !== null ? value as Readonly<Record<string, unknown>> : {};
  const matchesIds = (filter: Readonly<Record<string, unknown>>, id: string): boolean => {
    const idFilter = readRecord(filter._id);
    return Array.isArray(idFilter.$in) && idFilter.$in.includes(id);
  };
  const database = {
    collection: (name: string) => ({
      find: (filter: unknown, options?: unknown) => {
        calls.push({ operation: "find", name, filter, options });
        const criteria = readRecord(filter);
        const rows = name === CHANNEL_MEMBERSHIPS_COLLECTION
          ? memberships.filter(({ userId }) => userId === criteria.userId)
          : channels.filter(({ _id, workspaceId }) =>
            workspaceId === criteria.workspaceId && matchesIds(criteria, _id));
        return { toArray: () => Promise.resolve(rows) };
      },
      updateMany: (filter: unknown, update: unknown, options?: unknown) => {
        calls.push({ operation: "updateMany", name, filter, update, options });
        const criteria = readRecord(filter);
        const increment = readRecord(readRecord(update).$inc).membershipRevision;
        const affected = channels.filter(({ _id, workspaceId }) =>
          workspaceId === criteria.workspaceId && matchesIds(criteria, _id));
        if (typeof increment === "number") {
          for (const channel of affected) channel.membershipRevision += increment;
        }
        return Promise.resolve({ matchedCount: affected.length });
      },
      deleteMany: (filter: unknown, options?: unknown) => {
        calls.push({ operation: "deleteMany", name, filter, options });
        const criteria = readRecord(filter);
        const ids = readRecord(criteria.channelId).$in;
        const removed = memberships.filter(({ channelId, userId }) =>
          userId === criteria.userId && Array.isArray(ids) && ids.includes(channelId));
        for (const membership of removed) memberships.splice(memberships.indexOf(membership), 1);
        return Promise.resolve({ deletedCount: removed.length });
      }
    })
  };
  const cleanup = createMongoChannelMembershipCleanup(database as unknown as MongoDatabase);
  const session = {} as never;

  await cleanup(session, "workspace-1", "member-1");

  assert.deepEqual(memberships, [{ channelId: "foreign-channel", userId: "member-1" }]);
  assert.deepEqual(channels.map(({ _id, membershipRevision }) => [_id, membershipRevision]), [
    ["public-channel", 3],
    ["private-channel", 5],
    ["foreign-channel", 7]
  ]);
  assert.equal(calls.some((call) =>
    typeof call === "object" && call !== null && "operation" in call && call.operation === "deleteMany"
      && "filter" in call && JSON.stringify(call.filter) === JSON.stringify({
        userId: "member-1",
        channelId: { $in: ["public-channel", "private-channel"] }
      })
  ), true);
});

void test("initializes validators and indexes for channels, memberships, and idempotency records", async () => {
  const { database, calls, withTransaction } = makeDatabase();
  await createMongoChannelStorage(database, withTransaction).initialize();

  assert.equal(calls.filter((call) => typeof call === "object" && call !== null && "operation" in call && call.operation === "createCollection").length, 3);
  assert.equal(calls.filter((call) => typeof call === "object" && call !== null && "operation" in call && call.operation === "createIndex").length, 5);
});

void test("checks the migration and scopes active-channel lookups to a workspace", async () => {
  const { database, calls, withTransaction } = makeDatabase();
  await createMongoChannelStorage(database, withTransaction).findByWorkspaceAndName("workspace-1", "general");
  assert.deepEqual(calls[0], {
    operation: "findOne",
    name: CHANNELS_COLLECTION,
    filter: { workspaceId: "workspace-1", name: "general", lifecycleState: "active" }
  });

  const storage = createMongoChannelStorage(database, withTransaction);
  const listed = await storage.findForMember("workspace-1", "user-1");
  assert.deepEqual(listed, [{ _id: "channel-1" }]);
  assert.deepEqual(calls.slice(1, 4), [
    { operation: "find", name: CHANNEL_MEMBERSHIPS_COLLECTION, filter: { userId: "user-1" } },
    { operation: "find", name: CHANNELS_COLLECTION, filter: {
      _id: { $in: ["channel-1"] }, workspaceId: "workspace-1", lifecycleState: "active"
    } },
    { operation: "sort", name: CHANNELS_COLLECTION, order: { name: 1, _id: 1 } }
  ]);

  calls.length = 0;
  const query: ChannelListQuery = {
    scope: "discoverable",
    pageSize: 10,
    cursor: { scope: "discoverable", name: "general" }
  };
  await storage.findChannels("workspace-1", "user-1", query);
  assert.deepEqual(calls, [
    { operation: "find", name: CHANNEL_MEMBERSHIPS_COLLECTION, filter: { userId: "user-1" } },
    {
      operation: "find",
      name: CHANNELS_COLLECTION,
      filter: {
        visibility: "public",
        _id: { $nin: ["channel-1"] },
        workspaceId: "workspace-1",
        lifecycleState: "active",
        name: { $gt: "general" }
      }
    },
    { operation: "sort", name: CHANNELS_COLLECTION, order: { name: 1 } },
    { operation: "limit", name: CHANNELS_COLLECTION, limit: 11 }
  ]);

  calls.length = 0;
  await storage.findMemberships("channel-1");
  assert.deepEqual(calls, [
    { operation: "find", name: CHANNEL_MEMBERSHIPS_COLLECTION, filter: { channelId: "channel-1" } },
    { operation: "sort", name: CHANNEL_MEMBERSHIPS_COLLECTION, order: { joinedAt: 1, _id: 1 } }
  ]);

  calls.length = 0;
  await createMongoChannelStorage(database, withTransaction).withTransaction(async (transaction) => {
    await transaction.insertChannel({} as never);
  });
  assert.deepEqual(calls.at(-1), { operation: "insertOne", name: CHANNELS_COLLECTION, document: {} });
});
