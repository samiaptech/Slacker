export type WorkspaceMembershipSummary = Readonly<{
  id: string;
  name: string;
  role: "admin" | "member";
}>;

export type WorkspaceListResponse = Readonly<{
  workspaces: readonly WorkspaceMembershipSummary[];
}>;

export type WorkspaceMutationResponse = Readonly<{
  workspace: WorkspaceMembershipSummary;
}>;

export type WorkspaceInviteLinkResponse = Readonly<{
  inviteUrl: string;
  expiresAt: string;
}>;

export type WorkspaceInvitationAcceptanceResponse = Readonly<{
  workspace: Readonly<{ id: string; name: string }>;
  alreadyMember: boolean;
}>;

export type WorkspaceMemberResponse = Readonly<{
  id: string;
  name: string | null;
  title: string | null;
  email: string | null;
  image: string | null;
  role: "admin" | "member";
  joinedAt: string;
}>;

export type WorkspaceMembersResponse = Readonly<{
  members: readonly WorkspaceMemberResponse[];
  memberEmailsVisible: boolean;
}>;

export type WorkspaceMemberProfileResponse = Readonly<{
  member: WorkspaceMemberResponse;
}>;

export type WorkspaceEmailVisibilityResponse = Readonly<{
  memberEmailsVisible: boolean;
}>;

export type WorkspaceMemberRoleResponse = Readonly<{
  userId: string;
  role: "admin" | "member";
}>;
