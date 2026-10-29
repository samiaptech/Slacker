import type { RequestHandler } from "express";
import type {
  ChannelNotificationPreference,
  ChannelNotificationPreferenceResponse
} from "@workspace/types";
import { z } from "zod";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../../../constants/index.js";
import { createApplicationError } from "../../../errors/index.js";
import type { ChannelService } from "../services/index.js";
import {
  resolveChannelMemberAccess,
  sendChannelAccessError,
  type ChannelAccessDependencies
} from "./channel.controller.js";

type Dependencies = ChannelAccessDependencies & Readonly<{
  service: Pick<ChannelService, "getNotificationPreference" | "setNotificationPreference">;
}>;

const preferenceSchema = z.object({
  preference: z.enum(["all", "mentions_only", "muted"])
}).strict();
const channelIdSchema = z.string().trim().min(1).max(128);

const channelUnavailable = () => createApplicationError({
  code: ERROR_CODES.routeNotFound,
  message: ERROR_MESSAGES.channelUnavailable,
  status: HTTP_STATUS.notFound
});
const channelStorageUnavailable = () => createApplicationError({
  code: ERROR_CODES.channelStorageUnavailable,
  message: ERROR_MESSAGES.channelStorageUnavailable,
  status: HTTP_STATUS.serviceUnavailable
});
const validationError = () => createApplicationError({
  code: ERROR_CODES.validation,
  message: ERROR_MESSAGES.validation,
  status: HTTP_STATUS.badRequest
});

export const createGetChannelNotificationPreferenceController = (
  { getIdentity, getWorkspaceAccess, service }: Dependencies
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const access = await resolveChannelMemberAccess(request, getIdentity, getWorkspaceAccess);
    if (access.kind !== "allowed") {
      sendChannelAccessError(access, next);
      return;
    }
    const parsedChannelId = channelIdSchema.safeParse(request.params.channelId);
    if (!parsedChannelId.success) {
      next(validationError());
      return;
    }
    const result = await service.getNotificationPreference(
      access.access.workspace.id,
      parsedChannelId.data,
      access.access.user.id
    );
    if (result.kind === "unavailable") {
      next(channelStorageUnavailable());
      return;
    }
    if (result.kind === "channel-unavailable") {
      next(channelUnavailable());
      return;
    }
    const body: ChannelNotificationPreferenceResponse = { preference: result.preference };
    response.status(HTTP_STATUS.ok).json(body);
  } catch (error: unknown) {
    next(error);
  }
};

export const createSetChannelNotificationPreferenceController = (
  { getIdentity, getWorkspaceAccess, service }: Dependencies
): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const access = await resolveChannelMemberAccess(request, getIdentity, getWorkspaceAccess);
    if (access.kind !== "allowed") {
      sendChannelAccessError(access, next);
      return;
    }
    const parsedChannelId = channelIdSchema.safeParse(request.params.channelId);
    const parsedBody = preferenceSchema.safeParse(request.body);
    if (!parsedChannelId.success || !parsedBody.success) {
      next(validationError());
      return;
    }
    const preference: ChannelNotificationPreference = parsedBody.data.preference;
    const result = await service.setNotificationPreference(
      access.access.workspace.id,
      parsedChannelId.data,
      access.access.user.id,
      preference
    );
    if (result.kind === "unavailable") {
      next(channelStorageUnavailable());
      return;
    }
    if (result.kind === "channel-unavailable") {
      next(channelUnavailable());
      return;
    }
    const body: ChannelNotificationPreferenceResponse = { preference: result.preference };
    response.status(HTTP_STATUS.ok).json(body);
  } catch (error: unknown) {
    next(error);
  }
};
