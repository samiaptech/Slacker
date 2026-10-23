import type { IncomingHttpHeaders } from "node:http";
import type { RequestHandler } from "express";
import { z } from "zod";
import type { WorkspaceIdentity } from "../services/index.js";
import { HTTP_STATUS, ERROR_CODES, ERROR_MESSAGES } from "../../../constants/index.js";
import { createApplicationError } from "../../../errors/index.js";
import type { WorkspaceService } from "../services/index.js";

export type WorkspaceRealtimeNotifications = Readonly<{
  publishMembersChanged: (workspaceId: string) => void;
  revokeAccess: (workspaceId: string, userId: string) => void;
}>;

type WorkspaceControllerDependencies = Readonly<{
  getIdentity: (headers: IncomingHttpHeaders) => Promise<WorkspaceIdentity | null>;
  service: WorkspaceService;
  realtime?: WorkspaceRealtimeNotifications;
}>;

const workspaceNameSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
const workspaceSettingsSchema = z.object({ memberEmailsVisible: z.boolean() }).strict();
const workspaceMemberRoleSchema = z.object({ role: z.enum(["admin", "member"]) }).strict();

const workspaceIdFromRequest = (request: Parameters<RequestHandler>[0]): string | null => {
  const rawWorkspaceId = request.headers["x-workspace-id"];
  return typeof rawWorkspaceId === "string" ? rawWorkspaceId.trim() || null : null;
};

const sendWorkspaceDenied = (next: Parameters<RequestHandler>[2]): void => {
  next(createApplicationError({
    code: ERROR_CODES.workspaceAccessDenied,
    message: ERROR_MESSAGES.workspaceAccessDenied,
    status: HTTP_STATUS.forbidden
  }));
};

const sendUnauthenticated = (next: Parameters<RequestHandler>[2]): void => {
  next(createApplicationError({
    code: ERROR_CODES.unauthenticated,
    message: ERROR_MESSAGES.unauthenticated,
    status: HTTP_STATUS.unauthorized
  }));
};

const sendUnavailable = (next: Parameters<RequestHandler>[2]): void => {
  next(createApplicationError({
    code: ERROR_CODES.workspaceStorageUnavailable,
    message: ERROR_MESSAGES.workspaceStorageUnavailable,
    status: HTTP_STATUS.serviceUnavailable
  }));
};

const sendChannelUnavailable = (next: Parameters<RequestHandler>[2]): void => {
  next(createApplicationError({
    code: ERROR_CODES.channelStorageUnavailable,
    message: ERROR_MESSAGES.channelStorageUnavailable,
    status: HTTP_STATUS.serviceUnavailable
  }));
};

const sendMemberManagementError = (
  kind: "unauthenticated" | "denied" | "not-found" | "last-admin" | "unavailable",
  next: Parameters<RequestHandler>[2]
): void => {
  if (kind === "unauthenticated") {
    sendUnauthenticated(next);
    return;
  }
  if (kind === "denied") {
    sendWorkspaceDenied(next);
    return;
  }
  if (kind === "unavailable") {
    sendUnavailable(next);
    return;
  }
  if (kind === "last-admin") {
    next(createApplicationError({
      code: ERROR_CODES.workspaceMembershipConflict,
      message: ERROR_MESSAGES.workspaceMembershipConflict,
      status: HTTP_STATUS.conflict
    }));
    return;
  }
  next(createApplicationError({
    code: ERROR_CODES.routeNotFound,
    message: ERROR_MESSAGES.routeNotFound,
    status: HTTP_STATUS.notFound
  }));
};

export const createListWorkspacesController = ({ getIdentity, service }: WorkspaceControllerDependencies): RequestHandler =>
  async (request, response, next): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const identity = await getIdentity(request.headers);
      if (!identity) {
        sendUnauthenticated(next);
        return;
      }
      const result = await service.listForUser(identity.id);
      if (result.kind === "unavailable") {
        sendUnavailable(next);
        return;
      }
      response.status(HTTP_STATUS.ok).json({ workspaces: result.workspaces });
    } catch (error: unknown) {
      next(error);
    }
  };

export const createListWorkspaceMembersController = ({ getIdentity, service }: WorkspaceControllerDependencies): RequestHandler =>
  async (request, response, next): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const identity = await getIdentity(request.headers);
      if (!identity) {
        sendUnauthenticated(next);
        return;
      }
      const workspaceId = workspaceIdFromRequest(request);
      const result = await service.listMembers(identity, workspaceId);
      if (result.kind === "unavailable") {
        sendUnavailable(next);
        return;
      }
      if (result.kind === "unauthenticated") {
        sendUnauthenticated(next);
        return;
      }
      if (result.kind === "denied") {
        next(createApplicationError({
          code: ERROR_CODES.workspaceAccessDenied,
          message: ERROR_MESSAGES.workspaceAccessDenied,
          status: HTTP_STATUS.forbidden
        }));
        return;
      }
      response.status(HTTP_STATUS.ok).json({
        members: result.members.map((member) => ({
          ...member,
          joinedAt: member.joinedAt.toISOString()
        })),
        memberEmailsVisible: result.memberEmailsVisible
      });
    } catch (error: unknown) {
      next(error);
    }
  };

