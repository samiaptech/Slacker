export const CHANNEL_VISIBILITIES = ["public", "private"] as const;
export type ChannelVisibility = (typeof CHANNEL_VISIBILITIES)[number];

export const CHANNEL_LIFECYCLE_STATES = ["active", "archived"] as const;
export type ChannelLifecycleState = (typeof CHANNEL_LIFECYCLE_STATES)[number];

export const CHANNEL_MEMBERSHIP_ROLES = ["admin", "member"] as const;
export type ChannelMembershipRole = (typeof CHANNEL_MEMBERSHIP_ROLES)[number];

export type Channel = Readonly<{
  id: string;
  workspaceId: string;
  /** Canonical lowercase channel name, limited to ASCII letters, digits, hyphens, and underscores. */
  name: string;
  description: string | null;
  visibility: ChannelVisibility;
  lifecycleState: ChannelLifecycleState;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}>;

export type ChannelMembership = Readonly<{
  channelId: string;
  userId: string;
  role: ChannelMembershipRole;
  joinedAt: Date;
}>;
