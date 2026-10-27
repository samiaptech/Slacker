import type { RequestHandler } from "express";
import {
  MESSAGE_REACTION_EMOJI,
  type ChannelMessageResponse,
  type MessageReactionToggleResponse
} from "@workspace/types";
import { z } from "zod";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../../../constants/index.js";
import { createApplicationError } from "../../../errors/index.js";
import type { ChatAttachmentIntegration } from "../../../integrations/index.js";
import {
  validateChatAttachment
} from "../../../integrations/cloudinary/index.js";
import {
  CHANNEL_MESSAGE_MAX_LENGTH,
  CHANNEL_MESSAGE_PAGE_SIZE_DEFAULT,
  CHANNEL_MESSAGE_PAGE_SIZE_MAX,
  decodeChannelMessageCursor
} from "../domain/index.js";
import type { ChannelMessageService } from "../services/index.js";
import type { ChannelMessageWithSender } from "../services/index.js";
import type { ChannelSystemEntry } from "../domain/index.js";
import type { ChannelRealtimePublisher } from "../realtime/index.js";
import { isNotificationStorageUnavailable, type NotificationService } from "../../notifications/public/index.js";
import { resolveChannelMemberAccess, sendChannelAccessError, type ChannelAccessDependencies } from "./channel.controller.js";

type ChannelMessageControllerDependencies = ChannelAccessDependencies & Readonly<{
  service: ChannelMessageService;
  attachmentStorage?: ChatAttachmentIntegration;
  realtime?: Pick<ChannelRealtimePublisher, "publishMessage" | "publishMessageDeleted" | "publishMessageReactions">;
  notifications?: Pick<NotificationService, "notifyChannelMessage" | "markResourceRead">;
}>;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(CHANNEL_MESSAGE_PAGE_SIZE_MAX).default(CHANNEL_MESSAGE_PAGE_SIZE_DEFAULT),
  before: z.string().min(1).max(256).optional()
}).strict();

const messageBodySchema = z.object({
  text: z.string().default("")
    .refine((text) => Array.from(text).length <= CHANNEL_MESSAGE_MAX_LENGTH)
}).strict();
const deleteBodySchema = z.object({ scope: z.enum(["me", "everyone"]) }).strict();
const reactionBodySchema = z.object({ emoji: z.enum(MESSAGE_REACTION_EMOJI) }).strict();

type SystemEntryResponse = Readonly<{
  id: string;
  channelId: string;
  type: "system";
  systemEvent: "member_left";
  actor: Readonly<{ id: string; name: string }>;
  text: "";
  createdAt: string;
}>;

const toMessageResponse = (message: ChannelMessageWithSender): (ChannelMessageResponse & Readonly<{ type: "message" }>) | SystemEntryResponse => {
  if ((message as unknown as { type?: string }).type === "system") {
    const entry = message as unknown as ChannelSystemEntry;
    return {
      id: entry.id,
      channelId: entry.channelId,
      type: "system",
      systemEvent: entry.systemEvent,
      actor: entry.actor,
      text: "",
      createdAt: entry.createdAt.toISOString()
    };
  }
  if (!("sender" in message)) throw new Error("A channel history message is missing sender metadata.");
  const attachments = message.attachments ?? [];
  return {
    id: message.id,
    channelId: message.channelId,
    senderId: message.senderId,
    type: "message",
    text: message.text,
    createdAt: message.createdAt.toISOString(),
    reactions: message.reactions,
    ...(attachments.length > 0 ? { attachments: attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    downloadUrl: `/channels/${encodeURIComponent(message.channelId)}/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.id)}`
    })) } : {}),
    sender: message.sender
  };
};

