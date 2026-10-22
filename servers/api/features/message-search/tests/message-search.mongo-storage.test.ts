import test from "node:test";
import assert from "node:assert/strict";
import type { MongoDatabase } from "../../../integrations/mongodb/index.js";
import {
  CHANNEL_MESSAGES_COLLECTION,
  CHANNEL_MEMBERSHIPS_COLLECTION,
  CHANNELS_COLLECTION
} from "../../channels/public/index.js";
import {
  DIRECT_CONVERSATIONS_COLLECTION,
  DIRECT_MESSAGES_COLLECTION
} from "../../direct-messages/public/index.js";
import { WORKSPACE_MEMBERSHIPS_COLLECTION } from "../../workspaces/public/index.js";
import { createMongoMessageSearchStorage } from "../integrations/index.js";

const textIndexRows = (name: string): readonly Readonly<{ name: string }>[] =>
  name === CHANNEL_MESSAGES_COLLECTION
    ? [{ name: "channel_messages_text" }]
    : name === DIRECT_MESSAGES_COLLECTION
      ? [{ name: "direct_messages_text" }]
      : [];

const createDatabase = (isWorkspaceMember = true) => {
  const calls: Readonly<{ name: string; filter?: unknown; options?: unknown }>[] = [];
  const rowsByCollection: Readonly<Record<string, readonly unknown[]>> = {
    [CHANNEL_MEMBERSHIPS_COLLECTION]: [{ channelId: "joined-channel" }, { channelId: "private-outsider-channel" }],
    [CHANNELS_COLLECTION]: [{ _id: "joined-channel", name: "general" }],
    [DIRECT_CONVERSATIONS_COLLECTION]: [{
      _id: "member-dm",
      participantIds: ["member-1", "peer-1"]
    }],
    [WORKSPACE_MEMBERSHIPS_COLLECTION]: isWorkspaceMember ? [{
      workspaceId: "workspace-1",
      userId: "member-1"
    }] : [],
    [CHANNEL_MESSAGES_COLLECTION]: [{
      _id: "channel-hit",
      channelId: "joined-channel",
      senderId: "author-1",
      text: "A roadmap decision.",
      createdAt: new Date("2026-10-20T12:00:00.000Z"),
      score: 1
    }],
    [DIRECT_MESSAGES_COLLECTION]: [{
      _id: "dm-hit",
      conversationId: "member-dm",
      senderId: "peer-1",
      text: "The roadmap is ready.",
      createdAt: new Date("2026-10-20T12:00:00.000Z"),
      score: 1.5
    }]
  };
  const database = {
    collection: (name: string) => ({
      indexes: () => Promise.resolve(textIndexRows(name)),
      findOne: (filter: unknown) => {
        calls.push({ name, filter });
        return Promise.resolve((rowsByCollection[name] ?? []).find((row) =>
          typeof row === "object" && row !== null
          && "workspaceId" in row && "userId" in row
          && row.workspaceId === "workspace-1" && row.userId === "member-1") ?? null);
      },
      find: (filter: unknown, options?: unknown) => {
        calls.push({ name, filter, options });
        let limit = Number.POSITIVE_INFINITY;
        const cursor = {
          sort: () => cursor,
          limit: (size: number) => {
            limit = size;
            return cursor;
          },
          toArray: () => Promise.resolve((rowsByCollection[name] ?? []).slice(0, limit))
        };
        return cursor;
      }
    })
  };
  return { database: database as unknown as MongoDatabase, calls };
};

void test("queries only active workspace channels and DMs containing the requester", async () => {
  const { database, calls } = createDatabase();
  const result = await createMongoMessageSearchStorage(database)
    .searchForMember("workspace-1", "member-1", "roadmap", 1);

  assert.deepEqual(result.candidates.map(({ id }) => id), ["dm-hit", "channel-hit"]);
  assert.deepEqual(calls.find(({ name }) => name === CHANNEL_MEMBERSHIPS_COLLECTION)?.filter, {
    userId: "member-1"
  });
  assert.deepEqual(calls.find(({ name }) => name === CHANNELS_COLLECTION)?.filter, {
    workspaceId: "workspace-1",
    _id: { $in: ["joined-channel", "private-outsider-channel"] }
  });
  assert.deepEqual(calls.find(({ name }) => name === DIRECT_CONVERSATIONS_COLLECTION)?.filter, {
    workspaceId: "workspace-1",
    participantIds: "member-1"
  });
  const channelMessageFilter = calls.find(({ name }) => name === CHANNEL_MESSAGES_COLLECTION)?.filter;
  assert.deepEqual(channelMessageFilter, {
    $text: { $search: "roadmap" },
    channelId: { $in: ["joined-channel"] }
  });
  assert.deepEqual(calls.find(({ name }) => name === DIRECT_MESSAGES_COLLECTION)?.filter, {
    $text: { $search: "roadmap" },
    workspaceId: "workspace-1",
    conversationId: { $in: ["member-dm"] }
  });
  assert.equal(calls.some(({ name }) => name === WORKSPACE_MEMBERSHIPS_COLLECTION), true);
});

void test("fails closed when the search index migration has not been applied", async () => {
  const missingIndexes = {
    collection: () => {
      return {
        indexes: () => Promise.resolve([]),
        find: () => {
          const cursor = { toArray: () => Promise.resolve([]), sort: () => cursor, limit: () => cursor };
          return cursor;
        }
      };
    }
  } as unknown as MongoDatabase;
  await assert.rejects(
    createMongoMessageSearchStorage(missingIndexes).searchForMember("workspace-1", "member-1", "roadmap", 1),
    (error: unknown) => typeof error === "object" && error !== null
      && "kind" in error && error.kind === "message-search-storage-unavailable"
  );
});

void test("returns no candidates if workspace membership is revoked during a search", async () => {
  const { database } = createDatabase(false);
  const result = await createMongoMessageSearchStorage(database)
    .searchForMember("workspace-1", "member-1", "roadmap", 1);
  assert.deepEqual(result, { candidates: [], hasMore: false, truncated: false });
});
