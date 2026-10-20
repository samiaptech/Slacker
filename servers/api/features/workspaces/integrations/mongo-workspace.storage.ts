import { isDeepStrictEqual } from "node:util";
import type { MongoDatabase, MongoTransaction } from "../../../integrations/mongodb/index.js";
import {
  WORKSPACE_COLLECTION_VALIDATORS,
  WORKSPACE_INDEXES,
  WORKSPACE_INVITE_LINKS_COLLECTION,
  WORKSPACE_MEMBERSHIPS_COLLECTION,
  WORKSPACES_COLLECTION,
  type WorkspaceDocument,
  type WorkspaceInviteLinkDocument,
  type WorkspaceMembershipDocument
} from "../models/index.js";
import type {
  WorkspaceMemberMutationResult,
  WorkspaceStorage,
  WorkspaceStorageUnavailableError,
  WorkspaceWriteTransaction
} from "../repositories/index.js";

type WorkspaceIndexDefinition = Readonly<{
  keys: unknown;
  options: Readonly<{ name: string; unique?: boolean; expireAfterSeconds?: number }>;
}>;
type WorkspaceCollectionName =
  | typeof WORKSPACES_COLLECTION
  | typeof WORKSPACE_MEMBERSHIPS_COLLECTION
  | typeof WORKSPACE_INVITE_LINKS_COLLECTION;