export const createToggleChannelMessageReactionController = (
  { getIdentity, getWorkspaceAccess, service, realtime }: ChannelMessageControllerDependencies
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const access = await resolveChannelMemberAccess(request, getIdentity, getWorkspaceAccess);
    if (access.kind !== "allowed") {
      sendChannelAccessError(access, next);
      return;
    }
    const { channelId, messageId } = request.params;
    if (typeof channelId !== "string" || typeof messageId !== "string" || !channelId || !messageId) {
      next(channelUnavailableError());
      return;
    }
    const parsed = reactionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      next(createApplicationError({
        code: ERROR_CODES.validation,
        message: ERROR_MESSAGES.validation,
        status: HTTP_STATUS.badRequest,
        details: { field: "emoji", reason: "unsupported_emoji" }
      }));
      return;
    }
    const result = await service.toggleReaction(
      access.access.workspace.id,
      channelId,
      access.access.user.id,
      messageId,
      parsed.data.emoji
    );
    if (result.kind === "unavailable") {
      next(messageStorageError());
      return;
    }
    if (result.kind === "not-found") {
      next(channelUnavailableError());
      return;
    }
    const body: MessageReactionToggleResponse = {
      messageId: result.messageId,
      reactions: result.reactions
    };
    realtime?.publishMessageReactions(access.access.workspace.id, channelId, body);
    response.status(HTTP_STATUS.ok).json(body);
  } catch (error: unknown) {
    next(error);
  }
};

const channelUnavailableError = () => createApplicationError({
  code: ERROR_CODES.routeNotFound,
  message: ERROR_MESSAGES.channelUnavailable,
  status: HTTP_STATUS.notFound
});

const messageStorageError = () => createApplicationError({
  code: ERROR_CODES.channelStorageUnavailable,
  message: ERROR_MESSAGES.channelStorageUnavailable,
  status: HTTP_STATUS.serviceUnavailable
});
const notificationStorageError = () => createApplicationError({
  code: ERROR_CODES.internal,
  message: "Notifications are temporarily unavailable.",
  status: HTTP_STATUS.serviceUnavailable
});
const normalizeNotificationFailure = (error: unknown): unknown =>
  isNotificationStorageUnavailable(error) ? notificationStorageError() : error;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const createListChannelMessagesController = (
  { getIdentity, getWorkspaceAccess, service, notifications }: ChannelMessageControllerDependencies
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const access = await resolveChannelMemberAccess(request, getIdentity, getWorkspaceAccess);
    if (access.kind !== "allowed") {
      sendChannelAccessError(access, next);
      return;
    }
    const channelId = request.params.channelId;
    if (typeof channelId !== "string" || channelId.length === 0) {
      next(channelUnavailableError());
      return;
    }
    const parsed = querySchema.parse(request.query);
    const cursor = parsed.before === undefined ? null : decodeChannelMessageCursor(parsed.before);
    if (cursor && !cursor.ok) {
      next(createApplicationError({
        code: ERROR_CODES.validation,
        message: ERROR_MESSAGES.validation,
        status: HTTP_STATUS.badRequest,
        details: { field: "before", reason: "invalid_cursor" }
      }));
      return;
    }
    const result = await service.list(
      access.access.workspace.id,
      channelId,
      access.access.user.id,
      Object.freeze({ pageSize: parsed.limit, before: cursor?.ok ? cursor.cursor : null })
    );
    if (result.kind !== "listed") {
      next(result.kind === "unavailable" ? messageStorageError() : channelUnavailableError());
      return;
    }
    await notifications?.markResourceRead(access.access.user.id, {
      type: "channel",
      id: channelId
    });
    const body = {
      messages: result.messages.map(toMessageResponse),
      nextCursor: result.nextCursor
    };

    response.status(HTTP_STATUS.ok).json(body);
  } catch (error: unknown) {
    next(normalizeNotificationFailure(error));
  }
};

