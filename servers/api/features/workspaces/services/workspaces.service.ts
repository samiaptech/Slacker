import { createHash } from "node:crypto";
import type { WorkspaceDocument, WorkspaceInviteLinkDocument, WorkspaceMembershipDocument } from "../models/index.js";
import type { WorkspaceMemberMutationResult as WorkspaceRepositoryMemberMutationResult, WorkspaceRepository } from "../repositories/index.js";

export const WORKSPACE_INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type WorkspaceIdentity = Readonly<{
  id: string;
  name: string;
  title?: string | null;
  email: string;
  image: string | null;
}>;

export type WorkspaceSummary = Readonly<{ id: string; name: string; role: "admin" | "member" }>;
export type WorkspaceMemberSummary = Readonly<{
  id: string;
  name: string | null;
  title: string | null;
  email: string | null;
  image: string | null;
  role: "admin" | "member";
  joinedAt: Date;
}>;

export type WorkspaceAccessResult =
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "allowed"; access: Readonly<{
      workspace: Readonly<{ id: string; name: string; role: "admin" | "member" }>;
      user: WorkspaceIdentity;
    }> }>;

export type WorkspaceServiceDependencies = Readonly<{
  repository: WorkspaceRepository;
  createId: () => string;
  createInviteToken: () => string;
  now: () => Date;
  webOrigin: string;
  findUsersByIds: (userIds: readonly string[]) => Promise<readonly WorkspaceIdentity[]>;
  ensureGeneralChannel: (workspaceId: string, userId: string) => Promise<"ready" | "unavailable">;
}>;

export type WorkspaceListResult =
  | Readonly<{ kind: "listed"; workspaces: readonly WorkspaceSummary[] }>
  | Readonly<{ kind: "unavailable" }>;

export type WorkspaceMembersResult =
  | Readonly<{ kind: "listed"; members: readonly WorkspaceMemberSummary[]; memberEmailsVisible: boolean }>
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "unavailable" }>;

export type WorkspaceMemberProfileResult =
  | Readonly<{ kind: "found"; member: WorkspaceMemberSummary }>
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "unavailable" }>;

export type WorkspaceEmailVisibilityResult =
  | Readonly<{ kind: "updated"; memberEmailsVisible: boolean }>
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "unavailable" }>;

export type WorkspaceMemberEmailAccessResult =
  | Readonly<{ kind: "allowed"; visible: boolean }>
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "unavailable" }>;

export type WorkspaceMemberRoleResult =
  | Readonly<{ kind: "updated"; role: "admin" | "member" }>
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "last-admin" }>
  | Readonly<{ kind: "unavailable" }>;

export type WorkspaceMemberRemovalResult =
  | Readonly<{ kind: "removed" }>
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "last-admin" }>
  | Readonly<{ kind: "unavailable" }>;

export type WorkspaceCreateResult =
  | Readonly<{ kind: "created"; workspace: WorkspaceSummary }>
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "channel-unavailable" }>
  | Readonly<{ kind: "unavailable" }>;

export type WorkspaceInviteLinkResult =
  | Readonly<{ kind: "created"; url: string; expiresAt: Date }>
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "unavailable" }>;

export type WorkspaceInviteAcceptanceResult =
  | Readonly<{ kind: "joined" | "already-member"; workspace: Readonly<{ id: string; name: string }> }>
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "channel-unavailable" }>
  | Readonly<{ kind: "unavailable" }>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isWorkspaceStorageUnavailable = (error: unknown): boolean =>
  isRecord(error) && error.kind === "workspace-storage-unavailable";

const normalizeName = (name: string): string => name.trim().replace(/\s+/g, " ");

const toSummary = (workspace: WorkspaceDocument, membership: WorkspaceMembershipDocument): WorkspaceSummary =>
  Object.freeze({ id: workspace._id, name: workspace.name, role: membership.role });

