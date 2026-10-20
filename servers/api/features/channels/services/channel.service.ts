import type { Channel, ChannelMembership } from "../domain/index.js";
import type { Logger } from "@workspace/logging";
import {
  prepareCreateChannelCommand,
  type ChannelListQuery,
  type CreateChannelCommandError,
  type CreateChannelResult
} from "../domain/index.js";
import {
  isChannelDuplicateKeyError,
  isChannelStorageUnavailableError,
  type AddChannelMemberResult,
  type ChannelMembersResult,
  type ChannelCreationRequest,
  type ChannelRepository,
  type RemoveChannelMemberResult
} from "../repositories/index.js";

export type CreateChannelInput = Readonly<{
  workspaceId: string;
  creatorId: string;
  name: string;
  description?: string;
  visibility: string;
  idempotencyKey?: string;
}>;

export type CreateChannelServiceResult =
  | Readonly<{ kind: "created"; replayed: boolean; result: CreateChannelResult }>
  | Readonly<{ kind: "invalid"; error: CreateChannelCommandError }>
  | Readonly<{ kind: "conflict"; error: "channel_name_conflict" | "idempotency_key_reused" }>
  | Readonly<{ kind: "unavailable" }>;

export type JoinChannelServiceResult =
  | Readonly<{ kind: "joined"; membership: ChannelMembership }>
  | Readonly<{ kind: "already-joined"; membership: ChannelMembership }>
  | Readonly<{ kind: "channel-unavailable" }>
  | Readonly<{ kind: "not-public" }>
  | Readonly<{ kind: "unavailable" }>;

export type LeaveChannelServiceResult =
  | Readonly<{ kind: "left" }>
  | Readonly<{ kind: "already-left" }>
  | Readonly<{ kind: "channel-unavailable" }>
  | Readonly<{ kind: "unavailable" }>;

export type EnsureGeneralChannelResult =
  | Readonly<{ kind: "ready"; channelId: string }>
  | Readonly<{ kind: "unavailable" }>;

export type ChannelMemberProfile = Readonly<{
  id: string;
  name: string;
  email: string;
  image: string | null;
}>;

type WorkspaceMemberLookupResult =
  | Readonly<{ kind: "found"; member: ChannelMemberProfile }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "unavailable" }>;

export type ChannelMemberDetails = Readonly<ChannelMembership & {
  name: string | null;
  email: string | null;
  image: string | null;
}>;

export type ChannelMembersServiceResult =
  | Readonly<{ kind: "listed"; members: readonly ChannelMemberDetails[]; canManage: boolean }>
  | Readonly<{ kind: "channel-unavailable" }>
  | Readonly<{ kind: "unavailable" }>;

export type InviteChannelMemberServiceResult =
  | AddChannelMemberResult
  | Readonly<{ kind: "target-unavailable" }>
  | Readonly<{ kind: "workspace-unavailable" }>
  | Readonly<{ kind: "unavailable" }>;

export type RemoveChannelMemberServiceResult =
  | RemoveChannelMemberResult
  | Readonly<{ kind: "unavailable" }>;

type ChannelServiceDependencies = Readonly<{
  repository: ChannelRepository;
  logger: Logger;
  createId: () => string;
  now: () => Date;
  findWorkspaceMemberByEmail: (workspaceId: string, email: string) => Promise<WorkspaceMemberLookupResult>;
  findWorkspaceMembersByIds: (userIds: readonly string[]) => Promise<readonly ChannelMemberProfile[]>;
}>;

