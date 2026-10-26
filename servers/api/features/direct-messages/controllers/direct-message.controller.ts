import type { IncomingHttpHeaders } from "node:http";
import type { RequestHandler } from "express";
import type {
  ChatAttachmentResponse,
  DirectConversationListResponse,
  DirectConversationResponse,
  DirectMessageListResponse,
  DirectMessageResponse
} from "@workspace/types";
import { z } from "zod";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../../../constants/index.js";
import { createApplicationError } from "../../../errors/index.js";
import type { ChatAttachmentIntegration } from "../../../integrations/index.js";
import { validateChatAttachment } from "../../../integrations/cloudinary/index.js";
import {
  decodeDirectMessageCursor,
  DIRECT_CONVERSATION_LIST_LIMIT,
  DIRECT_MESSAGE_MAX_LENGTH,
  DIRECT_MESSAGE_PAGE_SIZE_DEFAULT,
  DIRECT_MESSAGE_PAGE_SIZE_MAX
} from "../domain/index.js";
import type { DirectConversationWithParticipant, DirectMessageService, DirectMessageWithSender } from "../services/index.js";
import { isNotificationStorageUnavailable, type NotificationService } from "../../notifications/public/index.js";

type DirectMessageIdentity = Readonly<{ id: string; name: string; email: string; image: string | null }>;
type DirectWorkspaceAccessResult =
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "allowed"; access: Readonly<{ workspace: Readonly<{ id: string; role: "admin" | "member" }> }> }>;
type DirectMessageRealtime = Readonly<{
  publishDirectMessage: (workspaceId: string, conversationId: string, message: DirectMessageResponse) => void;
  publishMessageDeleted: (workspaceId: string, conversationId: string, messageId: string) => void;
  publishConversationChanged: (workspaceId: string) => void;
}>;
type ControllerDependencies = Readonly<{
  getIdentity: (headers: IncomingHttpHeaders) => Promise<DirectMessageIdentity | null>;
  getWorkspaceAccess: (
    identity: DirectMessageIdentity | null,
    workspaceId: string | null
  ) => Promise<DirectWorkspaceAccessResult>;
  service: DirectMessageService;
  attachmentStorage?: ChatAttachmentIntegration;
  realtime?: DirectMessageRealtime;
  notifications?: Pick<NotificationService, "notifyDirectMessage" | "markResourceRead">;
}>;

type RequestAccessResult =
  | Readonly<{
    kind: "allowed";
    workspaceId: string;
    userId: string;
    workspaceRole: "admin" | "member";
    senderProfile: Readonly<{ name: string; image: string | null }>;
  }>
  | Readonly<{ kind: "unauthenticated" | "denied" | "unavailable" }>;

const openBodySchema = z.object({ recipientId: z.string().trim().min(1).max(128) }).strict();
const messageBodySchema = z.object({
  text: z.string().default("")
    .refine((text) => Array.from(text).length <= DIRECT_MESSAGE_MAX_LENGTH)
}).strict();
const deleteBodySchema = z.object({ scope: z.enum(["me", "everyone"]) }).strict();
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
    userId: identity.id,
    workspaceRole: result.access.workspace.role,
    senderProfile: Object.freeze({ name: identity.name, image: identity.image })
  });
};

const toConversationResponse = (conversation: DirectConversationWithParticipant): DirectConversationResponse => ({
  id: conversation.id,
  workspaceId: conversation.workspaceId,
  otherParticipant: conversation.otherParticipant,
  createdAt: conversation.createdAt.toISOString(),
  lastActivityAt: conversation.lastActivityAt.toISOString()
});

const toMessageResponse = (message: DirectMessageWithSender): DirectMessageResponse => {
  const attachments = message.attachments ?? [];
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    text: message.text,
    createdAt: message.createdAt.toISOString(),
    ...(attachments.length > 0 ? { attachments: attachments.map((attachment): ChatAttachmentResponse => ({
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    downloadUrl: `/direct-messages/${encodeURIComponent(message.conversationId)}/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.id)}`
    })) } : {}),
    sender: message.sender
  };
};

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
const normalizeNotificationFailure = (error: unknown): unknown =>
  isNotificationStorageUnavailable(error)
    ? createApplicationError({
      code: ERROR_CODES.internal,
      message: "Notifications are temporarily unavailable.",
      status: HTTP_STATUS.serviceUnavailable
    })
    : error;

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
    next(normalizeNotificationFailure(error));
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
    next(normalizeNotificationFailure(error));
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
    next(normalizeNotificationFailure(error));
  }
};

export const createListDirectMessageHistoryController = (
  { getIdentity, getWorkspaceAccess, service, notifications }: ControllerDependencies
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
    await notifications?.markResourceRead(access.userId, {
      type: "direct_message",
      id: conversationId
    });
    const body: DirectMessageListResponse = {
      messages: result.messages.map(toMessageResponse),
      nextCursor: result.nextCursor
    };
    response.status(HTTP_STATUS.ok).json(body);
  } catch (error: unknown) {
    next(normalizeNotificationFailure(error));
  }
};

