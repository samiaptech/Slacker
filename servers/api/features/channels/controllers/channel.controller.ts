import type { IncomingHttpHeaders } from "node:http";
import type { RequestHandler } from "express";
import type {
  ChannelCreateResponse,
  ChannelListResponse,
  ChannelMemberMutationResponse,
  ChannelMembersResponse,
  ChannelMembershipResponse,
  ChannelResponse
} from "@workspace/types";
import { z } from "zod";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../../../constants/index.js";
import { createApplicationError } from "../../../errors/index.js";
import {
  CHANNEL_PAGE_SIZE_DEFAULT,
  CHANNEL_PAGE_SIZE_MAX,
  decodeChannelListCursor,
  type ChannelListQuery
} from "../domain/index.js";
import type {
  ChannelService,
  CreateChannelServiceResult,
  InviteChannelMemberServiceResult,
  JoinChannelServiceResult,
  LeaveChannelServiceResult,
  RemoveChannelMemberServiceResult,
  UpdateChannelServiceResult
} from "../services/index.js";
import type { ChannelRealtimePublisher } from "../realtime/index.js";
import { isNotificationStorageUnavailable, type NotificationService } from "../../notifications/public/index.js";

export type ChannelWorkspaceIdentity = Readonly<{ id: string; name: string; email: string; image: string | null }>;
export type ChannelWorkspaceAccessResult =
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "allowed"; access: Readonly<{ workspace: Readonly<{ id: string; name: string; role: "admin" | "member" }>; user: ChannelWorkspaceIdentity }> }>;
export type ChannelMemberEmailVisibilityResult =
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "allowed"; visible: boolean }>;

const requestSchema = z.object({
  name: z.string(),
  description: z.string().trim().max(500).optional(),
  visibility: z.enum(["public", "private"])
}).strict();

const idempotencyKeySchema = z.string().trim().min(1).max(128);
const normalizeNotificationFailure = (error: unknown): unknown =>
  isNotificationStorageUnavailable(error)
    ? createApplicationError({
      code: ERROR_CODES.internal,
      message: "Notifications are temporarily unavailable.",
      status: HTTP_STATUS.serviceUnavailable
    })
    : error;

export type ChannelAccessDependencies = Readonly<{
  getIdentity: (headers: IncomingHttpHeaders) => Promise<ChannelWorkspaceIdentity | null>;
  getWorkspaceAccess: (identity: ChannelWorkspaceIdentity | null, workspaceId: string | null) => Promise<ChannelWorkspaceAccessResult>;
}>;

type CreateChannelControllerDependencies = ChannelAccessDependencies & Readonly<{
  createChannel: ChannelService["create"];
  realtime?: Pick<ChannelRealtimePublisher, "publishChannelListChanged">;
}>;

type GetChannelControllerDependencies = ChannelAccessDependencies & Readonly<{
  getChannelForMember: ChannelService["getForMember"];
}>;

type ListChannelsControllerDependencies = ChannelAccessDependencies & Readonly<{
  listChannels: ChannelService["listChannels"];
}>;
type UpdateChannelControllerDependencies = ChannelAccessDependencies & Readonly<{
  updateChannel?: ChannelService["update"];
  realtime?: Pick<ChannelRealtimePublisher, "publishChannelListChanged">;
  notifications?: Pick<NotificationService, "notifyChannelActivity">;
}>;

type ChangeMembershipControllerDependencies = ChannelAccessDependencies & Readonly<{
  changeMembership: (workspaceId: string, channelId: string, userId: string, actorName: string) => Promise<
    JoinChannelServiceResult | LeaveChannelServiceResult
  >;
  realtime?: MembershipRealtimePublisher;
  notifications?: Pick<NotificationService, "notifyChannelActivity">;
}>;
type MembershipRealtimePublisher = Pick<ChannelRealtimePublisher,
  "publishChannelListChanged" | "publishMembersChanged" | "revokeChannelAccess" | "publishSystemEntry">;

type ChannelMemberControllerDependencies = ChannelAccessDependencies & Readonly<{
  listMembers: ChannelService["listMembers"];
  inviteMember: ChannelService["inviteMember"];
  removeMember: ChannelService["removeMember"];
  realtime?: MembershipRealtimePublisher;
  notifications?: Pick<NotificationService, "notifyChannelActivity">;
}>;

