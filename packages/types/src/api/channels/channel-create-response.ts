import type { ChatAttachmentResponse } from "../chat/index.js";

export type ChannelResponse = Readonly<{
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  visibility: "public" | "private";
  lifecycleState: "active" | "archived";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}>;

export type ChannelCreateResponse = Readonly<{
  channel: ChannelResponse;
  creatorMembership: Readonly<{
    channelId: string;
    userId: string;
    role: "admin";
    joinedAt: string;
  }>;
}>;

export type ChannelMembershipResponse = Readonly<{
  channelId: string;
  userId: string;
  role: "admin" | "member";
  joinedAt: string;
}>;

export type ChannelJoinResponse = Readonly<{
  membership: ChannelMembershipResponse;
}>;

export type ChannelMemberResponse = ChannelMembershipResponse & Readonly<{
  name: string | null;
  email: string | null;
  image: string | null;
}>;

export type ChannelMembersResponse = Readonly<{
  members: readonly ChannelMemberResponse[];
  canManage: boolean;
}>;

export type ChannelMemberMutationResponse = Readonly<{
  membership: ChannelMembershipResponse;
  alreadyMember: boolean;
}>;

export type ChannelListResponse = Readonly<{
  channels: readonly ChannelResponse[];
  nextCursor: string | null;
}>;

export type ChannelMessageResponse = Readonly<{
  id: string;
  channelId: string;
  senderId: string;
  type?: "message";
  text: string;
  createdAt: string;
  attachments?: readonly ChatAttachmentResponse[];
  sender: Readonly<{
    id: string;
    name: string;
    image: string | null;
  }>;
}>;

export type ChannelSystemEventResponse = Readonly<{
  id: string;
  channelId: string;
  type: "system";
  systemEvent: "member_left";
  actor: Readonly<{ id: string; name: string }>;
  text: "";
  createdAt: string;
}>;

export type ChannelHistoryEntryResponse = ChannelMessageResponse | ChannelSystemEventResponse;

export type ChannelMessageListResponse = Readonly<{
  messages: readonly ChannelHistoryEntryResponse[];
  nextCursor: string | null;
}>;
