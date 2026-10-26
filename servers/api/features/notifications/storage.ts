import type { NotificationDocument, NotificationResource } from "./model.js";

export type NotificationEvent = Readonly<{
  eventId: string;
  workspaceId: string;
  resource: NotificationResource;
  type: NotificationDocument["type"];
  actor: Readonly<{ id: string; name: string }>;
  createdAt: Date;
}>;

export type NotificationStorage = Readonly<{
  initialize: () => Promise<void>;
  createForChannel: (event: NotificationEvent, mentionedUserIds: readonly string[]) => Promise<readonly NotificationDocument[]>;
  createForDirectMessage: (event: NotificationEvent) => Promise<readonly NotificationDocument[]>;
  listForUser: (userId: string, limit: number, before: NotificationDocument | null) => Promise<readonly NotificationDocument[]>;
  unreadCount: (userId: string) => Promise<number>;
  markRead: (userId: string, notificationId: string, readAt: Date) => Promise<boolean>;
  markResourceRead: (userId: string, resource: NotificationResource, readAt: Date) => Promise<number>;
  findCursor: (userId: string, notificationId: string) => Promise<NotificationDocument | null>;
}>;