const channelListQuerySchema = z.object({
  scope: z.enum(["joined", "discoverable"]).default("joined"),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(CHANNEL_PAGE_SIZE_MAX).default(CHANNEL_PAGE_SIZE_DEFAULT)
}).strict();

const inviteMemberSchema = z.object({
  email: z.string().trim().pipe(z.email().max(254)).transform((email) => email.toLowerCase())
}).strict();
const updateChannelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().default(null),
  visibility: z.enum(["public", "private"])
}).strict();

export const createUpdateChannelController = (
  { getIdentity, getWorkspaceAccess, updateChannel, realtime, notifications }: UpdateChannelControllerDependencies
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const access = await resolveChannelMemberAccess(request, getIdentity, getWorkspaceAccess);
    if (access.kind !== "allowed") {
      sendChannelAccessError(access, next);
      return;
    }
    const channelId = request.params.channelId;
    const parsed = updateChannelSchema.safeParse(request.body);
    if (typeof channelId !== "string" || !channelId || !parsed.success) {
      next(createApplicationError({
        code: ERROR_CODES.validation,
        message: ERROR_MESSAGES.validation,
        status: HTTP_STATUS.badRequest
      }));
      return;
    }
    const result: UpdateChannelServiceResult = updateChannel
      ? await updateChannel(
        access.access.workspace.id,
        channelId,
        access.access.user.id,
        {
          name: parsed.data.name,
          description: parsed.data.description ?? "",
          visibility: parsed.data.visibility
        }
      )
      : Object.freeze({ kind: "unavailable" as const });
    switch (result.kind) {
      case "unavailable":
        next(createApplicationError({
          code: ERROR_CODES.channelStorageUnavailable,
          message: ERROR_MESSAGES.channelStorageUnavailable,
          status: HTTP_STATUS.serviceUnavailable
        }));
        return;
      case "channel-unavailable":
        next(createApplicationError({
          code: ERROR_CODES.routeNotFound,
          message: ERROR_MESSAGES.channelUnavailable,
          status: HTTP_STATUS.notFound
        }));
        return;
      case "not-manager":
        next(createApplicationError({
          code: ERROR_CODES.channelMembershipConflict,
          message: ERROR_MESSAGES.channelMembershipConflict,
          status: HTTP_STATUS.forbidden
        }));
        return;
      case "conflict":
        next(createApplicationError({
          code: ERROR_CODES.channelNameConflict,
          message: ERROR_MESSAGES.channelNameConflict,
          status: HTTP_STATUS.conflict
        }));
        return;
      case "invalid":
        next(createApplicationError({
          code: ERROR_CODES.validation,
          message: ERROR_MESSAGES.validation,
          status: HTTP_STATUS.badRequest,
          details: { field: "channel", reason: result.error }
        }));
        return;
      case "updated": {
        const channel = result.channel;
        realtime?.publishChannelListChanged(access.access.workspace.id);
        await notifications?.notifyChannelActivity({
          workspaceId: access.access.workspace.id,
          channelId,
          type: "channel_updated",
          actor: { id: access.access.user.id, name: access.access.user.name },
          createdAt: channel.updatedAt
        });
        const body: ChannelResponse = {
          id: channel.id,
          workspaceId: channel.workspaceId,
          name: channel.name,
          description: channel.description,
          visibility: channel.visibility,
          lifecycleState: channel.lifecycleState,
          createdBy: channel.createdBy,
          createdAt: channel.createdAt.toISOString(),
          updatedAt: channel.updatedAt.toISOString(),
          archivedAt: channel.archivedAt?.toISOString() ?? null
        };
        response.status(HTTP_STATUS.ok).json({ channel: body });
        return;
      }
      default:
        return;
    }
  } catch (error: unknown) {
    next(normalizeNotificationFailure(error));
  }
};

