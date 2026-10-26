import type {
  NotificationDocument,
  NotificationRecord,
  NotificationResource,
  NotificationType
} from "./model.js";
import type { NotificationEvent, NotificationStorage } from "./storage.js";

export const NOTIFICATION_PAGE_SIZE_DEFAULT = 30;
export const NOTIFICATION_PAGE_SIZE_MAX = 100;
export const isNotificationStorageUnavailable = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "kind" in error
  && error.kind === "notification-storage-unavailable";
export type NotificationRealtimePublisher = Readonly<{
  publishNew: (userId: string, notification: NotificationRecord) => void;
  publishUnreadCount: (userId: string, unreadCount: number) => void;
}>;
export type NotificationService = ReturnType<typeof createNotificationService>;

type NotificationServiceDependencies = Readonly<{
  storage: NotificationStorage;
  createId: () => string;
  now: () => Date;
  realtime?: NotificationRealtimePublisher;
}>;

const toRecord = (document: NotificationDocument): NotificationRecord => Object.freeze({
  id: document._id,
  eventId: document.eventId,
  recipientId: document.recipientId,
  workspaceId: document.workspaceId,
  type: document.type,
  resource: Object.freeze({ type: document.resourceType, id: document.resourceId }),
  actor: Object.freeze({ id: document.actorId, name: document.actorName }),
  createdAt: document.createdAt,
  readAt: document.readAt
});

export const encodeNotificationCursor = (notification: NotificationRecord): string =>
  Buffer.from(JSON.stringify({
    createdAt: notification.createdAt.toISOString(),
    id: notification.id
  }), "utf8").toString("base64url");

const decodeNotificationCursor = (cursor: string): Readonly<{ createdAt: Date; id: string }> | null => {
  if (!cursor || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || !("createdAt" in parsed)
      || !("id" in parsed) || typeof parsed.createdAt !== "string"
      || typeof parsed.id !== "string" || parsed.id.length === 0) return null;
    const createdAt = new Date(parsed.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== parsed.createdAt) return null;
    return Object.freeze({ createdAt, id: parsed.id });
  } catch {
    return null;
  }
};

const mentionedUserIds = (text: string): readonly string[] =>
  Object.freeze([...new Set([...text.matchAll(/@\[([^\]\s]{1,128})\]/g)]
    .map(([, userId]) => userId)
    .filter((userId): userId is string => Boolean(userId)))]);

export const createNotificationService = ({
  storage,
  createId,
  now,
  realtime
}: NotificationServiceDependencies) => {
  const publish = async (documents: readonly NotificationDocument[]): Promise<void> => {
    const records = documents.map(toRecord);
    for (const record of records) realtime?.publishNew(record.recipientId, record);
    for (const userId of new Set(records.map(({ recipientId }) => recipientId))) {
      realtime?.publishUnreadCount(userId, await storage.unreadCount(userId));
    }
  };
  const createEvent = (
    workspaceId: string,
    resource: NotificationResource,
    type: NotificationType,
    actor: Readonly<{ id: string; name: string }>,
    eventId?: string,
    createdAt?: Date
  ): NotificationEvent => Object.freeze({
    eventId: eventId ?? createId(),
    workspaceId,
    resource,
    type,
    actor: Object.freeze({
      id: actor.id,
      name: actor.name.trim().slice(0, 128) || "Former member"
    }),
    createdAt: createdAt ?? now()
  });

  return Object.freeze({
    initialize: storage.initialize,
    notifyChannelMessage: async (input: Readonly<{
      workspaceId: string;
      channelId: string;
      messageId: string;
      actor: Readonly<{ id: string; name: string }>;
      text: string;
      createdAt: Date;
    }>): Promise<void> => {
      const event = createEvent(
        input.workspaceId,
        { type: "channel", id: input.channelId },
        "channel_message",
        input.actor,
        input.messageId,
        input.createdAt
      );
      await publish(await storage.createForChannel(event, mentionedUserIds(input.text)));
    },
    notifyChannelActivity: async (input: Readonly<{
      workspaceId: string;
      channelId: string;
      type: "channel_member_joined" | "channel_member_left" | "channel_updated";
      actor: Readonly<{ id: string; name: string }>;
      eventId?: string;
      createdAt?: Date;
    }>): Promise<void> => {
      const event = createEvent(
        input.workspaceId,
        { type: "channel", id: input.channelId },
        input.type,
        input.actor,
        input.eventId,
        input.createdAt
      );
      await publish(await storage.createForChannel(event, []));
    },
    notifyDirectMessage: async (input: Readonly<{
      workspaceId: string;
      conversationId: string;
      messageId: string;
      actor: Readonly<{ id: string; name: string }>;
      createdAt: Date;
    }>): Promise<void> => {
      const event = createEvent(
        input.workspaceId,
        { type: "direct_message", id: input.conversationId },
        "direct_message",
        input.actor,
        input.messageId,
        input.createdAt
      );
      await publish(await storage.createForDirectMessage(event));
    },
    list: async (userId: string, limit: number, cursorValue?: string) => {
      const cursor = cursorValue ? decodeNotificationCursor(cursorValue) : null;
      if (cursorValue && !cursor) return Object.freeze({ kind: "invalid-cursor" as const });
      const before = cursor
        ? await storage.findCursor(userId, cursor.id)
        : null;
      if (cursor && !before) return Object.freeze({ kind: "invalid-cursor" as const });
      const documents = await storage.listForUser(userId, limit, before);
      const hasMore = documents.length > limit;
      const records = documents.slice(0, limit).map(toRecord);
      const last = records.at(-1);
      return Object.freeze({
        kind: "listed" as const,
        notifications: Object.freeze(records),
        nextCursor: hasMore && last ? encodeNotificationCursor(last) : null
      });
    },
    unreadCount: (userId: string): Promise<number> => storage.unreadCount(userId),
    markRead: async (userId: string, notificationId: string) => {
      const marked = await storage.markRead(userId, notificationId, now());
      if (!marked) return Object.freeze({ kind: "not-found" as const });
      realtime?.publishUnreadCount(userId, await storage.unreadCount(userId));
      return Object.freeze({ kind: "marked" as const });
    },
    markResourceRead: async (userId: string, resource: NotificationResource): Promise<void> => {
      await storage.markResourceRead(userId, resource, now());
      realtime?.publishUnreadCount(userId, await storage.unreadCount(userId));
    }
  });
};