export const createWorkspaceService = ({
  repository,
  createId,
  createInviteToken,
  now,
  webOrigin,
  findUsersByIds,
  ensureGeneralChannel
}: WorkspaceServiceDependencies) => Object.freeze({
  listForUser: async (userId: string): Promise<WorkspaceListResult> => {
    try {
      const memberships = await repository.listForUser(userId);
      const resolvedWorkspaces = await Promise.all(memberships.map((membership) => repository.findWorkspace(membership.workspaceId)));
      const workspaces = memberships.flatMap((membership, index) => {
        const workspace = resolvedWorkspaces[index];
        if (!workspace) throw new Error("Workspace membership refers to a missing workspace.");
        return [toSummary(workspace, membership)];
      });
      return Object.freeze({ kind: "listed", workspaces: Object.freeze(workspaces) });
    } catch (error: unknown) {
      if (isWorkspaceStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  },
  listMembers: async (
    identity: WorkspaceIdentity | null,
    workspaceId: string | null
  ): Promise<WorkspaceMembersResult> => {
    if (!identity) return Object.freeze({ kind: "unauthenticated" });
    if (!workspaceId) return Object.freeze({ kind: "denied" });
    try {
      const membership = await repository.findMembership(workspaceId, identity.id);
      if (!membership) return Object.freeze({ kind: "denied" });
      const memberships = await repository.listForWorkspace(workspaceId);
      const workspace = await repository.findWorkspace(workspaceId);
      if (!workspace) return Object.freeze({ kind: "denied" });
      const users = await findUsersByIds(memberships.map((entry) => entry.userId));
      const usersById = new Map(users.map((user) => [user.id, user]));
      const memberEmailsVisible = workspace.memberEmailsVisible !== false;
      const canViewEmails = memberEmailsVisible || membership.role === "admin";
      const members = memberships.map((entry) => {
        const user = usersById.get(entry.userId);
        return Object.freeze({
          id: entry.userId,
          name: user?.name ?? null,
          title: user?.title?.trim() || null,
          email: canViewEmails ? user?.email ?? null : null,
          image: user?.image ?? null,
          role: entry.role,
          joinedAt: entry.joinedAt
        });
      });
      return Object.freeze({
        kind: "listed",
        members: Object.freeze(members),
        memberEmailsVisible
      });
    } catch (error: unknown) {
      if (isWorkspaceStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  },
  getMemberEmailVisibility: async (
    identity: WorkspaceIdentity | null,
    workspaceId: string | null
  ): Promise<WorkspaceMemberEmailAccessResult> => {
    if (!identity) return Object.freeze({ kind: "unauthenticated" });
    if (!workspaceId) return Object.freeze({ kind: "denied" });
    try {
      const [membership, workspace] = await Promise.all([
        repository.findMembership(workspaceId, identity.id),
        repository.findWorkspace(workspaceId)
      ]);
      if (!membership || !workspace) return Object.freeze({ kind: "denied" });
      return Object.freeze({
        kind: "allowed",
        visible: workspace.memberEmailsVisible !== false || membership.role === "admin"
      });
    } catch (error: unknown) {
      if (isWorkspaceStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  },
  getMemberProfile: async (
    identity: WorkspaceIdentity | null,
    workspaceId: string | null,
    memberId: string
  ): Promise<WorkspaceMemberProfileResult> => {
    if (!identity) return Object.freeze({ kind: "unauthenticated" });
    if (!workspaceId) return Object.freeze({ kind: "denied" });
    try {
      const [viewerMembership, targetMembership, workspace] = await Promise.all([
        repository.findMembership(workspaceId, identity.id),
        repository.findMembership(workspaceId, memberId),
        repository.findWorkspace(workspaceId)
      ]);
      if (!viewerMembership || !workspace) return Object.freeze({ kind: "denied" });
      if (!targetMembership) return Object.freeze({ kind: "not-found" });
      const [user] = await findUsersByIds([memberId]);
      const canViewEmail = workspace.memberEmailsVisible !== false || viewerMembership.role === "admin";
      return Object.freeze({
        kind: "found",
        member: Object.freeze({
          id: memberId,
          name: user?.name ?? null,
          title: user?.title?.trim() || null,
          email: canViewEmail ? user?.email ?? null : null,
          image: user?.image ?? null,
          role: targetMembership.role,
          joinedAt: targetMembership.joinedAt
        })
      });
    } catch (error: unknown) {
      if (isWorkspaceStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  },
  setMemberEmailsVisible: async (
    identity: WorkspaceIdentity | null,
    workspaceId: string | null,
    visible: boolean
  ): Promise<WorkspaceEmailVisibilityResult> => {
    if (!identity) return Object.freeze({ kind: "unauthenticated" });
    if (!workspaceId) return Object.freeze({ kind: "denied" });
    try {
      const membership = await repository.findMembership(workspaceId, identity.id);
      if (!membership || membership.role !== "admin") return Object.freeze({ kind: "denied" });
      const updated = await repository.setMemberEmailsVisible(workspaceId, visible);
      if (!updated) return Object.freeze({ kind: "not-found" });
      return Object.freeze({ kind: "updated", memberEmailsVisible: visible });
    } catch (error: unknown) {
      if (isWorkspaceStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  },
  changeMemberRole: async (
    identity: WorkspaceIdentity | null,
    workspaceId: string | null,
    memberId: string,
    role: "admin" | "member"
  ): Promise<WorkspaceMemberRoleResult> => {
    if (!identity) return Object.freeze({ kind: "unauthenticated" });
    if (!workspaceId) return Object.freeze({ kind: "denied" });
    try {
      const result: WorkspaceRepositoryMemberMutationResult =
        await repository.changeMemberRole(workspaceId, identity.id, memberId, role);
      if (result === "updated") return Object.freeze({ kind: "updated", role });
      if (result === "last-admin") return Object.freeze({ kind: "last-admin" });
      if (result === "not-found") return Object.freeze({ kind: "not-found" });
      return Object.freeze({ kind: "denied" });
    } catch (error: unknown) {
      if (isWorkspaceStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  },
  removeMember: async (
    identity: WorkspaceIdentity | null,
    workspaceId: string | null,
    memberId: string
  ): Promise<WorkspaceMemberRemovalResult> => {
    if (!identity) return Object.freeze({ kind: "unauthenticated" });
    if (!workspaceId) return Object.freeze({ kind: "denied" });
    try {
      const result: WorkspaceRepositoryMemberMutationResult =
        await repository.removeMember(workspaceId, identity.id, memberId);
      if (result === "removed") return Object.freeze({ kind: "removed" });
      if (result === "last-admin") return Object.freeze({ kind: "last-admin" });
      if (result === "not-found") return Object.freeze({ kind: "not-found" });
      return Object.freeze({ kind: "denied" });
    } catch (error: unknown) {
      if (isWorkspaceStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  },
  getAccess: async (identity: WorkspaceIdentity | null, workspaceId: string | null): Promise<WorkspaceAccessResult> => {
    if (!identity) return Object.freeze({ kind: "unauthenticated" });
    if (!workspaceId) return Object.freeze({ kind: "denied" });
    try {
      const [workspace, membership] = await Promise.all([
        repository.findWorkspace(workspaceId),
        repository.findMembership(workspaceId, identity.id)
      ]);
      if (!workspace || !membership) return Object.freeze({ kind: "denied" });
      return Object.freeze({
        kind: "allowed",
        access: Object.freeze({
          workspace: Object.freeze({ id: workspace._id, name: workspace.name, role: membership.role }),
          user: Object.freeze(identity)
        })
      });
    } catch (error: unknown) {
      if (isWorkspaceStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  },
  create: async (
    identity: WorkspaceIdentity | null,
    name: string
  ): Promise<WorkspaceCreateResult> => {
    if (!identity) return Object.freeze({ kind: "unauthenticated" });
    const normalizedName = normalizeName(name);
    if (normalizedName.length < 1 || normalizedName.length > 80) return Object.freeze({ kind: "invalid" });
    const createdAt = now();
    const workspace: WorkspaceDocument = Object.freeze({
      _id: createId(),
      name: normalizedName,
      createdBy: identity.id,
      createdAt
    });
    const membership: WorkspaceMembershipDocument = Object.freeze({
      _id: `${workspace._id}:${identity.id}`,
      workspaceId: workspace._id,
      userId: identity.id,
      role: "admin",
      joinedAt: createdAt
    });
    try {
      await repository.create(workspace, membership);
      if (await ensureGeneralChannel(workspace._id, identity.id) === "unavailable") {
        return Object.freeze({ kind: "channel-unavailable" });
      }
      return Object.freeze({ kind: "created", workspace: toSummary(workspace, membership) });
    } catch (error: unknown) {
      if (isWorkspaceStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  },
  createInviteLink: async (
    identity: WorkspaceIdentity | null,
    workspaceId: string
  ): Promise<WorkspaceInviteLinkResult> => {
    if (!identity) return Object.freeze({ kind: "unauthenticated" });
    try {
      const membership = await repository.findMembership(workspaceId, identity.id);
      if (!membership || membership.role !== "admin") return Object.freeze({ kind: "denied" });
      const token = createInviteToken();
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error("Invite token generator returned an invalid token.");
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + WORKSPACE_INVITE_LIFETIME_MS);
      const invite: WorkspaceInviteLinkDocument = Object.freeze({
        _id: createId(),
        workspaceId,
        createdBy: identity.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        createdAt,
        expiresAt
      });
      await repository.createInviteLink(invite);
      return Object.freeze({
        kind: "created",
        url: new URL(`/invite/${encodeURIComponent(token)}`, webOrigin).toString(),
        expiresAt
      });
    } catch (error: unknown) {
      if (isWorkspaceStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  },
  acceptInvite: async (
    identity: WorkspaceIdentity | null,
    token: string
  ): Promise<WorkspaceInviteAcceptanceResult> => {
    if (!identity) return Object.freeze({ kind: "unauthenticated" });
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return Object.freeze({ kind: "not-found" });
    try {
      const invite = await repository.findInviteLink(createHash("sha256").update(token).digest("hex"), now());
      if (!invite) return Object.freeze({ kind: "not-found" });
      const workspace = await repository.findWorkspace(invite.workspaceId);
      if (!workspace) return Object.freeze({ kind: "not-found" });
      const existingMembership = await repository.findMembership(invite.workspaceId, identity.id);
      if (!existingMembership
        && await ensureGeneralChannel(invite.workspaceId, identity.id) === "unavailable") {
        return Object.freeze({ kind: "channel-unavailable" });
      }
      const joinedAt = now();
      const result = await repository.acceptInvite(invite, identity.id, joinedAt);
      if (result === "unavailable") return Object.freeze({ kind: "unavailable" });
      return Object.freeze({
        kind: result,
        workspace: Object.freeze({ id: workspace._id, name: workspace.name })
      });
    } catch (error: unknown) {
      if (isWorkspaceStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  },
  isMember: async (workspaceId: string, userId: string): Promise<"member" | "not-member" | "unavailable"> => {
    try {
      return await repository.findMembership(workspaceId, userId) ? "member" : "not-member";
    } catch (error: unknown) {
      if (isWorkspaceStorageUnavailable(error)) return "unavailable";
      throw error;
    }
  }
});

export type WorkspaceService = ReturnType<typeof createWorkspaceService>;
