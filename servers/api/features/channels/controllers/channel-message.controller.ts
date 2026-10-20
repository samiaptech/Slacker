import type { RequestHandler } from "express";
import type { ChannelMessageListResponse, ChannelMessageResponse } from "@workspace/types";
import { z } from "zod";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../../../constants/index.js";
import { createApplicationError } from "../../../errors/index.js";
import {
  CHANNEL_MESSAGE_MAX_LENGTH,
  CHANNEL_MESSAGE_PAGE_SIZE_DEFAULT,
  CHANNEL_MESSAGE_PAGE_SIZE_MAX,
  decodeChannelMessageCursor
} from "../domain/index.js";
import type { ChannelMessageService } from "../services/index.js";
import type { ChannelMessageWithSender } from "../services/index.js";
import type { ChannelRealtimePublisher } from "../realtime/index.js";
import { resolveChannelMemberAccess, sendChannelAccessError, type ChannelAccessDependencies } from "./channel.controller.js";

type ChannelMessageControllerDependencies = ChannelAccessDependencies & Readonly<{
  service: ChannelMessageService;
  realtime?: Pick<ChannelRealtimePublisher, "publishMessage">;
}>;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(CHANNEL_MESSAGE_PAGE_SIZE_MAX).default(CHANNEL_MESSAGE_PAGE_SIZE_DEFAULT),
  before: z.string().min(1).max(256).optional()
}).strict();

const messageBodySchema = z.object({
  text: z.string()
    .refine((text) => Array.from(text).length <= CHANNEL_MESSAGE_MAX_LENGTH)
    .refine((text) => text.trim().length > 0)
}).strict();

const toMessageResponse = (message: ChannelMessageWithSender): ChannelMessageResponse => ({
  id: message.id,
  channelId: message.channelId,
  senderId: message.senderId,
  text: message.text,
  createdAt: message.createdAt.toISOString(),
  sender: message.sender
});

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const createListChannelMessagesController = (
  { getIdentity, getWorkspaceAccess, service }: ChannelMessageControllerDependencies
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
    const body: ChannelMessageListResponse = {
      messages: result.messages.map(toMessageResponse),
      nextCursor: result.nextCursor
    };
    response.status(HTTP_STATUS.ok).json(body);
  } catch (error: unknown) {
    next(error);
  }
};

export const createSendChannelMessageController = (
  { getIdentity, getWorkspaceAccess, service, realtime }: ChannelMessageControllerDependencies
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
    const result = await service.send(
      access.access.workspace.id,
      channelId,
      access.access.user.id,
      parsed.data.text
    );
    if (result.kind !== "sent") {
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
        details: { field: "text", reason: result.error }
      }));
      return;
    }
    const message = toMessageResponse(result.message);
    realtime?.publishMessage(access.access.workspace.id, channelId, message);
    response.status(HTTP_STATUS.created).json(message);
  } catch (error: unknown) {
    next(error);
  }
};
