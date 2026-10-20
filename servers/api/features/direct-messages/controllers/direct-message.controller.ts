import type { IncomingHttpHeaders } from "node:http";
import type { RequestHandler } from "express";
import type {
  DirectConversationListResponse,
  DirectConversationResponse,
  DirectMessageListResponse,
  DirectMessageResponse
} from "@workspace/types";
import { z } from "zod";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../../../constants/index.js";
import { createApplicationError } from "../../../errors/index.js";
import {
  decodeDirectMessageCursor,
  DIRECT_CONVERSATION_LIST_LIMIT,
  DIRECT_MESSAGE_MAX_LENGTH,
  DIRECT_MESSAGE_PAGE_SIZE_DEFAULT,
  DIRECT_MESSAGE_PAGE_SIZE_MAX
} from "../domain/index.js";
import type { DirectConversationWithParticipant, DirectMessageService, DirectMessageWithSender } from "../services/index.js";

type DirectMessageIdentity = Readonly<{ id: string; name: string; email: string; image: string | null }>;
type DirectWorkspaceAccessResult =
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "allowed"; access: Readonly<{ workspace: Readonly<{ id: string }> }> }>;
type DirectMessageRealtime = Readonly<{
  publishDirectMessage: (workspaceId: string, conversationId: string, message: DirectMessageResponse) => void;
  publishConversationChanged: (workspaceId: string) => void;
}>;
type ControllerDependencies = Readonly<{
  getIdentity: (headers: IncomingHttpHeaders) => Promise<DirectMessageIdentity | null>;
  getWorkspaceAccess: (
    identity: DirectMessageIdentity | null,
    workspaceId: string | null
  ) => Promise<DirectWorkspaceAccessResult>;
  service: DirectMessageService;
  realtime?: DirectMessageRealtime;
}>;

type RequestAccessResult =
  | Readonly<{ kind: "allowed"; workspaceId: string; userId: string }>
  | Readonly<{ kind: "unauthenticated" | "denied" | "unavailable" }>;

const openBodySchema = z.object({ recipientId: z.string().trim().min(1).max(128) }).strict();
const messageBodySchema = z.object({
  text: z.string()
    .refine((text) => Array.from(text).length <= DIRECT_MESSAGE_MAX_LENGTH)
    .refine((text) => text.trim().length > 0)
}).strict();
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(DIRECT_MESSAGE_PAGE_SIZE_MAX)
    .default(DIRECT_MESSAGE_PAGE_SIZE_DEFAULT),
  before: z.string().min(1).max(256).optional()
}).strict();

const workspaceIdFromRequest = (request: Parameters<RequestHandler>[0]): string | null => {
  const header = request.headers["x-workspace-id"];
  return typeof header === "string" ? header.trim() || null : null;
};

const resolveAccess = async (
  request: Parameters<RequestHandler>[0],
  getIdentity: ControllerDependencies["getIdentity"],
  getWorkspaceAccess: ControllerDependencies["getWorkspaceAccess"]
): Promise<RequestAccessResult> => {
  const identity = await getIdentity(request.headers);
  if (!identity) return Object.freeze({ kind: "unauthenticated" });
  const result = await getWorkspaceAccess(identity, workspaceIdFromRequest(request));
  if (result.kind !== "allowed") return Object.freeze({ kind: result.kind });
  return Object.freeze({
    kind: "allowed",
    workspaceId: result.access.workspace.id,
    userId: identity.id
  });
};

const toConversationResponse = (conversation: DirectConversationWithParticipant): DirectConversationResponse => ({
  id: conversation.id,
  workspaceId: conversation.workspaceId,
  otherParticipant: conversation.otherParticipant,
  createdAt: conversation.createdAt.toISOString(),
  lastActivityAt: conversation.lastActivityAt.toISOString()
});

const toMessageResponse = (message: DirectMessageWithSender): DirectMessageResponse => ({
  id: message.id,
  conversationId: message.conversationId,
  senderId: message.senderId,
  text: message.text,
  createdAt: message.createdAt.toISOString(),
  sender: message.sender
});

