export type LegacyWorkspaceAccount = Readonly<{ _id: string; email: string }>;
export type LegacyWorkspaceMemberSeed = Readonly<{
  userId: string;
  role: "admin" | "member";
}>;
export type LegacyWorkspaceMemberMigration = Readonly<{
  adminUserId: string;
  memberships: readonly LegacyWorkspaceMemberSeed[];
}>;

export const resolveLegacyWorkspaceMembers = (
  allowedEmails: readonly string[],
  accounts: readonly LegacyWorkspaceAccount[],
  channelMemberIds: readonly string[]
): LegacyWorkspaceMemberMigration => {
  const accountByEmail = new Map(accounts.map((account) => [account.email.trim().toLowerCase(), account]));
  const allowlistedUserIds = [...new Set(allowedEmails.flatMap((email) => {
    const account = accountByEmail.get(email);
    return account ? [account._id] : [];
  }))];
  const channelUserIds = [...new Set(channelMemberIds)].sort();
  const workspaceUserIds = [...new Set([...allowlistedUserIds, ...channelUserIds])];
  const adminUserId = allowlistedUserIds[0] ?? channelUserIds[0];
  if (!adminUserId) {
    throw new Error(
      "Legacy workspace migration found no existing member accounts. Preserve LEGACY_WORKSPACE_ALLOWED_EMAILS and ensure at least one listed account exists, or seed a legacy channel membership."
    );
  }
  return Object.freeze({
    adminUserId,
    memberships: Object.freeze(workspaceUserIds.map((userId) => Object.freeze({
      userId,
      role: userId === adminUserId ? "admin" as const : "member" as const
    })))
  });
};
