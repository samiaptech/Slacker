import type {
  WorkspaceDocument,
  WorkspaceInviteLinkDocument,
  WorkspaceMembershipDocument
} from "../models/index.js";

export type WorkspaceRecord = Readonly<{ id: string; name: string; createdAt: Date }>;
export type WorkspaceMembership = Readonly<{
  workspaceId: string;
  userId: string;
  role: "admin" | "member";
  joinedAt: Date;
}>;

export type WorkspaceWriteTransaction = Readonly<{
  insertWorkspace: (workspace: WorkspaceDocument) => Promise<void>;
  insertMembership: (membership: WorkspaceMembershipDocument) => Promise<void>;
  insertInviteLink: (inviteLink: WorkspaceInviteLinkDocument) => Promise<void>;
}>;

export type WorkspaceStorageUnavailableError = Readonly<{ kind: "workspace-storage-unavailable" }>;
export type WorkspaceMemberMutationResult =
  | "updated"
  | "removed"
  | "not-found"
  | "last-admin"
  | "denied";
export type WorkspaceStorage = Readonly<{
  initialize: () => Promise<void>;
  withTransaction: <Result>(operation: (transaction: WorkspaceWriteTransaction) => Promise<Result>) => Promise<Result>;
  listMemberships: (userId: string) => Promise<readonly WorkspaceMembershipDocument[]>;
  listWorkspaceMemberships: (workspaceId: string) => Promise<readonly WorkspaceMembershipDocument[]>;
  findWorkspace: (workspaceId: string) => Promise<WorkspaceDocument | null>;
  setMemberEmailsVisible: (workspaceId: string, visible: boolean) => Promise<boolean>;
  changeMemberRole: (
    workspaceId: string,
    actorId: string,
    memberId: string,
    role: "admin" | "member"
  ) => Promise<WorkspaceMemberMutationResult>;
  removeMember: (
    workspaceId: string,
    actorId: string,
    memberId: string
  ) => Promise<WorkspaceMemberMutationResult>;
  findMembership: (workspaceId: string, userId: string) => Promise<WorkspaceMembershipDocument | null>;
  findInviteLink: (tokenHash: string, now: Date) => Promise<WorkspaceInviteLinkDocument | null>;
  createMembershipFromInvite: (
    invite: WorkspaceInviteLinkDocument,
    userId: string,
    joinedAt: Date
  ) => Promise<"joined" | "already-member" | "unavailable">;
}>;

export type WorkspaceRepository = ReturnType<typeof createWorkspaceRepository>;
export type WorkspaceServiceResult<T> =
  | Readonly<{ kind: "success"; value: T }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "not-found" }>;

export const createWorkspaceRepository = (storage: WorkspaceStorage) => Object.freeze({
  create: async (workspace: WorkspaceDocument, membership: WorkspaceMembershipDocument): Promise<void> =>
    storage.withTransaction(async (transaction) => {
      await transaction.insertWorkspace(workspace);
      await transaction.insertMembership(membership);
    }),
  listForUser: (userId: string): Promise<readonly WorkspaceMembershipDocument[]> => storage.listMemberships(userId),
  listForWorkspace: (workspaceId: string): Promise<readonly WorkspaceMembershipDocument[]> =>
    storage.listWorkspaceMemberships(workspaceId),
  findWorkspace: (workspaceId: string): Promise<WorkspaceDocument | null> => storage.findWorkspace(workspaceId),
  setMemberEmailsVisible: (workspaceId: string, visible: boolean): Promise<boolean> =>
    storage.setMemberEmailsVisible(workspaceId, visible),
  changeMemberRole: (workspaceId: string, actorId: string, memberId: string, role: "admin" | "member") =>
    storage.changeMemberRole(workspaceId, actorId, memberId, role),
  removeMember: (workspaceId: string, actorId: string, memberId: string) =>
    storage.removeMember(workspaceId, actorId, memberId),
  findMembership: (workspaceId: string, userId: string): Promise<WorkspaceMembershipDocument | null> =>
    storage.findMembership(workspaceId, userId),
  findInviteLink: (tokenHash: string, now: Date): Promise<WorkspaceInviteLinkDocument | null> =>
    storage.findInviteLink(tokenHash, now),
  createInviteLink: (inviteLink: WorkspaceInviteLinkDocument): Promise<void> =>
    storage.withTransaction((transaction) => transaction.insertInviteLink(inviteLink)),
  acceptInvite: (
    invite: WorkspaceInviteLinkDocument,
    userId: string,
    joinedAt: Date
  ): Promise<"joined" | "already-member" | "unavailable"> => storage.createMembershipFromInvite(invite, userId, joinedAt)
});