const sendAccessError = (kind: RequestAccessResult["kind"], next: Parameters<RequestHandler>[2]): void => {
  if (kind === "unauthenticated") {
    next(createApplicationError({
      code: ERROR_CODES.unauthenticated,
      message: ERROR_MESSAGES.unauthenticated,
      status: HTTP_STATUS.unauthorized
    }));
  } else if (kind === "unavailable") {
    next(createApplicationError({
      code: ERROR_CODES.workspaceStorageUnavailable,
      message: ERROR_MESSAGES.workspaceStorageUnavailable,
      status: HTTP_STATUS.serviceUnavailable
    }));
  } else {
    next(createApplicationError({
      code: ERROR_CODES.workspaceAccessDenied,
      message: ERROR_MESSAGES.workspaceAccessDenied,
      status: HTTP_STATUS.forbidden
    }));
  }
};

const sendUnavailable = (next: Parameters<RequestHandler>[2]): void => {
  next(createApplicationError({
    code: ERROR_CODES.directMessageStorageUnavailable,
    message: ERROR_MESSAGES.directMessageStorageUnavailable,
    status: HTTP_STATUS.serviceUnavailable
  }));
};

const sendWorkspaceUnavailable = (next: Parameters<RequestHandler>[2]): void => {
  next(createApplicationError({
    code: ERROR_CODES.workspaceStorageUnavailable,
    message: ERROR_MESSAGES.workspaceStorageUnavailable,
    status: HTTP_STATUS.serviceUnavailable
  }));
};

const sendNotFound = (next: Parameters<RequestHandler>[2]): void => {
  next(createApplicationError({
    code: ERROR_CODES.routeNotFound,
    message: ERROR_MESSAGES.directMessageUnavailable,
    status: HTTP_STATUS.notFound
  }));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const createListDirectMessagesController = (
  { getIdentity, getWorkspaceAccess, service }: ControllerDependencies
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const access = await resolveAccess(request, getIdentity, getWorkspaceAccess);
    if (access.kind !== "allowed") {
      sendAccessError(access.kind, next);
      return;
    }
    const result = await service.list(access.workspaceId, access.userId);
    if (result.kind === "unavailable") {
      sendUnavailable(next);
      return;
    }
    const body: DirectConversationListResponse = {
      conversations: result.conversations.slice(0, DIRECT_CONVERSATION_LIST_LIMIT).map(toConversationResponse)
    };
    response.status(HTTP_STATUS.ok).json(body);
  } catch (error: unknown) {
    next(error);
  }
};

export const createOpenDirectMessageController = (
  { getIdentity, getWorkspaceAccess, service, realtime }: ControllerDependencies
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const access = await resolveAccess(request, getIdentity, getWorkspaceAccess);
    if (access.kind !== "allowed") {
      sendAccessError(access.kind, next);
      return;
    }
    const parsed = openBodySchema.safeParse(request.body);
    if (!parsed.success) {
      next(createApplicationError({
        code: ERROR_CODES.validation,
        message: ERROR_MESSAGES.validation,
        status: HTTP_STATUS.badRequest,
        details: { field: "recipientId", reason: "invalid_recipient" }
      }));
      return;
    }
    const result = await service.open(access.workspaceId, access.userId, parsed.data.recipientId);
    if (result.kind === "unavailable") {
      sendUnavailable(next);
      return;
    }
    if (result.kind === "workspace-unavailable") {
      sendWorkspaceUnavailable(next);
      return;
    }
    if (result.kind === "self") {
      next(createApplicationError({
        code: ERROR_CODES.validation,
        message: ERROR_MESSAGES.validation,
        status: HTTP_STATUS.badRequest,
        details: { field: "recipientId", reason: "self_conversation_not_allowed" }
      }));
      return;
    }
    if (result.kind === "recipient-unavailable") {
      sendNotFound(next);
      return;
    }
    if (result.created) realtime?.publishConversationChanged(access.workspaceId);
    response.status(result.created ? HTTP_STATUS.created : HTTP_STATUS.ok)
      .json({ conversation: toConversationResponse(result.conversation) });
  } catch (error: unknown) {
    next(error);
  }
};