export const createDeleteChannelMessageController = (
  { getIdentity, getWorkspaceAccess, service, realtime }: ChannelMessageControllerDependencies
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const access = await resolveChannelMemberAccess(request, getIdentity, getWorkspaceAccess);
    if (access.kind !== "allowed") {
      sendChannelAccessError(access, next);
      return;
    }
    const { channelId, messageId } = request.params;
    if (typeof channelId !== "string" || typeof messageId !== "string" || !channelId || !messageId) {
      next(channelUnavailableError());
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
    const result = await service.delete(
      access.access.workspace.id,
      channelId,
      access.access.user.id,
      messageId,
      parsed.data.scope,
      access.access.workspace.role === "admin"
    );
    if (result.kind === "unavailable") {
      next(messageStorageError());
      return;
    }
    if (result.kind === "not-found") {
      next(channelUnavailableError());
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
      realtime?.publishMessageDeleted(access.access.workspace.id, channelId, messageId);
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

export const createAuthorizeChannelMessageUploadController = (
  { getIdentity, getWorkspaceAccess, service }: ChannelMessageControllerDependencies
): RequestHandler => async (request, _response, next): Promise<void> => {
  if (!request.is("multipart/form-data")) {
    next();
    return;
  }
  try {
    const access = await resolveChannelMemberAccess(request, getIdentity, getWorkspaceAccess);
    if (access.kind !== "allowed") {
      sendChannelAccessError(access, next);
      return;
    }
    const channelId = request.params.channelId;
    if (typeof channelId !== "string" || channelId.length === 0) {
      next(channelUnavailableError());
      return;
    }
    const result = await service.list(
      access.access.workspace.id,
      channelId,
      access.access.user.id,
      { pageSize: 1, before: null }
    );
    if (result.kind !== "listed") {
      next(result.kind === "unavailable" ? messageStorageError() : channelUnavailableError());
      return;
    }
    next();
  } catch (error: unknown) {
    next(normalizeNotificationFailure(error));
  }
};

export const createSendChannelMessageController = (
  { getIdentity, getWorkspaceAccess, service, realtime, notifications }: ChannelMessageControllerDependencies
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const access = await resolveChannelMemberAccess(request, getIdentity, getWorkspaceAccess);
    if (access.kind !== "allowed") {
      sendChannelAccessError(access, next);
      return;
    }
    const channelId = request.params.channelId;
    if (typeof channelId !== "string" || channelId.length === 0) {
      next(channelUnavailableError());
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
          reason: requestedText !== null
            && Array.from(requestedText).length > CHANNEL_MESSAGE_MAX_LENGTH
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
      access.access.workspace.id,
      channelId,
      access.access.user.id,
      parsed.data.text,
      files,
      { name: access.access.user.name, image: access.access.user.image }
    );
    if (result.kind !== "sent") {
      if (result.kind === "attachment-unavailable") {
        next(createApplicationError({
          code: ERROR_CODES.chatAttachmentStorageUnavailable,
          message: ERROR_MESSAGES.chatAttachmentStorageUnavailable,
          status: HTTP_STATUS.serviceUnavailable
        }));
        return;
      }
      if (result.kind === "unavailable") {
        next(messageStorageError());
        return;
      }
      if (result.kind === "channel-unavailable") {
        next(channelUnavailableError());
        return;
      }
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
    await notifications?.notifyChannelMessage({
      workspaceId: access.access.workspace.id,
      channelId,
      messageId: result.message.id,
      actor: { id: access.access.user.id, name: access.access.user.name },
      text: result.message.text,
      createdAt: result.message.createdAt
    });
    realtime?.publishMessage(
      access.access.workspace.id,
      channelId,
      message as ChannelMessageResponse
    );
    response.status(HTTP_STATUS.created).json(message);
  } catch (error: unknown) {
    next(normalizeNotificationFailure(error));
  }
};

export const createDownloadChannelAttachmentController = (
  { getIdentity, getWorkspaceAccess, service, attachmentStorage }: ChannelMessageControllerDependencies
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "private, no-store");
  try {
    const access = await resolveChannelMemberAccess(request, getIdentity, getWorkspaceAccess);
    if (access.kind !== "allowed") {
      sendChannelAccessError(access, next);
      return;
    }
    const { channelId, messageId, attachmentId } = request.params;
    if (typeof channelId !== "string" || typeof messageId !== "string" || typeof attachmentId !== "string") {
      next(channelUnavailableError());
      return;
    }
    const result = await service.getAttachment(
      access.access.workspace.id,
      channelId,
      access.access.user.id,
      messageId,
      attachmentId
    );
    if (result.kind === "unavailable") {
      next(messageStorageError());
      return;
    }
    if (result.kind === "not-found") {
      next(channelUnavailableError());
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