export const createWorkspaceMemberProfileController = ({ getIdentity, service }: WorkspaceControllerDependencies): RequestHandler =>
  async (request, response, next): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const identity = await getIdentity(request.headers);
      if (!identity) {
        sendUnauthenticated(next);
        return;
      }
      const workspaceId = workspaceIdFromRequest(request);
      const memberId = request.params.userId;
      if (typeof memberId !== "string" || !memberId) {
        next(createApplicationError({
          code: ERROR_CODES.routeNotFound,
          message: ERROR_MESSAGES.routeNotFound,
          status: HTTP_STATUS.notFound
        }));
        return;
      }
      const result = await service.getMemberProfile(identity, workspaceId, memberId);
      if (result.kind === "unavailable") {
        sendUnavailable(next);
        return;
      }
      if (result.kind === "unauthenticated") {
        sendUnauthenticated(next);
        return;
      }
      if (result.kind === "denied") {
        sendWorkspaceDenied(next);
        return;
      }
      if (result.kind === "not-found") {
        next(createApplicationError({
          code: ERROR_CODES.routeNotFound,
          message: ERROR_MESSAGES.routeNotFound,
          status: HTTP_STATUS.notFound
        }));
        return;
      }
      response.status(HTTP_STATUS.ok).json({
        member: { ...result.member, joinedAt: result.member.joinedAt.toISOString() }
      });
    } catch (error: unknown) {
      next(error);
    }
  };

export const createWorkspaceSettingsController = ({ getIdentity, service }: WorkspaceControllerDependencies): RequestHandler =>
  async (request, response, next): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const identity = await getIdentity(request.headers);
      if (!identity) {
        sendUnauthenticated(next);
        return;
      }
      const parsed = workspaceSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        next(createApplicationError({
          code: ERROR_CODES.validation,
          message: ERROR_MESSAGES.validation,
          status: HTTP_STATUS.badRequest
        }));
        return;
      }
      const result = await service.setMemberEmailsVisible(
        identity,
        typeof request.params.workspaceId === "string" ? request.params.workspaceId : null,
        parsed.data.memberEmailsVisible
      );
      if (result.kind === "unavailable") {
        sendUnavailable(next);
        return;
      }
      if (result.kind === "unauthenticated") {
        sendUnauthenticated(next);
        return;
      }
      if (result.kind === "denied") {
        sendWorkspaceDenied(next);
        return;
      }
      if (result.kind === "not-found") {
        next(createApplicationError({
          code: ERROR_CODES.routeNotFound,
          message: ERROR_MESSAGES.routeNotFound,
          status: HTTP_STATUS.notFound
        }));
        return;
      }
      response.status(HTTP_STATUS.ok).json({ memberEmailsVisible: result.memberEmailsVisible });
    } catch (error: unknown) {
      next(error);
    }
  };

export const createChangeWorkspaceMemberRoleController = (
  { getIdentity, service, realtime }: WorkspaceControllerDependencies
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const identity = await getIdentity(request.headers);
    if (!identity) {
      sendUnauthenticated(next);
      return;
    }
    const parsed = workspaceMemberRoleSchema.safeParse(request.body);
    const workspaceId = request.params.workspaceId;
    const memberId = request.params.userId;
    if (!parsed.success || typeof workspaceId !== "string" || !workspaceId || typeof memberId !== "string" || !memberId) {
      next(createApplicationError({
        code: ERROR_CODES.validation,
        message: ERROR_MESSAGES.validation,
        status: HTTP_STATUS.badRequest
      }));
      return;
    }
    const result = await service.changeMemberRole(identity, workspaceId, memberId, parsed.data.role);
    if (result.kind !== "updated") {
      sendMemberManagementError(result.kind, next);
      return;
    }
    realtime?.publishMembersChanged(workspaceId);
    response.status(HTTP_STATUS.ok).json({ userId: memberId, role: result.role });
  } catch (error: unknown) {
    next(error);
  }
};

export const createRemoveWorkspaceMemberController = (
  { getIdentity, service, realtime }: WorkspaceControllerDependencies
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const identity = await getIdentity(request.headers);
    if (!identity) {
      sendUnauthenticated(next);
      return;
    }
    const workspaceId = request.params.workspaceId;
    const memberId = request.params.userId;
    if (typeof workspaceId !== "string" || !workspaceId || typeof memberId !== "string" || !memberId) {
      next(createApplicationError({
        code: ERROR_CODES.validation,
        message: ERROR_MESSAGES.validation,
        status: HTTP_STATUS.badRequest
      }));
      return;
    }
    const result = await service.removeMember(identity, workspaceId, memberId);
    if (result.kind !== "removed") {
      sendMemberManagementError(result.kind, next);
      return;
    }
    realtime?.publishMembersChanged(workspaceId);
    realtime?.revokeAccess(workspaceId, memberId);
    response.status(HTTP_STATUS.noContent).end();
  } catch (error: unknown) {
    next(error);
  }
};