export const createGetDirectMessageController = (
  { getIdentity, getWorkspaceAccess, service }: ControllerDependencies
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const access = await resolveAccess(request, getIdentity, getWorkspaceAccess);
    if (access.kind !== "allowed") {
      sendAccessError(access.kind, next);
      return;
    }
    const conversationId = request.params.conversationId;
    if (typeof conversationId !== "string" || conversationId.length === 0) {
      sendNotFound(next);
      return;
    }
    const result = await service.get(access.workspaceId, conversationId, access.userId);
    if (result.kind === "unavailable") {
      sendUnavailable(next);
      return;
    }
    if (result.kind === "not-found") {
      sendNotFound(next);
      return;
    }
    response.status(HTTP_STATUS.ok).json({ conversation: toConversationResponse(result.conversation) });
  } catch (error: unknown) {
    next(error);
  }
};

export const createListDirectMessageHistoryController = (
  { getIdentity, getWorkspaceAccess, service }: ControllerDependencies
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const access = await resolveAccess(request, getIdentity, getWorkspaceAccess);
    if (access.kind !== "allowed") {
      sendAccessError(access.kind, next);
      return;
    }
    const conversationId = request.params.conversationId;
    if (typeof conversationId !== "string" || conversationId.length === 0) {
      sendNotFound(next);
      return;
    }
    const parsed = querySchema.parse(request.query);
    const cursor = parsed.before === undefined ? null : decodeDirectMessageCursor(parsed.before);
    if (cursor && !cursor.ok) {
      next(createApplicationError({
        code: ERROR_CODES.validation,
        message: ERROR_MESSAGES.validation,
        status: HTTP_STATUS.badRequest,
        details: { field: "before", reason: "invalid_cursor" }
      }));
      return;
    }
    const result = await service.listMessages(access.workspaceId, conversationId, access.userId, {
      pageSize: parsed.limit,
      before: cursor?.ok ? cursor.cursor : null
    });
    if (result.kind === "unavailable") {
      sendUnavailable(next);
      return;
    }
    if (result.kind === "not-found") {
      sendNotFound(next);
      return;
    }
    const body: DirectMessageListResponse = {
      messages: result.messages.map(toMessageResponse),
      nextCursor: result.nextCursor
    };
    response.status(HTTP_STATUS.ok).json(body);
  } catch (error: unknown) {
    next(error);
  }
};

export const createSendDirectMessageController = (
  { getIdentity, getWorkspaceAccess, service, realtime }: ControllerDependencies
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const access = await resolveAccess(request, getIdentity, getWorkspaceAccess);
    if (access.kind !== "allowed") {
      sendAccessError(access.kind, next);
      return;
    }
    const conversationId = request.params.conversationId;
    if (typeof conversationId !== "string" || conversationId.length === 0) {
      sendNotFound(next);
      return;
    }
    const parsed = messageBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const requestedText = isRecord(request.body) && typeof request.body.text === "string"
        ? request.body.text
        : null;
      next(createApplicationError({
        code: ERROR_CODES.validation,
        message: ERROR_MESSAGES.validation,
        status: HTTP_STATUS.badRequest,
        details: {
          field: "text",
          reason: requestedText !== null && Array.from(requestedText).length > DIRECT_MESSAGE_MAX_LENGTH
            ? "message_too_long"
            : "message_required"
        }
      }));
      return;
    }
    const result = await service.send(access.workspaceId, conversationId, access.userId, parsed.data.text);
    if (result.kind === "unavailable") {
      sendUnavailable(next);
      return;
    }
    if (result.kind === "not-found") {
      sendNotFound(next);
      return;
    }
    if (result.kind === "invalid") {
      next(createApplicationError({
        code: ERROR_CODES.validation,
        message: ERROR_MESSAGES.validation,
        status: HTTP_STATUS.badRequest,
        details: { field: "text", reason: result.error }
      }));
      return;
    }
    const message = toMessageResponse(result.message);
    realtime?.publishDirectMessage(access.workspaceId, conversationId, message);
    response.status(HTTP_STATUS.created).json(message);
  } catch (error: unknown) {
    next(error);
  }
};
