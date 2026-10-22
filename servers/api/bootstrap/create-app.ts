import express, { type Express } from "express";
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
import type { AuthenticationIntegration } from "../integrations/index.js";
import type { ChatAttachmentIntegration } from "../integrations/index.js";
import type { WorkspaceService } from "../features/workspaces/index.js";
import { createCorsMiddleware, createErrorHandler, createNotFoundHandler } from "../middleware/index.js";

type AppDependencies = Readonly<{
  config: ApiConfig;
  logger: Logger;
  authentication: AuthenticationIntegration;
  attachmentStorage?: ChatAttachmentIntegration;
  channelService: ChannelService;
  channelMessageService: ChannelMessageService;
  channelRealtime?: ChannelRealtimePublisher;
  directMessageService?: DirectMessageService;
  directMessageRealtime?: DirectMessageRealtimePublisher;
  messageSearchService?: MessageSearchService;
  workspaceService: WorkspaceService;
}>;

export const createApp = ({
  config,
  logger,
  authentication,
  attachmentStorage,
  channelService,
  channelMessageService,
  channelRealtime,
  directMessageService,
  directMessageRealtime,
  messageSearchService,
  workspaceService
}: AppDependencies): Express => {
  const app = express();
  app.disable("x-powered-by");
  app.use(createHttpLogger({
    logger,
    format: config.environment === "production" ? "combined" : "dev",
    skip: (request) => {
      const url = request.url ?? "";
      return /^\/workspace-invitations\/[^/?]+\/accept(?:\?|$)/.test(url)
        || /^\/api\/auth\/callback(?:\/|\?|$)/.test(url);
    }
  }));
  app.use(createCorsMiddleware({ origin: config.webOrigin }));
  app.all("/api/auth", authentication.handler);
  app.all("/api/auth/*splat", authentication.handler);
  app.use(express.json({ limit: apiRuntime.jsonBodyLimit }));
  const featureRouters = [createHealthRoutes({
    environment: config.environment,
    serviceName: apiRuntime.serviceName
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
    ...(channelRealtime ? { realtime: channelRealtime } : {})
  })];
  if (directMessageService) {
    featureRouters.push(createDirectMessageRoutes({
      getIdentity: authentication.getIdentity,
      getWorkspaceAccess: workspaceService.getAccess,
      service: directMessageService,
      ...(attachmentStorage ? { attachmentStorage } : {}),
      ...(directMessageRealtime ? { realtime: directMessageRealtime } : {})
    }));
  }
  if (messageSearchService) {
    featureRouters.push(createMessageSearchRoutes({
      getIdentity: authentication.getIdentity,
      getWorkspaceAccess: workspaceService.getAccess,
      service: messageSearchService
    }));
  }
  for (const featureRouter of featureRouters) app.use(featureRouter);
  app.use(createNotFoundHandler());
  app.use(createErrorHandler({ logger }));
  return app;
};
