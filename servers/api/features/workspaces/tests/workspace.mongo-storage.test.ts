import test from "node:test";
import assert from "node:assert/strict";
import type { MongoDatabase, MongoTransaction } from "../../../integrations/mongodb/index.js";
import type { WorkspaceMembershipDocument } from "../models/index.js";
import {
  WORKSPACE_COLLECTION_VALIDATORS,
  WORKSPACE_INDEXES,
  WORKSPACE_INVITE_LINKS_COLLECTION,
  WORKSPACE_MEMBERSHIPS_COLLECTION,
  WORKSPACES_COLLECTION
} from "../models/index.js";
import { createMongoWorkspaceStorage } from "../integrations/index.js";

const makeDatabase = (initialMemberships: readonly WorkspaceMembershipDocument[] = []) => {
  const calls: unknown[] = [];
  const membershipsById = new Map(initialMemberships.map((membership) => [membership._id, { ...membership }]));
  const readFilter = (value: unknown): Readonly<Record<string, unknown>> =>
    typeof value === "object" && value !== null ? value as Readonly<Record<string, unknown>> : {};
  const database = {
    createCollection: (name: string, options: unknown) => {
      calls.push({ operation: "createCollection", name, options });
      return Promise.resolve({});
    },
    command: (command: unknown) => {
      calls.push({ operation: "command", command });
      return Promise.resolve({});
    },
    listCollections: ({ name }: Readonly<{ name: string }>) => ({
      next: () => Promise.resolve({
        name,
        options: {
          validator: WORKSPACE_COLLECTION_VALIDATORS[
            name as typeof WORKSPACES_COLLECTION | typeof WORKSPACE_MEMBERSHIPS_COLLECTION | typeof WORKSPACE_INVITE_LINKS_COLLECTION
          ]
        }
      })
    }),
    collection: (name: typeof WORKSPACES_COLLECTION | typeof WORKSPACE_MEMBERSHIPS_COLLECTION | typeof WORKSPACE_INVITE_LINKS_COLLECTION) => ({
      createIndex: (keys: unknown, options: unknown) => {
        calls.push({ operation: "createIndex", name, keys, options });
        return Promise.resolve("created");
      },
      indexes: () => Promise.resolve(WORKSPACE_INDEXES[name].map((index) => ({
        name: index.options.name,
        key: index.keys,
        ...("unique" in index.options ? { unique: index.options.unique } : {}),
        ...("expireAfterSeconds" in index.options ? { expireAfterSeconds: index.options.expireAfterSeconds } : {})
      }))),
      find: (filter: unknown) => {
        calls.push({ operation: "find", name, filter });
        return {
          sort: (sort: unknown) => {
            calls.push({ operation: "sort", name, sort });
            return { toArray: () => Promise.resolve([]) };
          },
          toArray: () => Promise.resolve([])
        };
      },
      findOne: (filter: unknown) => {
        calls.push({ operation: "findOne", name, filter });
        if (name !== WORKSPACE_MEMBERSHIPS_COLLECTION) return Promise.resolve(null);
        const criteria = readFilter(filter);
        const membership = [...membershipsById.values()].find((entry) =>
          entry.workspaceId === criteria.workspaceId && entry.userId === criteria.userId);
        return Promise.resolve(membership ?? null);
      },
      updateOne: (filter: unknown, update: unknown, options?: unknown) => {
        calls.push({ operation: "updateOne", name, filter, update, ...(options === undefined ? {} : { options }) });
        if (name !== WORKSPACE_MEMBERSHIPS_COLLECTION) return Promise.resolve({ matchedCount: 1 });
        const criteria = readFilter(filter);
        const change = readFilter(update);
        const setValues = readFilter(change.$set);
        const membership = [...membershipsById.values()].find((entry) =>
          entry.workspaceId === criteria.workspaceId && entry.userId === criteria.userId);
        if (!membership) return Promise.resolve({ matchedCount: 0 });
        if (setValues.role === "admin" || setValues.role === "member") {
          membershipsById.set(membership._id, { ...membership, role: setValues.role });
        }
        return Promise.resolve({ matchedCount: 1 });
      },
      countDocuments: (filter: unknown, options?: unknown) => {
        calls.push({ operation: "countDocuments", name, filter, options });
        const criteria = readFilter(filter);
        return Promise.resolve([...membershipsById.values()].filter((entry) =>
          entry.workspaceId === criteria.workspaceId && entry.role === criteria.role).length);
      },
      deleteOne: (filter: unknown, options?: unknown) => {
        calls.push({ operation: "deleteOne", name, filter, options });
        const criteria = readFilter(filter);
        const membership = [...membershipsById.values()].find((entry) =>
          entry.workspaceId === criteria.workspaceId && entry.userId === criteria.userId);
        if (!membership) return Promise.resolve({ deletedCount: 0 });
        membershipsById.delete(membership._id);
        return Promise.resolve({ deletedCount: 1 });
      },
      insertOne: (document: unknown, options?: unknown) => {
        calls.push({ operation: "insertOne", name, document, options });
        return Promise.resolve({});
      }
    })
  };
  const withTransaction: MongoTransaction = (operation) => operation({} as never);
  return { database: database as unknown as MongoDatabase, calls, withTransaction, membershipsById };
};

