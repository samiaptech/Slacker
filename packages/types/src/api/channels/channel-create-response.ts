import type { ChatAttachmentResponse, MessageReactionResponse } from "../chat/index.js";

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

export type ChannelMentionMemberResponse = Readonly<{
  id: string;
  name: string;
  image: string | null;
}>;

export type ChannelMentionMembersResponse = Readonly<{
  members: readonly ChannelMentionMemberResponse[];
}>;

export type ChannelNotificationPreference = "all" | "mentions_only" | "muted";

export type ChannelNotificationPreferenceResponse = Readonly<{
  preference: ChannelNotificationPreference;
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
  editedAt?: string | null;
  attachments?: readonly ChatAttachmentResponse[];
  reactions: readonly MessageReactionResponse[];
  threadRootId?: string | null;
  thread?: ChannelThreadSummaryResponse | null;
  sender: Readonly<{
    id: string;
    name: string;
    image: string | null;
  }>;
}>;

export type ChannelThreadSummaryResponse = Readonly<{
  replyCount: number;
  lastReplyAt: string;
}>;

export type ChannelThreadResponse = Readonly<{
  root: ChannelMessageResponse;
  replies: readonly ChannelMessageResponse[];
  nextCursor: string | null;
}>;

export type ChannelThreadReplyResponse = Readonly<{
  reply: ChannelMessageResponse;
  thread: ChannelThreadSummaryResponse;
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
