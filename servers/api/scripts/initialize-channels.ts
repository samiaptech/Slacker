import "dotenv/config";
import { createLogger } from "@workspace/logging";
import { randomUUID } from "node:crypto";
import {
  createChannelRepository,
  createChannelService,
  createMongoChannelMessageStorage,
  createMongoChannelStorage
} from "../features/channels/index.js";
import { createApiConfig, readApiEnvironment } from "../config/index.js";
import { apiRuntime } from "../constants/index.js";
import { createMongoDbIntegration } from "../integrations/index.js";
import {
  WORKSPACES_COLLECTION,
  WORKSPACE_MEMBERSHIPS_COLLECTION,
  type WorkspaceDocument,
  type WorkspaceMembershipDocument
} from "../features/workspaces/index.js";

const config = createApiConfig(readApiEnvironment());
const logger = createLogger({
  service: apiRuntime.serviceName,
  level: config.logLevel,
  format: config.environment === "production" ? "json" : "pretty"
});
const database = createMongoDbIntegration({ uri: config.mongodbUri, logger });

await database.connect();
try {
  const mongoDatabase = database.getDatabase();
  const channelStorage = createMongoChannelStorage(mongoDatabase, database.withTransaction);
  const channelMessageStorage = createMongoChannelMessageStorage(mongoDatabase, database.withTransaction);
  await channelStorage.initialize();
  await channelMessageStorage.initialize();
  const channelRepository = createChannelRepository(channelStorage);
  const channelService = createChannelService({
    repository: channelRepository,
    logger,
    createId: randomUUID,
    now: () => new Date(),
    findWorkspaceMemberByEmail: () => Promise.resolve({ kind: "not-found" }),
    findWorkspaceMembersByIds: () => Promise.resolve([])
  });
  const workspaces = await mongoDatabase.collection<WorkspaceDocument>(WORKSPACES_COLLECTION).find({}).toArray();
  const memberships = await mongoDatabase.collection<WorkspaceMembershipDocument>(WORKSPACE_MEMBERSHIPS_COLLECTION)
    .find({})
    .toArray();
  for (const workspace of workspaces) {
    if (await channelRepository.findByWorkspaceAndName(workspace._id, "general")) continue;
    const workspaceMemberships = memberships.filter((membership) => membership.workspaceId === workspace._id);
    for (const membership of workspaceMemberships) {
      const result = await channelService.ensureGeneralChannel(workspace._id, membership.userId);
      if (result.kind === "unavailable") {
        throw new Error(`Could not provision the default #general channel for workspace ${workspace._id}.`);
      }
    }
  }
  logger.info("Channel persistence schema and indexes are ready.");
} finally {
  await database.disconnect();
}