const toResponse = (result: Extract<CreateChannelServiceResult, { kind: "created" }>): ChannelCreateResponse => ({
  channel: {
    id: result.result.channel.id,
    workspaceId: result.result.channel.workspaceId,
    name: result.result.channel.name,
    description: result.result.channel.description,
    visibility: result.result.channel.visibility,
    lifecycleState: result.result.channel.lifecycleState,
    createdBy: result.result.channel.createdBy,
    createdAt: result.result.channel.createdAt.toISOString(),
    updatedAt: result.result.channel.updatedAt.toISOString(),
    archivedAt: result.result.channel.archivedAt?.toISOString() ?? null
  },
  creatorMembership: {
    channelId: result.result.creatorMembership.channelId,
    userId: result.result.creatorMembership.userId,
    role: "admin",
    joinedAt: result.result.creatorMembership.joinedAt.toISOString()
  }
});

const createResultError = (result: Exclude<CreateChannelServiceResult, { kind: "created" }>) => {
  if (result.kind === "unavailable") {
    return createApplicationError({
      code: ERROR_CODES.channelStorageUnavailable,
      message: ERROR_MESSAGES.channelStorageUnavailable,
      status: HTTP_STATUS.serviceUnavailable
    });
  }
  if (result.kind === "conflict") {
    const idempotencyConflict = result.error === "idempotency_key_reused";
    return createApplicationError({
      code: idempotencyConflict ? ERROR_CODES.idempotencyKeyReused : ERROR_CODES.channelNameConflict,
      message: idempotencyConflict ? ERROR_MESSAGES.idempotencyKeyReused : ERROR_MESSAGES.channelNameConflict,
      status: HTTP_STATUS.conflict
    });
  }
  return createApplicationError({
    code: ERROR_CODES.validation,
    message: ERROR_MESSAGES.validation,
    status: HTTP_STATUS.badRequest,
    details: {
      field: result.error.startsWith("channel_name_")
        ? "name"
        : result.error.startsWith("channel_description_")
          ? "description"
          : result.error === "channel_visibility_invalid"
            ? "visibility"
            : "workspace",
      reason: result.error
    }
  });
};

const toChannelResponse = (channel: NonNullable<Awaited<ReturnType<ChannelService["getForMember"]>>>): ChannelResponse => ({
  id: channel.id,
  workspaceId: channel.workspaceId,
  name: channel.name,
  description: channel.description,
  visibility: channel.visibility,
  lifecycleState: channel.lifecycleState,
  createdBy: channel.createdBy,
  createdAt: channel.createdAt.toISOString(),
  updatedAt: channel.updatedAt.toISOString(),
  archivedAt: channel.archivedAt?.toISOString() ?? null
});

export const createChannelController = ({
  getIdentity,
  getWorkspaceAccess,
  createChannel,
  realtime
}: CreateChannelControllerDependencies): RequestHandler =>
  async (request, response, next): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const workspaceAccess = await resolveChannelMemberAccess(request, getIdentity, getWorkspaceAccess);
      if (workspaceAccess.kind !== "allowed") {
        sendChannelAccessError(workspaceAccess, next);
        return;
      }

      const body = requestSchema.parse(request.body);
      const rawIdempotencyKey = request.headers["idempotency-key"];
      if (Array.isArray(rawIdempotencyKey)) {
        next(createApplicationError({
          code: ERROR_CODES.validation,
          message: ERROR_MESSAGES.validation,
          status: HTTP_STATUS.badRequest,
          details: { field: "Idempotency-Key", reason: "must contain exactly one value" }
        }));
        return;
      }
      const idempotencyKey = rawIdempotencyKey === undefined ? undefined : idempotencyKeySchema.parse(rawIdempotencyKey);
      const result = await createChannel({
        workspaceId: workspaceAccess.access.workspace.id,
        creatorId: workspaceAccess.access.user.id,
        name: body.name,
        visibility: body.visibility,
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(idempotencyKey === undefined ? {} : { idempotencyKey })
      });
      if (result.kind !== "created") {
        next(createResultError(result));
        return;
      }
      realtime?.publishChannelListChanged(workspaceAccess.access.workspace.id);
      response.status(HTTP_STATUS.created).json(toResponse(result));
    } catch (error: unknown) {
      next(normalizeNotificationFailure(error));
    }
  };