type CollectionMetadata = Readonly<{
  name: WorkspaceCollectionName;
  validator: unknown;
  createIndex: (keys: unknown, options: unknown) => Promise<string>;
  expectedIndexes: readonly WorkspaceIndexDefinition[];
  indexes: () => Promise<readonly Readonly<{
    name?: string;
    key: unknown;
    unique?: boolean;
    expireAfterSeconds?: number;
  }>[]>;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isAlreadyExists = (error: unknown): boolean => isRecord(error) && error.code === 48;
const isDuplicate = (error: unknown): boolean => isRecord(error) && error.code === 11000;

const unavailable: WorkspaceStorageUnavailableError = Object.freeze({ kind: "workspace-storage-unavailable" });
const unavailableError = Object.assign(new Error("Workspace storage is unavailable."), unavailable);
const persistenceError = (error: unknown): unknown => {
  if (isRecord(error) && (error.code === 20 || error.code === 303)) return unavailableError;
  return error;
};

const ensureCollection = async (database: MongoDatabase, collectionName: string, validator: unknown): Promise<void> => {
  try {
    await database.createCollection(collectionName, {
      validator: validator as never,
      validationLevel: "strict",
      validationAction: "error"
    });
  } catch (error: unknown) {
    if (!isAlreadyExists(error)) throw error;
    await database.command({
      collMod: collectionName,
      validator: validator as never,
      validationLevel: "strict",
      validationAction: "error"
    });
  }
};

export const createMongoWorkspaceStorage = (
  database: MongoDatabase,
  withTransaction: MongoTransaction
): WorkspaceStorage => {
  const workspaces = database.collection<WorkspaceDocument>(WORKSPACES_COLLECTION);
  const memberships = database.collection<WorkspaceMembershipDocument>(WORKSPACE_MEMBERSHIPS_COLLECTION);
  const inviteLinks = database.collection<WorkspaceInviteLinkDocument>(WORKSPACE_INVITE_LINKS_COLLECTION);
  const collections: readonly CollectionMetadata[] = [
    {
      name: WORKSPACES_COLLECTION,
      validator: WORKSPACE_COLLECTION_VALIDATORS[WORKSPACES_COLLECTION],
      expectedIndexes: WORKSPACE_INDEXES[WORKSPACES_COLLECTION],
      createIndex: (keys, options) => workspaces.createIndex(keys as never, options as never),
      indexes: () => workspaces.indexes()
    },
    {
      name: WORKSPACE_MEMBERSHIPS_COLLECTION,
      validator: WORKSPACE_COLLECTION_VALIDATORS[WORKSPACE_MEMBERSHIPS_COLLECTION],
      expectedIndexes: WORKSPACE_INDEXES[WORKSPACE_MEMBERSHIPS_COLLECTION],
      createIndex: (keys, options) => memberships.createIndex(keys as never, options as never),
      indexes: () => memberships.indexes()
    },
    {
      name: WORKSPACE_INVITE_LINKS_COLLECTION,
      validator: WORKSPACE_COLLECTION_VALIDATORS[WORKSPACE_INVITE_LINKS_COLLECTION],
      expectedIndexes: WORKSPACE_INDEXES[WORKSPACE_INVITE_LINKS_COLLECTION],
      createIndex: (keys, options) => inviteLinks.createIndex(keys as never, options as never),
      indexes: () => inviteLinks.indexes()
    }
  ];
  const ensureReady = async (): Promise<void> => {
    try {
      for (const entry of collections) {
        const metadata: unknown = await database.listCollections({ name: entry.name }).next();
        const options = isRecord(metadata) && isRecord(metadata.options) ? metadata.options : null;
        if (!options || !isDeepStrictEqual(options.validator, entry.validator)) throw unavailableError;
        const actualIndexes = await entry.indexes();
        for (const expected of entry.expectedIndexes) {
          const actual = actualIndexes.find((index) => index.name === expected.options.name);
          if (!actual || !isDeepStrictEqual(actual.key, expected.keys)
            || Boolean(actual.unique) !== Boolean(expected.options.unique)
            || actual.expireAfterSeconds !== expected.options.expireAfterSeconds) {
            throw unavailableError;
          }
        }
      }
    } catch (error: unknown) {
      if (error === unavailableError) throw error;
      throw persistenceError(error);
    }
  };
  const mutateMembership = async (
    workspaceId: string,
    actorId: string,
    memberId: string,
    operation: "role" | "remove",
    role?: "admin" | "member"
  ): Promise<WorkspaceMemberMutationResult> => {
    try {
      await ensureReady();
      return await withTransaction(async (session) => {
        const actor = await memberships.findOne({ workspaceId, userId: actorId }, { session });
        const target = await memberships.findOne({ workspaceId, userId: memberId }, { session });
        if (!actor || actor.role !== "admin") return "denied";
        if (!target) return "not-found";

        const workspaceUpdate = await workspaces.updateOne(
          { _id: workspaceId },
          { $inc: { membershipRevision: 1 } },
          { session }
        );
        if (workspaceUpdate.matchedCount === 0) return "not-found";

        if (target.role === "admin" && (operation === "remove" || role === "member")) {
          const adminCount = await memberships.countDocuments({ workspaceId, role: "admin" }, { session });
          if (adminCount <= 1) return "last-admin";
        }

        if (operation === "remove") {
          const result = await memberships.deleteOne({ workspaceId, userId: memberId }, { session });
          return result.deletedCount > 0 ? "removed" : "not-found";
        }

        if (!role) throw new Error("A target role is required for workspace membership updates.");
        const result = await memberships.updateOne(
          { workspaceId, userId: memberId },
          { $set: { role } },
          { session }
        );
        return result.matchedCount > 0 ? "updated" : "not-found";
      });
    } catch (error: unknown) {
      throw persistenceError(error);
    }
  };
  const transact = async <Result>(operation: (transaction: WorkspaceWriteTransaction) => Promise<Result>): Promise<Result> => {
    try {
      await ensureReady();
      return await withTransaction((session) => operation(Object.freeze({
        insertWorkspace: async (document): Promise<void> => { await workspaces.insertOne(document, { session }); },
        insertMembership: async (document): Promise<void> => { await memberships.insertOne(document, { session }); },
        insertInviteLink: async (document): Promise<void> => { await inviteLinks.insertOne(document, { session }); }
      })));
    } catch (error: unknown) {
      throw persistenceError(error);
    }
  };

  return Object.freeze({
    initialize: async (): Promise<void> => {
      for (const entry of collections) {
        await ensureCollection(database, entry.name, entry.validator);
        for (const index of entry.expectedIndexes) {
          await entry.createIndex(index.keys, index.options);
        }
      }
    },
    withTransaction: transact,
    listMemberships: async (userId): Promise<readonly WorkspaceMembershipDocument[]> => {
      try {
        await ensureReady();
        return await memberships.find({ userId }).sort({ joinedAt: 1 }).toArray();
      } catch (error: unknown) {
        throw persistenceError(error);
      }
    },
    listWorkspaceMemberships: async (workspaceId): Promise<readonly WorkspaceMembershipDocument[]> => {
      try {
        await ensureReady();
        return await memberships.find({ workspaceId }).sort({ joinedAt: 1, userId: 1 }).toArray();
      } catch (error: unknown) {
        throw persistenceError(error);
      }
    },
    findWorkspace: async (workspaceId): Promise<WorkspaceDocument | null> => {
      try {
        await ensureReady();
        return await workspaces.findOne({ _id: workspaceId });
      } catch (error: unknown) {
        throw persistenceError(error);
      }
    },
    setMemberEmailsVisible: async (workspaceId, visible): Promise<boolean> => {
      try {
        await ensureReady();
        const result = await workspaces.updateOne({ _id: workspaceId }, { $set: { memberEmailsVisible: visible } });
        return result.matchedCount > 0;
      } catch (error: unknown) {
        throw persistenceError(error);
      }
    },
    changeMemberRole: (workspaceId, actorId, memberId, role): Promise<WorkspaceMemberMutationResult> =>
      mutateMembership(workspaceId, actorId, memberId, "role", role),
    removeMember: (workspaceId, actorId, memberId): Promise<WorkspaceMemberMutationResult> =>
      mutateMembership(workspaceId, actorId, memberId, "remove"),
    findMembership: async (workspaceId, userId): Promise<WorkspaceMembershipDocument | null> => {
      try {
        await ensureReady();
        return await memberships.findOne({ workspaceId, userId });
      } catch (error: unknown) {
        throw persistenceError(error);
      }
    },
    findInviteLink: async (tokenHash, now): Promise<WorkspaceInviteLinkDocument | null> => {
      try {
        await ensureReady();
        return await inviteLinks.findOne({ tokenHash, expiresAt: { $gt: now } });
      } catch (error: unknown) {
        throw persistenceError(error);
      }
    },
    createMembershipFromInvite: async (invite, userId, joinedAt): Promise<"joined" | "already-member" | "unavailable"> => {
      const membership: WorkspaceMembershipDocument = Object.freeze({
        _id: `${invite.workspaceId}:${userId}`,
        workspaceId: invite.workspaceId,
        userId,
        role: "member",
        joinedAt
      });
      try {
        await transact(async (transaction) => transaction.insertMembership(membership));
        return "joined";
      } catch (error: unknown) {
        if (!isDuplicate(error)) {
          if (isRecord(error) && error.kind === unavailable.kind) return "unavailable";
          throw error;
        }
        let existing: WorkspaceMembershipDocument | null;
        try {
          existing = await memberships.findOne({ workspaceId: invite.workspaceId, userId });
        } catch (lookupError: unknown) {
          const classifiedError = persistenceError(lookupError);
          if (isRecord(classifiedError) && classifiedError.kind === unavailable.kind) return "unavailable";
          throw classifiedError;
        }
        if (existing) return "already-member";
        throw error;
      }
    }
  });
};
