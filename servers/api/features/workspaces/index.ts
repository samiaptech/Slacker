export { createWorkspaceRoutes } from "./routes/index.js";
export type { WorkspaceRouteDependencies } from "./routes/index.js";
export { createWorkspaceService, WORKSPACE_INVITE_LIFETIME_MS } from "./services/index.js";
export type {
  WorkspaceAccessResult,
  WorkspaceCreateResult,
  WorkspaceInviteAcceptanceResult,
  WorkspaceInviteLinkResult,
  WorkspaceIdentity,
  WorkspaceListResult,
  WorkspaceMemberSummary,
  WorkspaceMemberRemovalResult,
  WorkspaceMemberRoleResult,
  WorkspaceMemberProfileResult,
  WorkspaceEmailVisibilityResult,
  WorkspaceMembersResult,
  WorkspaceService,
  WorkspaceServiceDependencies
} from "./services/index.js";
export type { WorkspaceRealtimeNotifications } from "./controllers/index.js";
export { createMongoWorkspaceStorage } from "./integrations/index.js";
export { createWorkspaceRepository } from "./repositories/index.js";
export type {
  WorkspaceMemberMutationResult,
  WorkspaceRepository,
  WorkspaceStorage
} from "./repositories/index.js";
export {
  WORKSPACE_COLLECTION_VALIDATORS,
  WORKSPACE_INDEXES,
  WORKSPACE_INVITE_LINKS_COLLECTION,
  WORKSPACE_MEMBERSHIPS_COLLECTION,
  WORKSPACES_COLLECTION
} from "./models/index.js";
export type {
  WorkspaceDocument,
  WorkspaceInviteLinkDocument,
  WorkspaceMembershipDocument
} from "./models/index.js";