export const createListChannelsController = ({ getIdentity, getWorkspaceAccess, listChannels }: ListChannelsControllerDependencies): RequestHandler =>
  async (request, response, next): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const workspaceAccess = await resolveChannelMemberAccess(request, getIdentity, getWorkspaceAccess);
      if (workspaceAccess.kind !== "allowed") {
        sendChannelAccessError(workspaceAccess, next);
        return;
      }

      const parsedQuery = channelListQuerySchema.parse(request.query);
      const cursorResult = parsedQuery.cursor === undefined
        ? null
        : decodeChannelListCursor(parsedQuery.cursor, parsedQuery.scope);
      if (cursorResult && !cursorResult.ok) {
        next(createApplicationError({
          code: ERROR_CODES.validation,
          message: ERROR_MESSAGES.validation,
          status: HTTP_STATUS.badRequest,
          details: { field: "cursor", reason: "invalid_cursor" }
        }));
        return;
      }
      const query: ChannelListQuery = Object.freeze({
        scope: parsedQuery.scope,
        pageSize: parsedQuery.limit,
        cursor: cursorResult?.ok ? cursorResult.cursor : null
      });
      const page = await listChannels(
        workspaceAccess.access.workspace.id,
        workspaceAccess.access.user.id,
        query
      );
      const result: ChannelListResponse = {
        channels: page.channels.map(toChannelResponse),
        nextCursor: page.nextCursor
      };
      response.status(HTTP_STATUS.ok).json(result);
    } catch (error: unknown) {
      next(normalizeNotificationFailure(error));
    }
  };

export const createGetChannelController = ({ getIdentity, getWorkspaceAccess, getChannelForMember }: GetChannelControllerDependencies): RequestHandler =>
  async (request, response, next): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const workspaceAccess = await resolveChannelMemberAccess(request, getIdentity, getWorkspaceAccess);
      if (workspaceAccess.kind !== "allowed") {
        sendChannelAccessError(workspaceAccess, next);
        return;
      }

      const channelId = request.params.channelId;
      if (typeof channelId !== "string") {
        next(createApplicationError({
          code: ERROR_CODES.routeNotFound,
          message: ERROR_MESSAGES.channelUnavailable,
          status: HTTP_STATUS.notFound
        }));
        return;
      }
      const channel = await getChannelForMember(
        workspaceAccess.access.workspace.id,
        channelId,
        workspaceAccess.access.user.id
      );
      if (!channel) {
        next(createApplicationError({
          code: ERROR_CODES.routeNotFound,
          message: ERROR_MESSAGES.channelUnavailable,
          status: HTTP_STATUS.notFound
        }));
        return;
      }
      response.status(HTTP_STATUS.ok).json(toChannelResponse(channel));
    } catch (error: unknown) {
      next(normalizeNotificationFailure(error));
    }
  };

export const resolveChannelMemberAccess = async (
  request: Parameters<RequestHandler>[0],
  getIdentity: ChannelAccessDependencies["getIdentity"],
  getWorkspaceAccess: ChannelAccessDependencies["getWorkspaceAccess"]
): Promise<ChannelWorkspaceAccessResult> => {
  const rawWorkspaceId = request.headers["x-workspace-id"];
  const workspaceId = typeof rawWorkspaceId === "string" ? rawWorkspaceId.trim() : null;
  return getWorkspaceAccess(await getIdentity(request.headers), workspaceId);
};

export const sendChannelAccessError = (
  access: Exclude<ChannelWorkspaceAccessResult, { kind: "allowed" }>,
  next: Parameters<RequestHandler>[2]
): void => {
  const unauthenticated = access.kind === "unauthenticated";
  if (access.kind === "unavailable") {
    next(createApplicationError({
      code: ERROR_CODES.workspaceStorageUnavailable,
      message: ERROR_MESSAGES.workspaceStorageUnavailable,
      status: HTTP_STATUS.serviceUnavailable
    }));
    return;
  }
  next(createApplicationError({
    code: unauthenticated ? ERROR_CODES.unauthenticated : ERROR_CODES.workspaceAccessDenied,
    message: unauthenticated ? ERROR_MESSAGES.unauthenticated : ERROR_MESSAGES.workspaceAccessDenied,
    status: unauthenticated ? HTTP_STATUS.unauthorized : HTTP_STATUS.forbidden
  }));
};

