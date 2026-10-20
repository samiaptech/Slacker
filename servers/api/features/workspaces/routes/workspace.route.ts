import type { IncomingHttpHeaders } from "node:http";
import { Router } from "express";
import {
  createAcceptWorkspaceInviteController,
  createChangeWorkspaceMemberRoleController,
  createListWorkspaceMembersController,
  createListWorkspacesController,
  createWorkspaceMemberProfileController,
  createWorkspaceSettingsController,
  createWorkspaceAccessController,
  createWorkspaceController,
  createWorkspaceInviteLinkController,
  createRemoveWorkspaceMemberController
} from "../controllers/index.js";
import type { WorkspaceIdentity, WorkspaceService } from "../services/index.js";
import type { WorkspaceRealtimeNotifications } from "../controllers/index.js";

export type WorkspaceRouteDependencies = Readonly<{
  getIdentity: (headers: IncomingHttpHeaders) => Promise<WorkspaceIdentity | null>;
  service: WorkspaceService;
  realtime?: WorkspaceRealtimeNotifications;
}>;

export const createWorkspaceRoutes = ({ service, getIdentity, realtime }: WorkspaceRouteDependencies): Router => {
  const router = Router();
  const dependencies = { getIdentity, service, ...(realtime ? { realtime } : {}) };
  router.get("/workspaces", createListWorkspacesController(dependencies));
  router.get("/workspace/members", createListWorkspaceMembersController(dependencies));
  router.get("/workspace/members/:userId", createWorkspaceMemberProfileController(dependencies));
  router.post("/workspaces", createWorkspaceController(dependencies));
  router.patch("/workspaces/:workspaceId/settings", createWorkspaceSettingsController(dependencies));
  router.patch(
    "/workspaces/:workspaceId/members/:userId",
    createChangeWorkspaceMemberRoleController(dependencies)
  );
  router.delete(
    "/workspaces/:workspaceId/members/:userId",
    createRemoveWorkspaceMemberController(dependencies)
  );
  router.post("/workspaces/:workspaceId/invite-links", createWorkspaceInviteLinkController(dependencies));
  router.post("/workspace-invitations/:token/accept", createAcceptWorkspaceInviteController(dependencies));
  router.get("/workspace", createWorkspaceAccessController(dependencies));
  return router;
};
