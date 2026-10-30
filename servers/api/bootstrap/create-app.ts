import express, { type Express, type RequestHandler } from "express";
import { createHttpLogger, type Logger } from "@workspace/logging";
import type { ApiConfig } from "../types/index.js";
import { apiRuntime } from "../constants/index.js";
import {
  createChannelRoutes,
  type ChannelMessageService,
  type ChannelRealtimePublisher,
  type ChannelService
} from "../features/channels/index.js";
import {
  createDirectMessageRoutes,
  type DirectMessageRealtimePublisher,
  type DirectMessageService
} from "../features/direct-messages/index.js";
import { createHealthRoutes } from "../features/health/index.js";
import { createWorkspaceRoutes } from "../features/workspaces/index.js";
import { createMessageSearchRoutes, type MessageSearchService } from "../features/message-search/index.js";
import { createNotificationRoutes, type NotificationService } from "../features/notifications/index.js";
import { createProfileImageRoutes } from "../features/profile-images/index.js";
import type { AuthenticationIntegration } from "../integrations/index.js";
import type { ChatAttachmentIntegration, ProfileImageStorage } from "../integrations/index.js";
import type { SharedRateLimiter } from "../integrations/mongodb/index.js";
import type { WorkspaceService } from "../features/workspaces/index.js";
import {
  createApiRateLimitMiddleware,
  createCorsMiddleware,
  createErrorHandler,
  createNotFoundHandler,
  createSecurityHeadersMiddleware
} from "../middleware/index.js";

type AppDependencies = Readonly<{
  config: ApiConfig;
  logger: Logger;
  appInstance?: Express;
  rateLimiter: SharedRateLimiter;
  trustVercelForwardedFor: boolean;
  authentication: AuthenticationIntegration;
  attachmentStorage?: ChatAttachmentIntegration;
  profileImageStorage?: ProfileImageStorage;
  apiTelemetryMiddleware?: RequestHandler;
  channelService: ChannelService;
  channelMessageService: ChannelMessageService;
  channelRealtime?: ChannelRealtimePublisher;
  directMessageService?: DirectMessageService;
  directMessageRealtime?: DirectMessageRealtimePublisher;
  messageSearchService?: MessageSearchService;
  notificationService?: NotificationService;
  workspaceService: WorkspaceService;
}>;

export const createApp = ({
  config,
  logger,
  appInstance = express(),
  rateLimiter,
  trustVercelForwardedFor,
  authentication,
  attachmentStorage,
  profileImageStorage,
  apiTelemetryMiddleware,
  channelService,
  channelMessageService,
  channelRealtime,
  directMessageService,
  directMessageRealtime,
  messageSearchService,
  notificationService,
  workspaceService
}: AppDependencies): Express => {
  const app = appInstance;
  app.disable("x-powered-by");
  if (apiTelemetryMiddleware) app.use(apiTelemetryMiddleware);
  app.use(createHttpLogger({
    logger,
    format: config.environment === "production" ? "combined" : "dev",
    skip: (request) => {
      const url = request.url ?? "";
      return /^\/workspace-invitations\/[^/?]+\/accept(?:\?|$)/.test(url)
        || /^\/api\/auth\/callback(?:\/|\?|$)/.test(url);
    }
  }));
  app.use(createSecurityHeadersMiddleware());
  app.use(createCorsMiddleware({ origin: config.webOrigin }));
  app.use(createApiRateLimitMiddleware({ rateLimiter, trustVercelForwardedFor }));
  app.all("/api/auth", authentication.handler);
  app.all("/api/auth/*splat", authentication.handler);
  app.use(express.json({ limit: apiRuntime.jsonBodyLimit }));
  const featureRouters = [createHealthRoutes({
    environment: config.environment,
    serviceName: apiRuntime.serviceName
  }), createProfileImageRoutes({
    getIdentity: authentication.getIdentity,
    updateUserImage: authentication.updateUserImage,
    ...(profileImageStorage ? { storage: profileImageStorage } : {})
  }), createWorkspaceRoutes({
    service: workspaceService,
    getIdentity: authentication.getIdentity,
    ...(channelRealtime ? {
      realtime: {
        publishMembersChanged: channelRealtime.publishWorkspaceMembersChanged,
        revokeAccess: channelRealtime.revokeWorkspaceAccess
      }
    } : {})
  }), createChannelRoutes({
    getIdentity: authentication.getIdentity,
    getWorkspaceAccess: workspaceService.getAccess,
    getMemberEmailVisibility: workspaceService.getMemberEmailVisibility,
    service: channelService,
    messageService: channelMessageService,
    ...(attachmentStorage ? { attachmentStorage } : {}),
    ...(channelRealtime ? { realtime: channelRealtime } : {}),
    ...(notificationService ? { notifications: notificationService } : {})
  })];
  if (directMessageService) {
    featureRouters.push(createDirectMessageRoutes({
      getIdentity: authentication.getIdentity,
      getWorkspaceAccess: workspaceService.getAccess,
      service: directMessageService,
      ...(attachmentStorage ? { attachmentStorage } : {}),
      ...(directMessageRealtime ? { realtime: directMessageRealtime } : {}),
      ...(notificationService ? { notifications: notificationService } : {})
    }));
  }
  if (messageSearchService) {
    featureRouters.push(createMessageSearchRoutes({
      getIdentity: authentication.getIdentity,
      getWorkspaceAccess: workspaceService.getAccess,
      service: messageSearchService
    }));
  }
  if (notificationService) {
    featureRouters.push(createNotificationRoutes({
      getIdentity: authentication.getIdentity,
      service: notificationService
    }));
  }
  for (const featureRouter of featureRouters) app.use(featureRouter);
  app.use(createNotFoundHandler());
  app.use(createErrorHandler({ logger }));
  return app;
};
