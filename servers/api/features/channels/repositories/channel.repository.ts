import {
  encodeChannelListCursor,
  type Channel,
  type ChannelListQuery,
  type ChannelMembership,
  type ChannelSystemEntry
} from "../domain/index.js";
import type {
  ChannelCreationRequestDocument,
  ChannelDocument,
  ChannelMembershipDocument,
  ChannelMessageDocument
} from "../models/index.js";
import type { ChannelNotificationPreference } from "@workspace/types";

export type ChannelCreationRequest = ChannelCreationRequestDocument;

export type ChannelWriteTransaction = Readonly<{
  insertChannel: (document: ChannelDocument) => Promise<void>;
  insertMembership: (document: ChannelMembershipDocument) => Promise<void>;
  insertCreationRequest: (document: ChannelCreationRequestDocument) => Promise<void>;
  lockChannelForMembershipChange: (workspaceId: string, channelId: string) => Promise<ChannelDocument | null>;
  findMembership: (channelId: string, userId: string) => Promise<ChannelMembershipDocument | null>;
  updateMembershipNotificationPreference: (
    channelId: string,
    userId: string,
    preference: ChannelNotificationPreference
  ) => Promise<boolean>;
  deleteMembership: (channelId: string, userId: string) => Promise<void>;
  insertChannelMessage: (document: ChannelMessageDocument) => Promise<void>;
  findChannel?: (workspaceId: string, channelId: string) => Promise<ChannelDocument | null>;
  updateChannelMetadata?: (
    workspaceId: string,
    channelId: string,
    metadata: Readonly<Pick<ChannelDocument, "name" | "description" | "visibility" | "updatedAt">>
  ) => Promise<ChannelDocument | null>;
}>;

export type JoinChannelResult =
  | Readonly<{ kind: "joined"; membership: ChannelMembership }>
  | Readonly<{ kind: "already-joined"; membership: ChannelMembership }>
  | Readonly<{ kind: "channel-unavailable" }>
  | Readonly<{ kind: "not-public" }>;

export type LeaveChannelResult =
  | Readonly<{ kind: "left"; entry: ChannelSystemEntry }>
  | Readonly<{ kind: "already-left" }>
  | Readonly<{ kind: "channel-unavailable" }>;
export type UpdateChannelResult =
  | Readonly<{ kind: "updated"; channel: Channel }>
  | Readonly<{ kind: "channel-unavailable" | "not-manager" }>;

export type ChannelMembersResult =
  | Readonly<{ kind: "listed"; memberships: readonly ChannelMembership[]; canManage: boolean }>
  | Readonly<{ kind: "channel-unavailable" }>;

export type ChannelMentionMembersResult =
  | Readonly<{ kind: "listed"; userIds: readonly string[] }>
  | Readonly<{ kind: "channel-unavailable" }>;

export type ChannelNotificationPreferenceResult =
  | Readonly<{ kind: "found" | "updated"; preference: ChannelNotificationPreference }>
  | Readonly<{ kind: "channel-unavailable" }>;

export type AddChannelMemberResult =
  | Readonly<{ kind: "added"; membership: ChannelMembership }>
  | Readonly<{ kind: "already-member"; membership: ChannelMembership }>
  | Readonly<{ kind: "channel-unavailable" }>
  | Readonly<{ kind: "not-private" }>
  | Readonly<{ kind: "not-manager" }>;

export type RemoveChannelMemberResult =
  | Readonly<{ kind: "removed" }>
  | Readonly<{ kind: "already-absent" }>
  | Readonly<{ kind: "channel-unavailable" }>
  | Readonly<{ kind: "not-private" }>
  | Readonly<{ kind: "not-manager" }>
  | Readonly<{ kind: "protected-admin" }>;

export type ChannelDuplicateConstraint = "active-name" | "idempotency-key" | "other";
export type ChannelDuplicateKeyError = Readonly<{
  kind: "channel-duplicate-key";
  constraint: ChannelDuplicateConstraint;
}>;

export const isChannelDuplicateKeyError = (error: unknown): error is ChannelDuplicateKeyError =>
  typeof error === "object" && error !== null && "kind" in error && error.kind === "channel-duplicate-key";

export type ChannelStorageUnavailableError = Error & Readonly<{ kind: "channel-storage-unavailable" }>;

export const isChannelStorageUnavailableError = (error: unknown): error is ChannelStorageUnavailableError =>
  typeof error === "object" && error !== null && "kind" in error && error.kind === "channel-storage-unavailable";