const membershipResultError = (
  result: Exclude<JoinChannelServiceResult | LeaveChannelServiceResult,
    { kind: "joined" } | { kind: "already-joined" } | { kind: "left" } | { kind: "already-left" }>
) => {
  if (result.kind === "unavailable") {
    return createApplicationError({
      code: ERROR_CODES.channelStorageUnavailable,
      message: ERROR_MESSAGES.channelStorageUnavailable,
      status: HTTP_STATUS.serviceUnavailable
    });
  }
  if (result.kind === "not-public") {
    return createApplicationError({
      code: ERROR_CODES.channelJoinNotAllowed,
      message: ERROR_MESSAGES.channelJoinNotAllowed,
      status: HTTP_STATUS.forbidden
    });
  }
  return createApplicationError({
    code: ERROR_CODES.routeNotFound,
    message: ERROR_MESSAGES.channelUnavailable,
    status: HTTP_STATUS.notFound
  });
};

const channelMemberMutationError = (
  result: Exclude<InviteChannelMemberServiceResult | RemoveChannelMemberServiceResult,
    { kind: "added" } | { kind: "already-member" } | { kind: "removed" } | { kind: "already-absent" }>
) => {
  if (result.kind === "workspace-unavailable") {
    return createApplicationError({
      code: ERROR_CODES.workspaceStorageUnavailable,
      message: ERROR_MESSAGES.workspaceStorageUnavailable,
      status: HTTP_STATUS.serviceUnavailable
    });
  }
  if (result.kind === "unavailable") {
    return createApplicationError({
      code: ERROR_CODES.channelStorageUnavailable,
      message: ERROR_MESSAGES.channelStorageUnavailable,
      status: HTTP_STATUS.serviceUnavailable
    });
  }
  if (result.kind === "protected-admin") {
    return createApplicationError({
      code: ERROR_CODES.channelMembershipConflict,
      message: ERROR_MESSAGES.channelMembershipConflict,
      status: HTTP_STATUS.conflict
    });
  }
  return createApplicationError({
    code: ERROR_CODES.routeNotFound,
    message: ERROR_MESSAGES.channelUnavailable,
    status: HTTP_STATUS.notFound
  });
};

export const createListChannelMembersController = (
  {
    getIdentity,
    getWorkspaceAccess,
    getMemberEmailVisibility,
    listMembers
  }: ChannelAccessDependencies & Readonly<{
    getMemberEmailVisibility: (
      identity: ChannelWorkspaceIdentity | null,
      workspaceId: string | null
    ) => Promise<ChannelMemberEmailVisibilityResult>;
  }> & Pick<ChannelMemberControllerDependencies, "listMembers">
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const workspaceAccess = await resolveChannelMemberAccess(request, getIdentity, getWorkspaceAccess);
    if (workspaceAccess.kind !== "allowed") {
      sendChannelAccessError(workspaceAccess, next);
      return;
    }
    const channelId = request.params.channelId;
    if (typeof channelId !== "string" || channelId.length === 0) {
      next(createApplicationError({
        code: ERROR_CODES.routeNotFound,
        message: ERROR_MESSAGES.channelUnavailable,
        status: HTTP_STATUS.notFound
      }));
      return;
    }
    const result = await listMembers(
      workspaceAccess.access.workspace.id,
      channelId,
      workspaceAccess.access.user.id
    );
    if (result.kind !== "listed") {
      next(result.kind === "unavailable"
        ? createApplicationError({
          code: ERROR_CODES.channelStorageUnavailable,
          message: ERROR_MESSAGES.channelStorageUnavailable,
          status: HTTP_STATUS.serviceUnavailable
        })
        : membershipResultError({ kind: "channel-unavailable" }));
      return;
    }
    const emailVisibility = await getMemberEmailVisibility(
      workspaceAccess.access.user,
      workspaceAccess.access.workspace.id
    );
    if (emailVisibility.kind !== "allowed") {
      sendChannelAccessError(emailVisibility, next);
      return;
    }
    const body: ChannelMembersResponse = {
      canManage: result.canManage,
      members: result.members.map((member) => ({
        channelId: member.channelId,
        userId: member.userId,
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
        name: member.name,
        email: emailVisibility.visible ? member.email : null,
        image: member.image
      }))
    };
    response.status(HTTP_STATUS.ok).json(body);
  } catch (error: unknown) {
    next(normalizeNotificationFailure(error));
  }
};

