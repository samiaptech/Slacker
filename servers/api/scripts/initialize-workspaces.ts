import "dotenv/config";
import { createLogger } from "@workspace/logging";
import { createApiConfig, readApiEnvironment } from "../config/index.js";
import { apiRuntime } from "../constants/index.js";
import { createMongoWorkspaceStorage } from "../features/workspaces/index.js";
import { createMongoDbIntegration } from "../integrations/index.js";
import { resolveLegacyWorkspaceMembers } from "./legacy-workspace-migration.js";
import type {
  WorkspaceDocument,
  WorkspaceMembershipDocument
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
  await createMongoWorkspaceStorage(mongoDatabase, database.withTransaction).initialize();
  const legacyWorkspaceId = process.env.LEGACY_WORKSPACE_ID?.trim() ?? process.env.WORKSPACE_ID?.trim();
  const legacyWorkspaceName = process.env.LEGACY_WORKSPACE_NAME?.trim() ?? process.env.WORKSPACE_NAME?.trim();
  if (legacyWorkspaceId && legacyWorkspaceName) {
    const existing = await mongoDatabase.collection<WorkspaceDocument>("workspaces").findOne({ _id: legacyWorkspaceId });
    if (!existing) {
      const allowedEmails = (process.env.LEGACY_WORKSPACE_ALLOWED_EMAILS ?? process.env.WORKSPACE_ALLOWED_EMAILS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
      const legacyAccounts = allowedEmails.length > 0
        ? await mongoDatabase.collection<Readonly<{ _id: string; email: string }>>("user")
          .find({ email: { $in: allowedEmails } })
          .toArray()
        : [];
      const channels = await mongoDatabase.collection<Readonly<{
        _id: string;
        workspaceId: string;
        createdBy: string;
      }>>("channels").find({ workspaceId: legacyWorkspaceId }).toArray();
      const channelMemberships = channels.length === 0
        ? []
        : await mongoDatabase.collection<Readonly<{
          channelId: string;
          userId: string;
        }>>("channel_memberships")
          .find({ channelId: { $in: channels.map((channel) => channel._id) } })
          .toArray();
      const legacyMemberMigration = resolveLegacyWorkspaceMembers(
        allowedEmails,
        legacyAccounts,
        channelMemberships.map((membership) => membership.userId)
      );
      const workspace: WorkspaceDocument = Object.freeze({
        _id: legacyWorkspaceId,
        name: legacyWorkspaceName,
        createdBy: legacyMemberMigration.adminUserId,
        createdAt: new Date()
      });
      const memberships: readonly WorkspaceMembershipDocument[] = legacyMemberMigration.memberships.map(({ userId, role }) => ({
        _id: `${legacyWorkspaceId}:${userId}`,
        workspaceId: legacyWorkspaceId,
        userId,
        role,
        joinedAt: workspace.createdAt
      }));
      await database.withTransaction(async (session) => {
        await mongoDatabase.collection<WorkspaceDocument>("workspaces").insertOne(workspace, { session });
        if (memberships.length > 0) {
          await mongoDatabase.collection<WorkspaceMembershipDocument>("workspace_memberships")
            .insertMany(memberships, { session });
        }
      });
      logger.info("Migrated the previous configured workspace into database-backed membership.");
    }
  }
  logger.info("Workspace persistence schema and indexes are ready.");
} finally {
  await database.disconnect();
}