export const createChannelService = ({
  repository,
  logger,
  createId,
  now,
  findWorkspaceMemberByEmail,
  findWorkspaceMembersByIds
}: ChannelServiceDependencies) => Object.freeze({
  getForMember: async (workspaceId: string, channelId: string, userId: string): Promise<Channel | null> => {
    const membership = await repository.findMembership(channelId, userId);
    if (!membership) return null;
    return repository.findById(workspaceId, channelId);
  },
  listForMember: (workspaceId: string, userId: string): Promise<readonly Channel[]> =>
    repository.findForMember(workspaceId, userId),
  listChannels: (workspaceId: string, userId: string, query: ChannelListQuery) =>
    repository.findChannels(workspaceId, userId, query),
  listMembers: async (workspaceId: string, channelId: string, userId: string): Promise<ChannelMembersServiceResult> => {
    try {
      const result: ChannelMembersResult = await repository.listMembers(workspaceId, channelId, userId);
      if (result.kind !== "listed") return result;
      const profiles = await findWorkspaceMembersByIds(result.memberships.map((membership) => membership.userId));
      const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
      return Object.freeze({
        kind: "listed",
        canManage: result.canManage,
        members: Object.freeze(result.memberships.map((membership) => {
          const profile = profilesById.get(membership.userId);
          return Object.freeze({
            ...membership,
            name: profile?.name ?? null,
            email: profile?.email ?? null,
            image: profile?.image ?? null
          });
        }))
      });
    } catch (error: unknown) {
      if (isChannelStorageUnavailableError(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  },
  inviteMember: async (
    workspaceId: string,
    channelId: string,
    actorId: string,
    email: string
  ): Promise<InviteChannelMemberServiceResult> => {
    try {
      const occurredAt = now();
      const channel = await repository.findById(workspaceId, channelId);
      const actor = await repository.findMembership(channelId, actorId);
      if (!channel || !actor) return Object.freeze({ kind: "channel-unavailable" });
      if (actor.role !== "admin") return Object.freeze({ kind: "not-manager" });
      const targetResult = await findWorkspaceMemberByEmail(workspaceId, email);
      if (targetResult.kind === "unavailable") return Object.freeze({ kind: "workspace-unavailable" });
      if (targetResult.kind === "not-found") return Object.freeze({ kind: "target-unavailable" });
      const target = targetResult.member;
      const result = await repository.addMember(workspaceId, channelId, actorId, target.id, occurredAt);
      if (result.kind === "added" || result.kind === "already-member") {
        logger.info("Channel membership invite processed.", {
          event: "channel.member_invited",
          outcome: result.kind,
          actorId,
          targetId: target.id,
          workspaceId,
          channelId,
          occurredAt: occurredAt.toISOString()
        });
      }
      return result;
    } catch (error: unknown) {
      if (isChannelStorageUnavailableError(error)) return Object.freeze({ kind: "unavailable" });
      if (isChannelDuplicateKeyError(error)) {
        const targetResult = await findWorkspaceMemberByEmail(workspaceId, email);
        if (targetResult.kind === "unavailable") return Object.freeze({ kind: "workspace-unavailable" });
        if (targetResult.kind === "found") {
          const membership = await repository.findMembership(channelId, targetResult.member.id);
          if (membership) return Object.freeze({ kind: "already-member", membership });
        }
      }
      throw error;
    }
  },
  removeMember: async (
    workspaceId: string,
    channelId: string,
    actorId: string,
    targetId: string
  ): Promise<RemoveChannelMemberServiceResult> => {
    try {
      const result = await repository.removeMember(workspaceId, channelId, actorId, targetId);
      if (result.kind === "removed" || result.kind === "already-absent") {
        logger.info("Channel membership removal processed.", {
          event: "channel.member_removed",
          outcome: result.kind,
          actorId,
          targetId,
          workspaceId,
          channelId,
          occurredAt: now().toISOString()
        });
      }
      return result;
    } catch (error: unknown) {
      if (isChannelStorageUnavailableError(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  },
  joinPublicChannel: async (workspaceId: string, channelId: string, userId: string): Promise<JoinChannelServiceResult> => {
    try {
      const occurredAt = now();
      const result = await repository.joinPublicChannel(workspaceId, channelId, userId, occurredAt);
      if (result.kind === "joined") {
        logger.info("Member joined a public channel.", {
          event: "channel.member_joined",
          outcome: "joined",
          actorId: userId,
          targetId: userId,
          workspaceId,
          channelId,
          occurredAt: occurredAt.toISOString()
        });
      }
      return result;
    } catch (error: unknown) {
      if (isChannelStorageUnavailableError(error)) return Object.freeze({ kind: "unavailable" });
      if (isChannelDuplicateKeyError(error)) {
        const membership = await repository.findMembership(channelId, userId);
        if (membership) return Object.freeze({ kind: "already-joined", membership });
      }
      throw error;
    }
  },
  ensureGeneralChannel: async (workspaceId: string, userId: string): Promise<EnsureGeneralChannelResult> => {
    try {
      let channel = await repository.findByWorkspaceAndName(workspaceId, "general");
      if (!channel) {
        const createdAt = now();
        const newChannel: Channel = Object.freeze({
          id: createId(),
          workspaceId,
          name: "general",
          description: null,
          visibility: "public",
          lifecycleState: "active",
          createdBy: userId,
          createdAt,
          updatedAt: createdAt,
          archivedAt: null
        });
        const initialMembership: ChannelMembership = Object.freeze({
          channelId: newChannel.id,
          userId,
          role: "member",
          joinedAt: createdAt
        });
        try {
          await repository.createAtomically(newChannel, initialMembership);
          logger.info("Default general channel provisioned.", {
            event: "channel.default_provisioned",
            outcome: "provisioned",
            actorId: userId,
            targetId: userId,
            workspaceId,
            channelId: newChannel.id,
            occurredAt: createdAt.toISOString()
          });
          return Object.freeze({ kind: "ready", channelId: newChannel.id });
        } catch (error: unknown) {
          if (isChannelStorageUnavailableError(error)) return Object.freeze({ kind: "unavailable" });
          if (!isChannelDuplicateKeyError(error) || error.constraint !== "active-name") throw error;
          channel = await repository.findByWorkspaceAndName(workspaceId, "general");
        }
      }
      if (!channel) return Object.freeze({ kind: "unavailable" });
      if (channel.visibility !== "public") {
        throw new Error(`Workspace ${workspaceId} has a private channel named general; automatic workspace membership cannot be provisioned.`);
      }
      const occurredAt = now();
      const result = await repository.joinPublicChannel(workspaceId, channel.id, userId, occurredAt);
      if (result.kind === "channel-unavailable") return Object.freeze({ kind: "unavailable" });
      if (result.kind === "not-public") {
        throw new Error(`Workspace ${workspaceId} has a non-public channel named general.`);
      }
      if (result.kind === "joined") {
        logger.info("Member joined the default general channel.", {
          event: "channel.member_joined",
          outcome: "joined",
          actorId: userId,
          targetId: userId,
          workspaceId,
          channelId: channel.id,
          occurredAt: occurredAt.toISOString()
        });
      }
      return Object.freeze({ kind: "ready", channelId: channel.id });
    } catch (error: unknown) {
      if (isChannelStorageUnavailableError(error)) return Object.freeze({ kind: "unavailable" });
      if (isChannelDuplicateKeyError(error)) {
        const channel = await repository.findByWorkspaceAndName(workspaceId, "general");
        const membership = channel
          ? await repository.findMembership(channel.id, userId)
          : null;
        if (channel && membership) return Object.freeze({ kind: "ready", channelId: channel.id });
      }
      throw error;
    }
  },
  leaveChannel: async (workspaceId: string, channelId: string, userId: string): Promise<LeaveChannelServiceResult> => {
    try {
      const occurredAt = now();
      const result = await repository.leaveChannel(workspaceId, channelId, userId);
      if (result.kind === "left") {
        logger.info("Member left a channel.", {
          event: "channel.member_left",
          outcome: "left",
          actorId: userId,
          targetId: userId,
          workspaceId,
          channelId,
          occurredAt: occurredAt.toISOString()
        });
      }
      return result;
    } catch (error: unknown) {
      if (isChannelStorageUnavailableError(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  },
  create: async (input: CreateChannelInput): Promise<CreateChannelServiceResult> => {
    const prepared = prepareCreateChannelCommand(input);
    if (!prepared.ok) return Object.freeze({ kind: "invalid", error: prepared.error });

    const { command } = prepared;
    const fingerprint = JSON.stringify([command.name, command.description, command.visibility]);
    const legacyFingerprint = JSON.stringify([command.name, command.visibility]);

    const replayRequest = async (request: ChannelCreationRequest): Promise<CreateChannelServiceResult> => {
      const matchesCurrentRequest = request.fingerprint === fingerprint
        || (command.description === null && request.fingerprint === legacyFingerprint);
      if (!matchesCurrentRequest) {
        return Object.freeze({ kind: "conflict", error: "idempotency_key_reused" });
      }
      const channel = await repository.findById(command.workspaceId, request.channelId);
      const creatorMembership = await repository.findMembership(request.channelId, command.creatorId);
      if (!channel || !creatorMembership || creatorMembership.role !== "admin") {
        throw new Error("Channel creation idempotency record references incomplete channel data.");
      }
      const result: CreateChannelResult = Object.freeze({
        channel,
        creatorMembership: Object.freeze({
          channelId: creatorMembership.channelId,
          userId: creatorMembership.userId,
          role: "admin",
          joinedAt: creatorMembership.joinedAt
        })
      });
      return Object.freeze({
        kind: "created",
        replayed: true,
        result
      });
    };

    if (input.idempotencyKey) {
      const existingRequest = await repository.findCreationRequest(command.workspaceId, command.creatorId, input.idempotencyKey);
      if (existingRequest) return replayRequest(existingRequest);
    }

    const timestamp = now();
    const channel: Channel = Object.freeze({
      id: createId(),
      workspaceId: command.workspaceId,
      name: command.name,
      description: command.description,
      visibility: command.visibility,
      lifecycleState: "active",
      createdBy: command.creatorId,
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null
    });
    const creatorMembership: ChannelMembership & Readonly<{ role: "admin" }> = Object.freeze({
      channelId: channel.id,
      userId: command.creatorId,
      role: "admin",
      joinedAt: timestamp
    });
    const request: ChannelCreationRequest | undefined = input.idempotencyKey
      ? Object.freeze({
        _id: createId(),
        workspaceId: command.workspaceId,
        actorId: command.creatorId,
        key: input.idempotencyKey,
        fingerprint,
        channelId: channel.id,
        createdAt: timestamp
      })
      : undefined;

    try {
      await repository.createAtomically(channel, creatorMembership, request);
    } catch (error: unknown) {
      if (isChannelStorageUnavailableError(error)) return Object.freeze({ kind: "unavailable" });
      if (!isChannelDuplicateKeyError(error)) throw error;
      if (request) {
        const concurrentRequest = await repository.findCreationRequest(command.workspaceId, command.creatorId, request.key);
        if (concurrentRequest) return replayRequest(concurrentRequest);
      }
      if (error.constraint === "active-name") {
        return Object.freeze({ kind: "conflict", error: "channel_name_conflict" });
      }
      if (error.constraint === "idempotency-key") {
        return Object.freeze({ kind: "conflict", error: "idempotency_key_reused" });
      }
      throw error;
    }

    logger.info("Channel created.", {
      event: "channel.created",
      outcome: "created",
      actorId: command.creatorId,
      targetId: command.creatorId,
      workspaceId: command.workspaceId,
      channelId: channel.id,
      occurredAt: timestamp.toISOString()
    });
    return Object.freeze({ kind: "created", replayed: false, result: Object.freeze({ channel, creatorMembership }) });
  }
});

export type ChannelService = ReturnType<typeof createChannelService>;