export const createDeleteDirectMessageController = (
  { getIdentity, getWorkspaceAccess, service, realtime }: ControllerDependencies
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const access = await resolveAccess(request, getIdentity, getWorkspaceAccess);
    if (access.kind !== "allowed") {
      sendAccessError(access.kind, next);
      return;
    }
    const { conversationId, messageId } = request.params;
    if (typeof conversationId !== "string" || typeof messageId !== "string" || !conversationId || !messageId) {
      sendNotFound(next);
      return;
    }
    const parsed = deleteBodySchema.safeParse(request.body);
    if (!parsed.success) {
      next(createApplicationError({
        code: ERROR_CODES.validation,
        message: ERROR_MESSAGES.validation,
        status: HTTP_STATUS.badRequest,
        details: { field: "scope", reason: "must_be_me_or_everyone" }
      }));
      return;
    }
    const result = await service.deleteMessage(
      access.workspaceId,
      conversationId,
      access.userId,
      messageId,
      parsed.data.scope,
      access.workspaceRole === "admin"
    );
    if (result.kind === "unavailable") {
      sendUnavailable(next);
      return;
    }
    if (result.kind === "not-found") {
      sendNotFound(next);
      return;
    }
    if (result.kind === "forbidden") {
      next(createApplicationError({
        code: ERROR_CODES.messageDeleteForbidden,
        message: ERROR_MESSAGES.messageDeleteForbidden,
        status: HTTP_STATUS.forbidden
      }));
      return;
    }
    if (parsed.data.scope === "everyone") {
      realtime?.publishMessageDeleted(access.workspaceId, conversationId, messageId);
    }
    if (result.kind === "attachment-cleanup-failed") {
      next(createApplicationError({
        code: ERROR_CODES.messageDeleteCleanupFailed,
        message: ERROR_MESSAGES.messageDeleteCleanupFailed,
        status: HTTP_STATUS.serviceUnavailable
      }));
      return;
    }
    response.status(HTTP_STATUS.noContent).end();
  } catch (error: unknown) {
    next(normalizeNotificationFailure(error));
  }
};

export const createSendDirectMessageController = (
  { getIdentity, getWorkspaceAccess, service, realtime, notifications }: ControllerDependencies
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
    const files = Array.isArray(request.files) ? request.files.map((file) => ({
      buffer: file.buffer,
      name: file.originalname,
      size: file.size
    })) : [];
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
    if (files.length === 0 && parsed.data.text.trim().length === 0) {
      next(createApplicationError({
        code: ERROR_CODES.validation,
        message: ERROR_MESSAGES.validation,
        status: HTTP_STATUS.badRequest,
        details: { field: "text", reason: "message_required" }
      }));
      return;
    }
    for (const file of files) {
      const validation = validateChatAttachment(file);
      if (!validation.ok) {
        next(createApplicationError({
          code: ERROR_CODES.validation,
          message: ERROR_MESSAGES.validation,
          status: HTTP_STATUS.badRequest,
          details: { field: "files", reason: validation.reason }
        }));
        return;
      }
    }
    const result = await service.send(
      access.workspaceId,
      conversationId,
      access.userId,
      parsed.data.text,
      files,
      access.senderProfile
    );
    if (result.kind === "attachment-unavailable") {
      next(createApplicationError({
        code: ERROR_CODES.chatAttachmentStorageUnavailable,
        message: ERROR_MESSAGES.chatAttachmentStorageUnavailable,
        status: HTTP_STATUS.serviceUnavailable
      }));
      return;
    }
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
        details: {
          field: ["attachment_limit_exceeded", "unsupported_file_type", "invalid_file_content", "file_too_large"]
            .includes(result.error) ? "files" : "text",
          reason: result.error
        }
      }));
      return;
    }
    const message = toMessageResponse(result.message);
    await notifications?.notifyDirectMessage({
      workspaceId: access.workspaceId,
      conversationId,
      messageId: result.message.id,
      actor: { id: access.userId, name: access.senderProfile.name },
      createdAt: result.message.createdAt
    });
    realtime?.publishDirectMessage(access.workspaceId, conversationId, message);
    response.status(HTTP_STATUS.created).json(message);
  } catch (error: unknown) {
    next(normalizeNotificationFailure(error));
  }
};

export const createAuthorizeDirectMessageUploadController = (
  { getIdentity, getWorkspaceAccess, service }: ControllerDependencies
): RequestHandler => async (request, _response, next): Promise<void> => {
  if (!request.is("multipart/form-data")) {
    next();
    return;
  }
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
    if (result.kind !== "found") {
      sendNotFound(next);
      return;
    }
    next();
  } catch (error: unknown) {
    next(normalizeNotificationFailure(error));
  }
};

export const createDownloadDirectMessageAttachmentController = (
  { getIdentity, getWorkspaceAccess, service, attachmentStorage }: ControllerDependencies
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "private, no-store");
  try {
    const access = await resolveAccess(request, getIdentity, getWorkspaceAccess);
    if (access.kind !== "allowed") {
      sendAccessError(access.kind, next);
      return;
    }
    const { conversationId, messageId, attachmentId } = request.params;
    if (typeof conversationId !== "string" || typeof messageId !== "string" || typeof attachmentId !== "string") {
      sendNotFound(next);
      return;
    }
    const result = await service.getAttachment(
      access.workspaceId,
      conversationId,
      access.userId,
      messageId,
      attachmentId
    );
    if (result.kind === "unavailable") {
      sendUnavailable(next);
      return;
    }
    if (result.kind === "not-found") {
      sendNotFound(next);
      return;
    }
    if (!attachmentStorage) {
      next(createApplicationError({
        code: ERROR_CODES.chatAttachmentStorageUnavailable,
        message: ERROR_MESSAGES.chatAttachmentStorageUnavailable,
        status: HTTP_STATUS.serviceUnavailable
      }));
      return;
    }
    const buffer = await attachmentStorage.download(result.attachment);
    response.setHeader("Content-Type", result.attachment.mimeType);
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(result.attachment.name)}`);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.status(HTTP_STATUS.ok).send(buffer);
  } catch (error: unknown) {
    next(normalizeNotificationFailure(error));
  }
};