export const createInviteChannelMemberController = (
  {
    getIdentity,
    getWorkspaceAccess,
    inviteMember,
    realtime,
    notifications
  }: ChannelAccessDependencies & Pick<ChannelMemberControllerDependencies, "inviteMember" | "realtime" | "notifications">
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const workspaceAccess = await resolveChannelMemberAccess(request, getIdentity, getWorkspaceAccess);
    if (workspaceAccess.kind !== "allowed") {
      sendChannelAccessError(workspaceAccess, next);
      return;
    }
    const channelId = request.params.channelId;
    if (typeof channelId !== "string" || channelId.length === 0) {
      next(createApplicationError({
        code: ERROR_CODES.routeNotFound,
        message: ERROR_MESSAGES.channelUnavailable,
        status: HTTP_STATUS.notFound
      }));
      return;
    }
    const { email } = inviteMemberSchema.parse(request.body);
    const result = await inviteMember(
      workspaceAccess.access.workspace.id,
      channelId,
      workspaceAccess.access.user.id,
      email
    );
    if (result.kind !== "added" && result.kind !== "already-member") {
      next(channelMemberMutationError(result));
      return;
    }
    const body: ChannelMemberMutationResponse = {
      membership: {
        channelId: result.membership.channelId,
        userId: result.membership.userId,
        role: result.membership.role,
        joinedAt: result.membership.joinedAt.toISOString()
      },
      alreadyMember: result.kind === "already-member"
    };
    if (result.kind === "added") {
      realtime?.publishChannelListChanged(workspaceAccess.access.workspace.id);
      realtime?.publishMembersChanged(workspaceAccess.access.workspace.id, channelId);
      await notifications?.notifyChannelActivity({
        workspaceId: workspaceAccess.access.workspace.id,
        channelId,
        type: "channel_member_joined",
        actor: { id: workspaceAccess.access.user.id, name: workspaceAccess.access.user.name },
        eventId: `joined:${channelId}:${result.membership.userId}:${result.membership.joinedAt.toISOString()}`,
        createdAt: result.membership.joinedAt
      });
    }
    response.status(HTTP_STATUS.ok).json(body);
  } catch (error: unknown) {
    next(normalizeNotificationFailure(error));
  }
};

export const createRemoveChannelMemberController = (
  {
    getIdentity,
    getWorkspaceAccess,
    removeMember,
    realtime,
    notifications
  }: ChannelAccessDependencies & Pick<ChannelMemberControllerDependencies, "removeMember" | "realtime" | "notifications">
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const workspaceAccess = await resolveChannelMemberAccess(request, getIdentity, getWorkspaceAccess);
    if (workspaceAccess.kind !== "allowed") {
      sendChannelAccessError(workspaceAccess, next);
      return;
    }
    const { channelId, userId } = request.params;
    if (typeof channelId !== "string" || channelId.length === 0
      || typeof userId !== "string" || userId.length === 0) {
      next(createApplicationError({
        code: ERROR_CODES.routeNotFound,
        message: ERROR_MESSAGES.channelUnavailable,
        status: HTTP_STATUS.notFound
      }));
      return;
    }
    const result = await removeMember(
      workspaceAccess.access.workspace.id,
      channelId,
      workspaceAccess.access.user.id,
      userId
    );
    if (result.kind !== "removed" && result.kind !== "already-absent") {
      next(channelMemberMutationError(result));
      return;
    }
    if (result.kind === "removed") {
      realtime?.publishChannelListChanged(workspaceAccess.access.workspace.id);
      realtime?.publishMembersChanged(workspaceAccess.access.workspace.id, channelId);
      realtime?.revokeChannelAccess(workspaceAccess.access.workspace.id, channelId, userId);
      await notifications?.notifyChannelActivity({
        workspaceId: workspaceAccess.access.workspace.id,
        channelId,
        type: "channel_member_left",
        actor: { id: workspaceAccess.access.user.id, name: workspaceAccess.access.user.name }
      });
    }
    response.status(HTTP_STATUS.noContent).end();
  } catch (error: unknown) {
    next(normalizeNotificationFailure(error));
  }
};