export type ChannelStorage = Readonly<{
  initialize: () => Promise<void>;
  withTransaction: <Result>(operation: (transaction: ChannelWriteTransaction) => Promise<Result>) => Promise<Result>;
  findByWorkspaceAndName: (workspaceId: string, name: string) => Promise<ChannelDocument | null>;
  findById: (workspaceId: string, channelId: string) => Promise<ChannelDocument | null>;
  findForMember: (workspaceId: string, userId: string) => Promise<readonly ChannelDocument[]>;
  findChannels: (workspaceId: string, userId: string, query: ChannelListQuery) => Promise<readonly ChannelDocument[]>;
  findMembership: (channelId: string, userId: string) => Promise<ChannelMembershipDocument | null>;
  findMemberships: (channelId: string) => Promise<readonly ChannelMembershipDocument[]>;
  getNotificationPreference: (
    workspaceId: string,
    channelId: string,
    userId: string
  ) => Promise<ChannelNotificationPreference | null>;
  setNotificationPreference: (
    workspaceId: string,
    channelId: string,
    userId: string,
    preference: ChannelNotificationPreference
  ) => Promise<ChannelNotificationPreference | null>;
  findCreationRequest: (workspaceId: string, actorId: string, key: string) => Promise<ChannelCreationRequestDocument | null>;
}>;

export type ChannelRepository = Readonly<{
  initialize: () => Promise<void>;
  createAtomically: (channel: Channel, membership: ChannelMembership, request?: ChannelCreationRequest) => Promise<void>;
  findByWorkspaceAndName: (workspaceId: string, name: string) => Promise<Channel | null>;
  findById: (workspaceId: string, channelId: string) => Promise<Channel | null>;
  findForMember: (workspaceId: string, userId: string) => Promise<readonly Channel[]>;
  findChannels: (workspaceId: string, userId: string, query: ChannelListQuery) => Promise<Readonly<{
    channels: readonly Channel[];
    nextCursor: string | null;
  }>>;
  findMembership: (channelId: string, userId: string) => Promise<ChannelMembership | null>;
  listMembers: (workspaceId: string, channelId: string, userId: string) => Promise<ChannelMembersResult>;
  listMentionMembers: (
    workspaceId: string,
    channelId: string,
    userId: string
  ) => Promise<ChannelMentionMembersResult>;
  getNotificationPreference: (
    workspaceId: string,
    channelId: string,
    userId: string
  ) => Promise<ChannelNotificationPreferenceResult>;
  setNotificationPreference: (
    workspaceId: string,
    channelId: string,
    userId: string,
    preference: ChannelNotificationPreference
  ) => Promise<ChannelNotificationPreferenceResult>;
  addMember: (workspaceId: string, channelId: string, actorId: string, targetId: string, joinedAt: Date) => Promise<AddChannelMemberResult>;
  removeMember: (workspaceId: string, channelId: string, actorId: string, targetId: string) => Promise<RemoveChannelMemberResult>;
  joinPublicChannel: (workspaceId: string, channelId: string, userId: string, joinedAt: Date) => Promise<JoinChannelResult>;
  leaveChannel: (
    workspaceId: string,
    channelId: string,
    userId: string,
    entry: ChannelSystemEntry
  ) => Promise<LeaveChannelResult>;
  updateChannel?: (
    workspaceId: string,
    channelId: string,
    actorId: string,
    metadata: Readonly<Pick<Channel, "name" | "description" | "visibility">>,
    updatedAt: Date
  ) => Promise<UpdateChannelResult>;
  findCreationRequest: (workspaceId: string, actorId: string, key: string) => Promise<ChannelCreationRequestDocument | null>;
}>;

const toChannel = (document: ChannelDocument): Channel => Object.freeze({
  id: document._id,
  workspaceId: document.workspaceId,
  name: document.name,
  description: document.description ?? null,
  visibility: document.visibility,
  lifecycleState: document.lifecycleState,
  createdBy: document.createdBy,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
  archivedAt: document.archivedAt
});

const toMembership = (document: ChannelMembershipDocument): ChannelMembership => Object.freeze({
  channelId: document.channelId,
  userId: document.userId,
  role: document.role,
  joinedAt: document.joinedAt
});

