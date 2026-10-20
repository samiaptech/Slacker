import { createWorkspaceRepository, createWorkspaceService } from "../features/workspaces/index.js";
import type {
  WorkspaceDocument,
  WorkspaceInviteLinkDocument,
  WorkspaceMembershipDocument,
  WorkspaceStorage
} from "../features/workspaces/index.js";

export const createWorkspaceServiceFixture = (
  workspaceMembershipUnavailable = false,
  ensureGeneralChannel: (workspaceId: string, userId: string) => Promise<"ready" | "unavailable"> = () =>
    Promise.resolve("ready")
) => {
  const workspaces = new Map<string, WorkspaceDocument>();
  const memberships = new Map<string, WorkspaceMembershipDocument>();
  const inviteLinks = new Map<string, WorkspaceInviteLinkDocument>();
  const storage: WorkspaceStorage = {
    initialize: () => Promise.resolve(),
    withTransaction: async (operation) => {
      const stagedWorkspaces: WorkspaceDocument[] = [];
      const stagedMemberships: WorkspaceMembershipDocument[] = [];
      const stagedInvites: WorkspaceInviteLinkDocument[] = [];
      const result = await operation({
        insertWorkspace: (workspace) => { stagedWorkspaces.push(workspace); return Promise.resolve(); },
        insertMembership: (membership) => { stagedMemberships.push(membership); return Promise.resolve(); },
        insertInviteLink: (invite) => { stagedInvites.push(invite); return Promise.resolve(); }
      });
      for (const workspace of stagedWorkspaces) workspaces.set(workspace._id, workspace);
      for (const membership of stagedMemberships) memberships.set(`${membership.workspaceId}:${membership.userId}`, membership);
      for (const invite of stagedInvites) inviteLinks.set(invite.tokenHash, invite);
      return result;
    },
    listMemberships: (userId) => Promise.resolve([...memberships.values()].filter((membership) => membership.userId === userId)),
    listWorkspaceMemberships: (workspaceId) => Promise.resolve(
      [...memberships.values()].filter((membership) => membership.workspaceId === workspaceId)
    ),
    findWorkspace: (workspaceId) => Promise.resolve(workspaces.get(workspaceId) ?? null),
    setMemberEmailsVisible: (workspaceId, visible) => {
      const workspace = workspaces.get(workspaceId);
      if (!workspace) return Promise.resolve(false);
      workspaces.set(workspaceId, { ...workspace, memberEmailsVisible: visible });
      return Promise.resolve(true);
    },
    changeMemberRole: (workspaceId, actorId, memberId, role) => {
      const actor = memberships.get(`${workspaceId}:${actorId}`);
      const targetKey = `${workspaceId}:${memberId}`;
      const target = memberships.get(targetKey);
      if (!actor || actor.role !== "admin" || actorId === memberId) return Promise.resolve("denied");
      if (!target) return Promise.resolve("not-found");
      if (target.role === "admin" && role === "member"
        && [...memberships.values()].filter((membership) =>
          membership.workspaceId === workspaceId && membership.role === "admin").length <= 1) {
        return Promise.resolve("last-admin");
      }
      memberships.set(targetKey, { ...target, role });
      return Promise.resolve("updated");
    },
    removeMember: (workspaceId, actorId, memberId) => {
      const actor = memberships.get(`${workspaceId}:${actorId}`);
      const targetKey = `${workspaceId}:${memberId}`;
      const target = memberships.get(targetKey);
      if (!actor || actor.role !== "admin" || actorId === memberId) return Promise.resolve("denied");
      if (!target) return Promise.resolve("not-found");
      if (target.role === "admin"
        && [...memberships.values()].filter((membership) =>
          membership.workspaceId === workspaceId && membership.role === "admin").length <= 1) {
        return Promise.resolve("last-admin");
      }
      memberships.delete(targetKey);
      return Promise.resolve("removed");
    },
    findMembership: (workspaceId, userId) => workspaceMembershipUnavailable
      ? Promise.reject(Object.assign(new Error("Workspace storage is unavailable."), {
        kind: "workspace-storage-unavailable" as const
      }))
      : Promise.resolve(memberships.get(`${workspaceId}:${userId}`) ?? null),
    findInviteLink: (tokenHash, at) => {
      const invite = inviteLinks.get(tokenHash);
      return Promise.resolve(invite && invite.expiresAt > at ? invite : null);
    },
    createMembershipFromInvite: (invite, userId, joinedAt) => {
      const key = `${invite.workspaceId}:${userId}`;
      if (memberships.has(key)) return Promise.resolve("already-member");
      memberships.set(key, {
        _id: key,
        workspaceId: invite.workspaceId,
        userId,
        role: "member",
        joinedAt
      });
      return Promise.resolve("joined");
    }
  };
  let id = 0;
  const service = createWorkspaceService({
    repository: createWorkspaceRepository(storage),
    createId: () => `workspace-${String(++id)}`,
    createInviteToken: () => `test-invite-token-${String(++id)}-abcdefghijklmnopqrstuvwxyz`,
    now: () => new Date("2026-10-14T00:00:00.000Z"),
    webOrigin: "http://localhost:3000",
    ensureGeneralChannel,
    findUsersByIds: (userIds) => Promise.resolve(userIds.map((userId) => ({
      id: userId,
      name: `User ${userId}`,
      title: null,
      email: `${userId}@example.test`,
      image: null
    })))
  });
  const seed = (workspaceId: string, userIds: readonly string[], role: "admin" | "member" = "member"): void => {
    const createdAt = new Date("2026-10-13T00:00:00.000Z");
    workspaces.set(workspaceId, {
      _id: workspaceId,
      name: `Workspace ${workspaceId}`,
      createdBy: userIds[0] ?? "admin",
      createdAt
    });
    for (const userId of userIds) {
      memberships.set(`${workspaceId}:${userId}`, {
        _id: `${workspaceId}:${userId}`,
        workspaceId,
        userId,
        role: userId === userIds[0] ? "admin" : role,
        joinedAt: createdAt
      });
    }
  };
  return Object.freeze({ service, seed, workspaces, memberships, inviteLinks });
};