export const createWorkspaceController = ({ getIdentity, service }: WorkspaceControllerDependencies): RequestHandler =>
  async (request, response, next): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const identity = await getIdentity(request.headers);
      if (!identity) {
        sendUnauthenticated(next);
        return;
      }
      const { name } = workspaceNameSchema.parse(request.body);
      const result = await service.create(identity, name);
      if (result.kind === "channel-unavailable") {
        sendChannelUnavailable(next);
        return;
      }
      if (result.kind === "unavailable") {
        sendUnavailable(next);
        return;
      }
      if (result.kind === "invalid") {
        next(createApplicationError({
          code: ERROR_CODES.validation,
          message: ERROR_MESSAGES.validation,
          status: HTTP_STATUS.badRequest
        }));
        return;
      }
      if (result.kind === "unauthenticated") {
        sendUnauthenticated(next);
        return;
      }
      response.status(HTTP_STATUS.created).json({ workspace: result.workspace });
    } catch (error: unknown) {
      next(error);
    }
  };

export const createWorkspaceInviteLinkController = ({ getIdentity, service }: WorkspaceControllerDependencies): RequestHandler =>
  async (request, response, next): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const identity = await getIdentity(request.headers);
      if (!identity) {
        sendUnauthenticated(next);
        return;
      }
      const workspaceId = request.params.workspaceId;
      if (typeof workspaceId !== "string" || workspaceId.length === 0) {
        next(createApplicationError({
          code: ERROR_CODES.routeNotFound,
          message: ERROR_MESSAGES.routeNotFound,
          status: HTTP_STATUS.notFound
        }));
        return;
      }
      const result = await service.createInviteLink(identity, workspaceId);
      if (result.kind === "unavailable") {
        sendUnavailable(next);
        return;
      }
      if (result.kind === "unauthenticated") {
        sendUnauthenticated(next);
        return;
      }
      if (result.kind === "denied") {
        next(createApplicationError({
          code: ERROR_CODES.routeNotFound,
          message: ERROR_MESSAGES.routeNotFound,
          status: HTTP_STATUS.notFound
        }));
        return;
      }
      response.status(HTTP_STATUS.created).json({
        inviteUrl: result.url,
        expiresAt: result.expiresAt.toISOString()
      });
    } catch (error: unknown) {
      next(error);
    }
  };

export const createAcceptWorkspaceInviteController = ({
  getIdentity,
  service,
  realtime
}: WorkspaceControllerDependencies): RequestHandler =>
  async (request, response, next): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const identity = await getIdentity(request.headers);
      if (!identity) {
        sendUnauthenticated(next);
        return;
      }
      const token = request.params.token;
      if (typeof token !== "string" || token.length === 0) {
        next(createApplicationError({
          code: ERROR_CODES.routeNotFound,
          message: ERROR_MESSAGES.routeNotFound,
          status: HTTP_STATUS.notFound
        }));
        return;
      }
      const result = await service.acceptInvite(identity, token);
      if (result.kind === "channel-unavailable") {
        sendChannelUnavailable(next);
        return;
      }
      if (result.kind === "unavailable") {
        sendUnavailable(next);
        return;
      }
      if (result.kind === "unauthenticated") {
        sendUnauthenticated(next);
        return;
      }
      if (result.kind === "not-found") {
        next(createApplicationError({
          code: ERROR_CODES.routeNotFound,
          message: ERROR_MESSAGES.routeNotFound,
          status: HTTP_STATUS.notFound
        }));
        return;
      }
      if (result.kind === "joined") realtime?.publishMembersChanged(result.workspace.id);
      response.status(HTTP_STATUS.ok).json({
        workspace: result.workspace,
        alreadyMember: result.kind === "already-member"
      });
    } catch (error: unknown) {
      next(error);
    }
  };

export const createWorkspaceAccessController = ({ getIdentity, service }: WorkspaceControllerDependencies): RequestHandler =>
  async (request, response, next): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const identity = await getIdentity(request.headers);
      if (!identity) {
        sendUnauthenticated(next);
        return;
      }
      const rawWorkspaceId = request.headers["x-workspace-id"];
      const workspaceId = typeof rawWorkspaceId === "string" ? rawWorkspaceId.trim() : null;
      const result = await service.getAccess(identity, workspaceId);
      if (result.kind === "unavailable") {
        sendUnavailable(next);
        return;
      }
      if (result.kind === "unauthenticated") {
        sendUnauthenticated(next);
        return;
      }
      if (result.kind === "denied") {
        next(createApplicationError({
          code: ERROR_CODES.workspaceAccessDenied,
          message: ERROR_MESSAGES.workspaceAccessDenied,
          status: HTTP_STATUS.forbidden
        }));
        return;
      }
      response.status(HTTP_STATUS.ok).json({
        workspace: {
          id: result.access.workspace.id,
          name: result.access.workspace.name
        },
        user: { ...result.access.user, title: result.access.user.title ?? null }
      });
    } catch (error: unknown) {
      next(error);
    }
  };