void test("initializes workspace, membership, and reusable invitation validators and indexes", async () => {
  const { database, calls, withTransaction } = makeDatabase();
  await createMongoWorkspaceStorage(database, withTransaction).initialize();

  assert.equal(calls.filter((call) =>
    typeof call === "object" && call !== null && "operation" in call && call.operation === "createCollection").length, 3);
  assert.equal(calls.filter((call) =>
    typeof call === "object" && call !== null && "operation" in call && call.operation === "createIndex").length, 5);
});

void test("only resolves unexpired invitation token hashes and transactionally writes memberships", async () => {
  const { database, calls, withTransaction } = makeDatabase();
  const storage = createMongoWorkspaceStorage(database, withTransaction);
  const checkedAt = new Date("2026-10-14T00:00:00.000Z");
  await storage.findInviteLink("a".repeat(64), checkedAt);
  assert.deepEqual(calls[0], {
    operation: "findOne",
    name: WORKSPACE_INVITE_LINKS_COLLECTION,
    filter: { tokenHash: "a".repeat(64), expiresAt: { $gt: checkedAt } }
  });

  const invite = {
    _id: "invite-1",
    workspaceId: "workspace-1",
    createdBy: "admin-1",
    tokenHash: "a".repeat(64),
    createdAt: checkedAt,
    expiresAt: new Date("2026-10-21T00:00:00.000Z")
  };
  assert.equal(await storage.createMembershipFromInvite(invite, "member-1", checkedAt), "joined");
  assert.deepEqual(calls.at(-1), {
    operation: "insertOne",
    name: WORKSPACE_MEMBERSHIPS_COLLECTION,
    document: {
      _id: "workspace-1:member-1",
      workspaceId: "workspace-1",
      userId: "member-1",
      role: "member",
      joinedAt: checkedAt
    },
    options: { session: {} }
  });
});

void test("lists workspace memberships in join order with a stable user tie-breaker", async () => {
  const { database, calls, withTransaction } = makeDatabase();
  const storage = createMongoWorkspaceStorage(database, withTransaction);
  await storage.listWorkspaceMemberships("team-1");

  assert.deepEqual(calls.slice(-2), [
    {
      operation: "find",
      name: WORKSPACE_MEMBERSHIPS_COLLECTION,
      filter: { workspaceId: "team-1" }
    },
    {
      operation: "sort",
      name: WORKSPACE_MEMBERSHIPS_COLLECTION,
      sort: { joinedAt: 1, userId: 1 }
    }
  ]);
});

void test("persists workspace email visibility settings", async () => {
  const { database, calls, withTransaction } = makeDatabase();
  const storage = createMongoWorkspaceStorage(database, withTransaction);
  assert.equal(await storage.setMemberEmailsVisible("team-1", false), true);
  assert.deepEqual(calls.at(-1), {
    operation: "updateOne",
    name: WORKSPACES_COLLECTION,
    filter: { _id: "team-1" },
    update: { $set: { memberEmailsVisible: false } }
  });
});

void test("updates roles and removes memberships transactionally with workspace-wide admin serialization", async () => {
  const initialMemberships: readonly WorkspaceMembershipDocument[] = [
    { _id: "team-1:owner-1", workspaceId: "team-1", userId: "owner-1", role: "admin", joinedAt: new Date() },
    { _id: "team-1:member-1", workspaceId: "team-1", userId: "member-1", role: "member", joinedAt: new Date() }
  ];
  const { database, calls, withTransaction, membershipsById } = makeDatabase(initialMemberships);
  const storage = createMongoWorkspaceStorage(database, withTransaction);

  assert.equal(await storage.changeMemberRole("team-1", "owner-1", "member-1", "admin"), "updated");
  assert.equal(membershipsById.get("team-1:member-1")?.role, "admin");
  assert.equal(calls.some((call) =>
    typeof call === "object" && call !== null && "name" in call && call.name === WORKSPACES_COLLECTION
      && "update" in call && JSON.stringify(call.update) === JSON.stringify({ $inc: { membershipRevision: 1 } })
  ), true);

  assert.equal(await storage.removeMember("team-1", "owner-1", "member-1"), "removed");
  assert.equal(membershipsById.has("team-1:member-1"), false);
});