const createChangeMembershipController = (
  { getIdentity, getWorkspaceAccess, changeMembership, realtime, notifications }: ChangeMembershipControllerDependencies,
  method: "join" | "leave"
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const workspaceAccess = await resolveChannelMemberAccess(request, getIdentity, getWorkspaceAccess);
    if (workspaceAccess.kind !== "allowed") {
      sendChannelAccessError(workspaceAccess, next);
      return;
    }
    const channelId = request.params.channelId;
    if (typeof channelId !== "string" || channelId.length === 0) {
      next(createApplicationError({
        code: ERROR_CODES.routeNotFound,
        message: ERROR_MESSAGES.channelUnavailable,
        status: HTTP_STATUS.notFound
      }));
      return;
    }
    const result = await changeMembership(
      workspaceAccess.access.workspace.id,
      channelId,
      workspaceAccess.access.user.id,
      workspaceAccess.access.user.name
    );
    if (result.kind === "unavailable" || result.kind === "not-public" || result.kind === "channel-unavailable") {
      next(membershipResultError(result));
      return;
    }
    if (method === "leave") {
      if (result.kind === "left") {
        realtime?.publishChannelListChanged(workspaceAccess.access.workspace.id);
        realtime?.publishMembersChanged(workspaceAccess.access.workspace.id, channelId);
        realtime?.revokeChannelAccess(
          workspaceAccess.access.workspace.id,
          channelId,
          workspaceAccess.access.user.id
        );
        realtime?.publishSystemEntry?.(workspaceAccess.access.workspace.id, result.entry);
        await notifications?.notifyChannelActivity({
          workspaceId: workspaceAccess.access.workspace.id,
          channelId,
          type: "channel_member_left",
          actor: { id: workspaceAccess.access.user.id, name: workspaceAccess.access.user.name },
          eventId: result.entry.id,
          createdAt: result.entry.createdAt
        });
      }
      response.status(HTTP_STATUS.noContent).end();
      return;
    }
    if (result.kind !== "joined" && result.kind !== "already-joined") {
      next(createApplicationError({
        code: ERROR_CODES.internal,
        message: ERROR_MESSAGES.internal,
        status: HTTP_STATUS.internalServerError
      }));
      return;
    }
    const membership: ChannelMembershipResponse = {
      channelId: result.membership.channelId,
      userId: result.membership.userId,
      role: result.membership.role,
      joinedAt: result.membership.joinedAt.toISOString()
    };
    if (result.kind === "joined") {
      realtime?.publishChannelListChanged(workspaceAccess.access.workspace.id);
      realtime?.publishMembersChanged(workspaceAccess.access.workspace.id, channelId);
      await notifications?.notifyChannelActivity({
        workspaceId: workspaceAccess.access.workspace.id,
        channelId,
        type: "channel_member_joined",
        actor: { id: workspaceAccess.access.user.id, name: workspaceAccess.access.user.name },
        eventId: `joined:${channelId}:${result.membership.userId}:${result.membership.joinedAt.toISOString()}`,
        createdAt: result.membership.joinedAt
      });
    }
    response.status(HTTP_STATUS.ok).json({ membership });
  } catch (error: unknown) {
    next(normalizeNotificationFailure(error));
  }
};

export const createJoinChannelController = (dependencies: ChannelAccessDependencies & Readonly<{
  joinPublicChannel: ChannelService["joinPublicChannel"];
  realtime?: MembershipRealtimePublisher;
  notifications?: Pick<NotificationService, "notifyChannelActivity">;
}>): RequestHandler => {
  const { joinPublicChannel, realtime, notifications, ...accessDependencies } = dependencies;
  return createChangeMembershipController({
    ...accessDependencies,
    changeMembership: joinPublicChannel,
    ...(realtime ? { realtime } : {}),
    ...(notifications ? { notifications } : {})
  }, "join");
};

export const createLeaveChannelController = (dependencies: ChannelAccessDependencies & Readonly<{
  leaveChannel: ChannelService["leaveChannel"];
  realtime?: MembershipRealtimePublisher;
  notifications?: Pick<NotificationService, "notifyChannelActivity">;
}>): RequestHandler => {
  const { leaveChannel, realtime, notifications, ...accessDependencies } = dependencies;
  return createChangeMembershipController({
    ...accessDependencies,
    changeMembership: leaveChannel,
    ...(realtime ? { realtime } : {}),
    ...(notifications ? { notifications } : {})
  }, "leave");
};
