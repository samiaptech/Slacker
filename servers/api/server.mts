import express from "express";
import { createLogger } from "@workspace/logging";
import { randomBytes, randomUUID } from "node:crypto";
import { createApp, createServer, createShutdown } from "./bootstrap/index.js";
import { createApiConfig, readApiEnvironment } from "./config/index.js";
import { apiRuntime } from "./constants/index.js";
import {
  createAuthenticationIntegration,
  createCloudinaryIntegration,
  createMongoDbIntegration,
  createSocketIoIntegration
} from "./integrations/index.js";
import { createMongoWorkspaceStorage, createWorkspaceRepository, createWorkspaceService } from "./features/workspaces/index.js";
import {
  createMongoChannelMembershipCleanup,
  createChannelMessageRepository,
  createChannelMessageService,
  createChannelRealtime,
  createChannelRepository,
  createChannelService,
  createMongoChannelMessageStorage,
  createMongoChannelStorage
} from "./features/channels/index.js";
import {
  createDirectMessageRealtime,
  createDirectMessageRepository,
  createDirectMessageService,
  createMongoDirectMessageStorage
} from "./features/direct-messages/index.js";
import {
  createMessageSearchRepository,
  createMessageSearchService,
  createMongoMessageSearchStorage
} from "./features/message-search/index.js";

const isVercelRuntime = process.env.VERCEL === "1";

if (!isVercelRuntime) await import("dotenv/config");

const config = createApiConfig(readApiEnvironment());
const logger = createLogger({
  service: apiRuntime.serviceName,
  level: config.logLevel,
  format: config.environment === "production" ? "json" : "pretty"
});
const database = createMongoDbIntegration({
  logger,
  uri: config.mongodbUri
});
await database.connect();
const authentication = createAuthenticationIntegration({
  config,
  database: database.getDatabase()
});
const attachmentStorage = config.cloudinary
  ? createCloudinaryIntegration(config.cloudinary)
  : undefined;
const mongoDatabase = database.getDatabase();
const cleanupChannelMemberships = createMongoChannelMembershipCleanup(mongoDatabase);
const workspaceRepository = createWorkspaceRepository(
  createMongoWorkspaceStorage(mongoDatabase, database.withTransaction, cleanupChannelMemberships)
);
const channelRepository = createChannelRepository(createMongoChannelStorage(mongoDatabase, database.withTransaction));
const channelMessageRepository = createChannelMessageRepository(
  createMongoChannelMessageStorage(database.getDatabase(), database.withTransaction)
);
const channelMessageService = createChannelMessageService({
  repository: channelMessageRepository,
  ...(attachmentStorage ? { attachmentStorage } : {}),
  createId: randomUUID,
  now: () => new Date(),
  findUsersByIds: authentication.findUsersByIds
});
const directMessageRepository = createDirectMessageRepository(
  createMongoDirectMessageStorage(database.getDatabase(), database.withTransaction)
);
const directMessageService = createDirectMessageService({
  repository: directMessageRepository,
  ...(attachmentStorage ? { attachmentStorage } : {}),
  isWorkspaceMember: async (workspaceId, userId) => {
    try {
      return await workspaceRepository.findMembership(workspaceId, userId) ? "member" : "not-member";
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null
        && "kind" in error && error.kind === "workspace-storage-unavailable") return "unavailable";
      throw error;
    }
  },
  createId: randomUUID,
  now: () => new Date(),
  findUsersByIds: authentication.findUsersByIds
});
const messageSearchService = createMessageSearchService({
  repository: createMessageSearchRepository(
    createMongoMessageSearchStorage(database.getDatabase())
  ),
  findUsersByIds: authentication.findUsersByIds
});
const channelService = createChannelService({
  repository: channelRepository,
  logger,
  createId: randomUUID,
  now: () => new Date(),
  findWorkspaceMemberByEmail: async (workspaceId, email) => {
    const identity = await authentication.findUserByEmail(email);
    if (!identity) return { kind: "not-found" };
    try {
      const membership = await workspaceRepository.findMembership(workspaceId, identity.id);
      return membership ? { kind: "found", member: identity } : { kind: "not-found" };
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null
        && "kind" in error && error.kind === "workspace-storage-unavailable") {
        return { kind: "unavailable" };
      }
      throw error;
    }
  },
  findWorkspaceMembersByIds: async (userIds) =>
    authentication.findUsersByIds(userIds)
});
const workspaceService = createWorkspaceService({
  repository: workspaceRepository,
  createId: randomUUID,
  createInviteToken: () => randomBytes(32).toString("base64url"),
  now: () => new Date(),
  webOrigin: config.webOrigin,
  findUsersByIds: authentication.findUsersByIds,
  ensureGeneralChannel: async (workspaceId, userId) => {
    const result = await channelService.ensureGeneralChannel(workspaceId, userId);
    return result.kind === "ready" ? "ready" : "unavailable";
  }
});
const socketIo = createSocketIoIntegration({
  webOrigin: config.webOrigin,
  getIdentity: authentication.getIdentity,
  logger
});
const channelRealtime = createChannelRealtime({
  socketIo,
  channelService,
  getWorkspaceAccess: async (identity, workspaceId) => {
    const result = await workspaceService.getAccess(identity, workspaceId);
    if (result.kind === "allowed") return "allowed";
    return result.kind === "unavailable" ? "unavailable" : "denied";
  },
  logger
});
const directMessageRealtime = createDirectMessageRealtime({ socketIo, service: directMessageService, logger });
const app = createApp({
  config,
  logger,
  appInstance: express(),
  authentication,
  ...(attachmentStorage ? { attachmentStorage } : {}),
  channelService,
  channelMessageService,
  channelRealtime,
  directMessageService,
  directMessageRealtime,
  messageSearchService,
  workspaceService
});
const server = createServer({ app, config, logger });
socketIo.attach(server.raw);
export default app;

if (!isVercelRuntime) {
  const shutdown = createShutdown({ database, logger, server, socketIo });
  await server.start();

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown(signal)
        .then(() => process.exit(0))
        .catch((error: unknown) => {
          logger.error("API shutdown failed.", { error: error instanceof Error ? error.message : String(error) });
          process.exit(1);
        });
    });
  }
}
