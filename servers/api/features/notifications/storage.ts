import type { NotificationDocument, NotificationResource } from "./model.js";

export type NotificationEvent = Readonly<{
  eventId: string;
  workspaceId: string;
  resource: NotificationResource;
  type: NotificationDocument["type"];
  actor: Readonly<{ id: string; name: string }>;
  createdAt: Date;
  threadRootId?: string;
}>;

export type NotificationStorage = Readonly<{
  initialize: () => Promise<void>;
  createForChannel: (event: NotificationEvent, mentionedUserIds: readonly string[]) => Promise<readonly NotificationDocument[]>;
  createForChannelThreadReply: (
    event: NotificationEvent,
    rootMessageId: string,
    mentionedUserIds: readonly string[]
  ) => Promise<readonly NotificationDocument[]>;
  createForDirectMessage: (event: NotificationEvent) => Promise<readonly NotificationDocument[]>;
  listForUser: (userId: string, limit: number, before: NotificationDocument | null) => Promise<readonly NotificationDocument[]>;
  unreadCount: (userId: string) => Promise<number>;
  markRead: (userId: string, notificationId: string, readAt: Date) => Promise<boolean>;
  markResourceRead: (userId: string, resource: NotificationResource, readAt: Date) => Promise<number>;
  markThreadRead: (userId: string, channelId: string, rootMessageId: string, readAt: Date) => Promise<number>;
  findCursor: (userId: string, notificationId: string) => Promise<NotificationDocument | null>;
}>;