const toChannelDocument = (channel: Channel): ChannelDocument => Object.freeze({
  _id: channel.id,
  workspaceId: channel.workspaceId,
  name: channel.name,
  description: channel.description,
  visibility: channel.visibility,
  lifecycleState: channel.lifecycleState,
  createdBy: channel.createdBy,
  createdAt: channel.createdAt,
  updatedAt: channel.updatedAt,
  archivedAt: channel.archivedAt,
  membershipRevision: 0
});

const toMembershipDocument = (membership: ChannelMembership): ChannelMembershipDocument => Object.freeze({
  _id: `${membership.channelId}:${membership.userId}`,
  channelId: membership.channelId,
  userId: membership.userId,
  role: membership.role,
  joinedAt: membership.joinedAt
});

export const createChannelRepository = (storage: ChannelStorage): ChannelRepository => Object.freeze({
  initialize: storage.initialize,
  createAtomically: async (channel, membership, request): Promise<void> => {
    await storage.withTransaction(async (transaction) => {
      await transaction.insertChannel(toChannelDocument(channel));
      await transaction.insertMembership(toMembershipDocument(membership));
      if (request) await transaction.insertCreationRequest(request);
    });
  },
  findByWorkspaceAndName: async (workspaceId, name): Promise<Channel | null> => {
    const document = await storage.findByWorkspaceAndName(workspaceId, name);
    return document?.lifecycleState === "active" ? toChannel(document) : null;
  },
  findById: async (workspaceId, channelId): Promise<Channel | null> => {
    const document = await storage.findById(workspaceId, channelId);
    return document ? toChannel(document) : null;
  },
  findForMember: async (workspaceId, userId): Promise<readonly Channel[]> => {
    const documents = await storage.findForMember(workspaceId, userId);
    return Object.freeze(documents.map(toChannel));
  },
  findChannels: async (workspaceId, userId, query) => {
    const documents = await storage.findChannels(workspaceId, userId, query);
    const hasMore = documents.length > query.pageSize;
    const page = documents.slice(0, query.pageSize);
    const last = page.at(-1);
    return Object.freeze({
      channels: Object.freeze(page.map(toChannel)),
      nextCursor: hasMore && last
        ? encodeChannelListCursor(Object.freeze({ scope: query.scope, name: last.name }))
        : null
    });
  },
  findMembership: async (channelId, userId): Promise<ChannelMembership | null> => {
    const document = await storage.findMembership(channelId, userId);
    return document ? toMembership(document) : null;
  },
  listMembers: async (workspaceId, channelId, userId): Promise<ChannelMembersResult> => {
    const [channel, viewer] = await Promise.all([
      storage.findById(workspaceId, channelId),
      storage.findMembership(channelId, userId)
    ]);
    if (!channel || channel.visibility !== "private" || !viewer) return Object.freeze({ kind: "channel-unavailable" });
    const documents = await storage.findMemberships(channelId);
    return Object.freeze({
      kind: "listed",
      memberships: Object.freeze(documents.map(toMembership)),
      canManage: viewer.role === "admin"
    });
  },
  listMentionMembers: async (workspaceId, channelId, userId): Promise<ChannelMentionMembersResult> => {
    const [channel, viewer] = await Promise.all([
      storage.findById(workspaceId, channelId),
      storage.findMembership(channelId, userId)
    ]);
    if (!channel || channel.lifecycleState !== "active" || !viewer) {
      return Object.freeze({ kind: "channel-unavailable" });
    }
    const memberships = await storage.findMemberships(channelId);
    return Object.freeze({
      kind: "listed",
      userIds: Object.freeze(memberships.map(({ userId: memberId }) => memberId))
    });
  },
  getNotificationPreference: async (workspaceId, channelId, userId) => {
    const preference = await storage.getNotificationPreference(workspaceId, channelId, userId);
    return preference === null
      ? Object.freeze({ kind: "channel-unavailable" })
      : Object.freeze({ kind: "found", preference });
  },
  setNotificationPreference: async (workspaceId, channelId, userId, preference) => {
    const updated = await storage.setNotificationPreference(workspaceId, channelId, userId, preference);
    return updated === null
      ? Object.freeze({ kind: "channel-unavailable" })
      : Object.freeze({ kind: "updated", preference: updated });
  },
  addMember: (workspaceId, channelId, actorId, targetId, joinedAt): Promise<AddChannelMemberResult> =>
    storage.withTransaction(async (transaction) => {
      const channel = await transaction.lockChannelForMembershipChange(workspaceId, channelId);
      if (!channel) return Object.freeze({ kind: "channel-unavailable" });
      if (channel.visibility !== "private") return Object.freeze({ kind: "not-private" });
      const actor = await transaction.findMembership(channelId, actorId);
      if (!actor) return Object.freeze({ kind: "channel-unavailable" });
      if (actor.role !== "admin") return Object.freeze({ kind: "not-manager" });
      const existing = await transaction.findMembership(channelId, targetId);
      if (existing) return Object.freeze({ kind: "already-member", membership: toMembership(existing) });
      const membership: ChannelMembership = Object.freeze({
        channelId,
        userId: targetId,
        role: "member",
        joinedAt
      });
      await transaction.insertMembership(toMembershipDocument(membership));
      return Object.freeze({ kind: "added", membership });
    }),
  removeMember: (workspaceId, channelId, actorId, targetId): Promise<RemoveChannelMemberResult> =>
    storage.withTransaction(async (transaction) => {
      const channel = await transaction.lockChannelForMembershipChange(workspaceId, channelId);
      if (!channel) return Object.freeze({ kind: "channel-unavailable" });
      if (channel.visibility !== "private") return Object.freeze({ kind: "not-private" });
      const actor = await transaction.findMembership(channelId, actorId);
      if (!actor) return Object.freeze({ kind: "channel-unavailable" });
      if (actor.role !== "admin") return Object.freeze({ kind: "not-manager" });
      const target = await transaction.findMembership(channelId, targetId);
      if (!target) return Object.freeze({ kind: "already-absent" });
      if (target.role === "admin") return Object.freeze({ kind: "protected-admin" });
      await transaction.deleteMembership(channelId, targetId);
      return Object.freeze({ kind: "removed" });
    }),
  joinPublicChannel: async (workspaceId, channelId, userId, joinedAt): Promise<JoinChannelResult> =>
    storage.withTransaction(async (transaction) => {
      const channel = await transaction.lockChannelForMembershipChange(workspaceId, channelId);
      if (!channel) return Object.freeze({ kind: "channel-unavailable" });
      if (channel.visibility !== "public") return Object.freeze({ kind: "not-public" });
      const existing = await transaction.findMembership(channelId, userId);
      if (existing) return Object.freeze({ kind: "already-joined", membership: toMembership(existing) });
      const membership: ChannelMembership = Object.freeze({
        channelId,
        userId,
        role: "member",
        joinedAt
      });
      await transaction.insertMembership(toMembershipDocument(membership));
      return Object.freeze({ kind: "joined", membership });
    }),
  leaveChannel: (workspaceId, channelId, userId, entry): Promise<LeaveChannelResult> =>
    storage.withTransaction(async (transaction) => {
      const channel = await transaction.lockChannelForMembershipChange(workspaceId, channelId);
      if (!channel) return Object.freeze({ kind: "channel-unavailable" });
      const membership = await transaction.findMembership(channelId, userId);
      if (!membership) return Object.freeze({ kind: "already-left" });
      await transaction.deleteMembership(channelId, userId);
      await transaction.insertChannelMessage(Object.freeze({
        _id: entry.id,
        channelId: entry.channelId,
        type: "system",
        systemEvent: entry.systemEvent,
        actorId: entry.actor.id,
        actorName: entry.actor.name,
        text: "",
        createdAt: entry.createdAt,
        leftAt: entry.createdAt
      }));
      return Object.freeze({ kind: "left", entry });
    }),
  updateChannel: (workspaceId, channelId, actorId, metadata, updatedAt): Promise<UpdateChannelResult> =>
    storage.withTransaction(async (transaction) => {
      if (!transaction.findChannel || !transaction.updateChannelMetadata) {
        return Object.freeze({ kind: "channel-unavailable" });
      }
      const channel = await transaction.findChannel(workspaceId, channelId);
      if (!channel) return Object.freeze({ kind: "channel-unavailable" });
      const actor = await transaction.findMembership(channelId, actorId);
      if (!actor) return Object.freeze({ kind: "channel-unavailable" });
      if (actor.role !== "admin") return Object.freeze({ kind: "not-manager" });
      const updated = await transaction.updateChannelMetadata(workspaceId, channelId, {
        ...metadata,
        updatedAt
      });
      return updated
        ? Object.freeze({ kind: "updated", channel: toChannel(updated) })
        : Object.freeze({ kind: "channel-unavailable" });
    }),
  findCreationRequest: storage.findCreationRequest
});
