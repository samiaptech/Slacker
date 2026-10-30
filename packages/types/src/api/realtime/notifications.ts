export type NotificationType =
  | "channel_message"
  | "direct_message"
  | "channel_thread_reply"
  | "mention"
  | "channel_member_joined"
  | "channel_member_left"
  | "channel_updated";

export type NotificationResource = Readonly<{
  type: "channel" | "direct_message";
  id: string;
}>;

export type NotificationResponse = Readonly<{
  id: string;
  eventId: string;
  type: NotificationType;
  workspaceId: string;
  resource: NotificationResource;
  actor: Readonly<{ id: string; name: string }>;
  createdAt: string;
  readAt: string | null;
  threadRootId?: string;
}>;

export type NotificationListResponse = Readonly<{
  notifications: readonly NotificationResponse[];
  nextCursor: string | null;
}>;
