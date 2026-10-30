import { isDeepStrictEqual } from "node:util";
import type { ChannelNotificationPreference } from "@workspace/types";
import type { MongoDatabase } from "../../integrations/mongodb/index.js";
import type { NotificationDocument } from "./model.js";
import {
  NOTIFICATIONS_COLLECTION,
  NOTIFICATIONS_COLLECTION_VALIDATOR,
  NOTIFICATIONS_INDEXES,
  type NotificationResource
} from "./model.js";
import type { NotificationEvent, NotificationStorage } from "./storage.js";

const unavailable = Object.assign(new Error("Notification storage is unavailable."), {
  kind: "notification-storage-unavailable" as const
});
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isCollectionExists = (error: unknown): boolean => isRecord(error) && error.code === 48;
const isDuplicateKey = (error: unknown): boolean => isRecord(error) && error.code === 11000;
const isChannelNotificationPreference = (value: unknown): value is ChannelNotificationPreference =>
  value === "all" || value === "mentions_only" || value === "muted";

export const createMongoNotificationStorage = (database: MongoDatabase): NotificationStorage => {
  const notifications = database.collection<NotificationDocument>(NOTIFICATIONS_COLLECTION);
  const memberships = database.collection<Readonly<{
    userId: string;
    notificationPreference?: ChannelNotificationPreference;
  }>>("channel_memberships");
  const channelMessages = database.collection<Readonly<{
    _id: string;
    senderId?: string;
  }>>("channel_messages");
  const conversations = database.collection<{
    _id: string;
    workspaceId: string;
    participantIds: readonly string[];
  }>("direct_conversations");
  let readiness: Promise<void> | null = null;
  const assertReady = async (): Promise<void> => {
    const metadata = await database.listCollections({ name: NOTIFICATIONS_COLLECTION }).next();
    const options = isRecord(metadata) && "options" in metadata && isRecord(metadata.options)
      ? metadata.options
      : null;
    if (!options || !isDeepStrictEqual(options.validator, NOTIFICATIONS_COLLECTION_VALIDATOR)) throw unavailable;
    const actualIndexes = await notifications.indexes();
    for (const expected of NOTIFICATIONS_INDEXES) {
      const actual = actualIndexes.find(({ name }) => name === expected.options.name);
      if (!actual || !isDeepStrictEqual(actual.key, expected.keys)
        || Boolean(actual.unique) !== expected.options.unique) throw unavailable;
    }
  };
  const ensureReady = async (): Promise<void> => {
    if (!readiness) readiness = assertReady();
    const current = readiness;
    try {
      await current;
    } catch (error: unknown) {
      if (readiness === current) readiness = null;
      throw error;
    }
  };
  const run = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
    try {
      await ensureReady();
      return await operation();
    } catch (error: unknown) {
      if (isRecord(error) && error.kind === "notification-storage-unavailable") throw error;
      throw unavailable;
    }
  };
  const createForRecipients = async (
    event: NotificationEvent,
    recipientIds: readonly string[],
    mentionedUserIds: readonly string[] = []
  ): Promise<readonly NotificationDocument[]> => {
    const created: NotificationDocument[] = [];
    for (const recipientId of new Set(recipientIds)) {
      if (recipientId === event.actor.id) continue;
      const notification: NotificationDocument = Object.freeze({
        _id: `${event.eventId}:${recipientId}`,
        eventId: event.eventId,
        recipientId,
        workspaceId: event.workspaceId,
        type: mentionedUserIds.includes(recipientId) ? "mention" : event.type,
        resourceType: event.resource.type,
        resourceId: event.resource.id,
        actorId: event.actor.id,
        actorName: event.actor.name,
        createdAt: event.createdAt,
        readAt: null,
        ...(event.threadRootId ? { threadRootId: event.threadRootId } : {})
      });
      try {
        const result = await notifications.updateOne(
          { recipientId, eventId: event.eventId },
          { $setOnInsert: notification },
          { upsert: true }
        );
        if (result.upsertedCount === 1) created.push(notification);
      } catch (error: unknown) {
        if (!isDuplicateKey(error)) throw error;
      }
    }
    return Object.freeze(created);
  };

  return Object.freeze({
    initialize: async (): Promise<void> => {
      try {
        await database.createCollection(NOTIFICATIONS_COLLECTION, {
          validator: NOTIFICATIONS_COLLECTION_VALIDATOR,
          validationLevel: "strict",
          validationAction: "error"
        });
      } catch (error: unknown) {
        if (!isCollectionExists(error)) throw error;
        await database.command({
          collMod: NOTIFICATIONS_COLLECTION,
          validator: NOTIFICATIONS_COLLECTION_VALIDATOR,
          validationLevel: "strict",
          validationAction: "error"
        });
      }
      for (const index of NOTIFICATIONS_INDEXES) {
        await notifications.createIndex(index.keys, index.options);
      }
    },
    createForChannel: async (event, mentionedUserIds) => {
      return run(async () => {
        const channelMembers = await memberships.find({ channelId: event.resource.id }).toArray();
        const mentioned = new Set(mentionedUserIds);
        const recipients = channelMembers.flatMap(({ userId, notificationPreference }) => {
          const preference: unknown = notificationPreference ?? "all";
          if (!isChannelNotificationPreference(preference)) throw unavailable;
          if (preference === "muted") return [];
          if (event.type !== "channel_message") return preference === "all" ? [userId] : [];
          return preference === "all" || mentioned.has(userId) ? [userId] : [];
        });
        return createForRecipients(event, recipients, mentionedUserIds);
      });
    },
    createForChannelThreadReply: async (event, rootMessageId, mentionedUserIds) => {
      return run(async () => {
        const [channelMembers, threadMessages] = await Promise.all([
          memberships.find({ channelId: event.resource.id }).toArray(),
          channelMessages.find({
            channelId: event.resource.id,
            $or: [{ _id: rootMessageId }, { threadRootId: rootMessageId }]
          }, { projection: { _id: 0, senderId: 1 } }).toArray()
        ]);
        const participants = new Set(threadMessages.flatMap(({ senderId }) =>
          senderId ? [senderId] : []));
        const mentioned = new Set(mentionedUserIds);
        const recipients = channelMembers.flatMap(({ userId, notificationPreference }) => {
          const preference: unknown = notificationPreference ?? "all";
          if (!isChannelNotificationPreference(preference) || preference === "muted") return [];
          const isMentioned = mentioned.has(userId);
          const isParticipant = participants.has(userId);
          return preference === "all" && (isParticipant || isMentioned)
            || preference === "mentions_only" && isMentioned
            ? [userId]
            : [];
        });
        return createForRecipients(event, recipients, mentionedUserIds);
      });
    },
    createForDirectMessage: async (event) => {
      return run(async () => {
        const conversation = await conversations.findOne({
          _id: event.resource.id,
          workspaceId: event.workspaceId
        });
        return createForRecipients(event, conversation?.participantIds ?? []);
      });
    },
    listForUser: async (userId, limit, before) => {
      return run(async () => {
        const filter = before
          ? {
            recipientId: userId,
            $or: [
              { createdAt: { $lt: before.createdAt } },
              { createdAt: before.createdAt, _id: { $lt: before._id } }
            ]
          }
          : { recipientId: userId };
        return notifications.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).toArray();
      });
    },
    unreadCount: async (userId) => run(() =>
      notifications.countDocuments({ recipientId: userId, readAt: null })),
    markRead: async (userId, notificationId, readAt) => {
      return run(async () => {
        const result = await notifications.updateOne(
          { _id: notificationId, recipientId: userId, readAt: null },
          { $set: { readAt } }
        );
        if (result.matchedCount > 0) return true;
        return Boolean(await notifications.findOne({ _id: notificationId, recipientId: userId }));
      });
    },
    markResourceRead: async (userId, resource: NotificationResource, readAt) => {
      return run(async () => {
        const result = await notifications.updateMany({
          recipientId: userId,
          resourceType: resource.type,
          resourceId: resource.id,
          ...(resource.type === "channel" ? { threadRootId: { $exists: false } } : {}),
          readAt: null
        }, { $set: { readAt } });
        return result.modifiedCount;
      });
    },
    markThreadRead: async (userId, channelId, rootMessageId, readAt) => {
      return run(async () => {
        const result = await notifications.updateMany({
          recipientId: userId,
          resourceType: "channel",
          resourceId: channelId,
          threadRootId: rootMessageId,
          readAt: null
        }, { $set: { readAt } });
        return result.modifiedCount;
      });
    },
    findCursor: async (userId, notificationId) => {
      return run(() => notifications.findOne({ _id: notificationId, recipientId: userId }));
    }
  });
};
