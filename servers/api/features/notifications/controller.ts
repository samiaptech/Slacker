import type { IncomingHttpHeaders } from "node:http";
import type { RequestHandler } from "express";
import { z } from "zod";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../../constants/index.js";
import { createApplicationError } from "../../errors/index.js";
import type { NotificationResource } from "./model.js";
import {
  NOTIFICATION_PAGE_SIZE_DEFAULT,
  NOTIFICATION_PAGE_SIZE_MAX,
  isNotificationStorageUnavailable,
  type NotificationService
} from "./service.js";

type Identity = Readonly<{ id: string; name: string; email: string; image: string | null }>;
type Dependencies = Readonly<{
  getIdentity: (headers: IncomingHttpHeaders) => Promise<Identity | null>;
  service: NotificationService;
}>;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(NOTIFICATION_PAGE_SIZE_MAX)
    .default(NOTIFICATION_PAGE_SIZE_DEFAULT),
  before: z.string().min(1).max(512).optional()
}).strict();
const resourceSchema = z.object({
  type: z.enum(["channel", "direct_message"]),
  id: z.string().trim().min(1).max(128)
}).strict();

const unauthenticated = () => createApplicationError({
  code: ERROR_CODES.unauthenticated,
  message: ERROR_MESSAGES.unauthenticated,
  status: HTTP_STATUS.unauthorized
});
const unavailable = () => createApplicationError({
  code: ERROR_CODES.internal,
  message: "Notifications are temporarily unavailable.",
  status: HTTP_STATUS.serviceUnavailable
});
const validation = () => createApplicationError({
  code: ERROR_CODES.validation,
  message: ERROR_MESSAGES.validation,
  status: HTTP_STATUS.badRequest
});

const userIdFor = async (
  request: Parameters<RequestHandler>[0],
  getIdentity: Dependencies["getIdentity"]
): Promise<string | null> => (await getIdentity(request.headers))?.id ?? null;

export const createNotificationControllers = ({ getIdentity, service }: Dependencies) => Object.freeze({
  list: (async (request, response, next): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const userId = await userIdFor(request, getIdentity);
      if (!userId) {
        next(unauthenticated());
        return;
      }
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        next(validation());
        return;
      }
      const result = await service.list(userId, parsed.data.limit, parsed.data.before);
      if (result.kind === "invalid-cursor") {
        next(validation());
        return;
      }
      response.status(HTTP_STATUS.ok).json({
        notifications: result.notifications.map((notification) => ({
          id: notification.id,
          eventId: notification.eventId,
          type: notification.type,
          workspaceId: notification.workspaceId,
          resource: notification.resource,
          actor: notification.actor,
          createdAt: notification.createdAt.toISOString(),
          readAt: notification.readAt?.toISOString() ?? null
        })),
        nextCursor: result.nextCursor
      });
    } catch (error: unknown) {
      next(isNotificationStorageUnavailable(error) ? unavailable() : error);
    }
  }) as RequestHandler,
  unreadCount: (async (request, response, next): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const userId = await userIdFor(request, getIdentity);
      if (!userId) {
        next(unauthenticated());
        return;
      }
      response.status(HTTP_STATUS.ok).json({ unreadCount: await service.unreadCount(userId) });
    } catch (error: unknown) {
      next(isNotificationStorageUnavailable(error) ? unavailable() : error);
    }
  }) as RequestHandler,
  markRead: (async (request, response, next): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const userId = await userIdFor(request, getIdentity);
      if (!userId) {
        next(unauthenticated());
        return;
      }
      const notificationId = request.params.notificationId;
      if (typeof notificationId !== "string" || notificationId.length === 0) {
        next(validation());
        return;
      }
      const result = await service.markRead(userId, notificationId);
      if (result.kind === "not-found") {
        next(createApplicationError({
          code: ERROR_CODES.routeNotFound,
          message: "The notification is unavailable.",
          status: HTTP_STATUS.notFound
        }));
        return;
      }
      response.status(HTTP_STATUS.ok).json({ markedRead: true });
    } catch (error: unknown) {
      next(isNotificationStorageUnavailable(error) ? unavailable() : error);
    }
  }) as RequestHandler,
  markResourceRead: (async (request, response, next): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const userId = await userIdFor(request, getIdentity);
      if (!userId) {
        next(unauthenticated());
        return;
      }
      const parsed = resourceSchema.safeParse(request.body);
      if (!parsed.success) {
        next(validation());
        return;
      }
      const resource: NotificationResource = Object.freeze(parsed.data);
      await service.markResourceRead(userId, resource);
      response.status(HTTP_STATUS.ok).json({ markedRead: true });
    } catch (error: unknown) {
      next(isNotificationStorageUnavailable(error) ? unavailable() : error);
    }
  }) as RequestHandler
});
