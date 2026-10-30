export const NOTIFICATIONS_COLLECTION = "user_notifications";

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

export type NotificationRecord = Readonly<{
  id: string;
  eventId: string;
  recipientId: string;
  workspaceId: string;
  type: NotificationType;
  resource: NotificationResource;
  actor: Readonly<{ id: string; name: string }>;
  createdAt: Date;
  readAt: Date | null;
  threadRootId?: string;
}>;

export type NotificationDocument = Omit<NotificationRecord, "id" | "resource" | "actor"> & Readonly<{
  _id: string;
  resourceType: NotificationResource["type"];
  resourceId: string;
  actorId: string;
  actorName: string;
}>;

export const NOTIFICATIONS_COLLECTION_VALIDATOR = Object.freeze({
  $jsonSchema: Object.freeze({
    bsonType: "object",
    required: [
      "_id", "eventId", "recipientId", "workspaceId", "type", "resourceType",
      "resourceId", "actorId", "actorName", "createdAt", "readAt"
    ],
    additionalProperties: false,
    properties: Object.freeze({
      _id: Object.freeze({ bsonType: "string", minLength: 1 }),
      eventId: Object.freeze({ bsonType: "string", minLength: 1 }),
      recipientId: Object.freeze({ bsonType: "string", minLength: 1 }),
      workspaceId: Object.freeze({ bsonType: "string", minLength: 1 }),
      type: Object.freeze({
        enum: [
          "channel_message", "channel_thread_reply", "direct_message", "mention",
          "channel_member_joined", "channel_member_left", "channel_updated"
        ]
      }),
      resourceType: Object.freeze({ enum: ["channel", "direct_message"] }),
      resourceId: Object.freeze({ bsonType: "string", minLength: 1 }),
      threadRootId: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 128 }),
      actorId: Object.freeze({ bsonType: "string", minLength: 1 }),
      actorName: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 128 }),
      createdAt: Object.freeze({ bsonType: "date" }),
      readAt: Object.freeze({ bsonType: ["date", "null"] })
    })
  })
});

export const NOTIFICATIONS_INDEXES = Object.freeze([
  Object.freeze({
    keys: Object.freeze({ recipientId: 1, createdAt: -1, _id: -1 }),
    options: Object.freeze({ name: "user_notifications_chronological", unique: false })
  }),
  Object.freeze({
    keys: Object.freeze({ recipientId: 1, readAt: 1 }),
    options: Object.freeze({ name: "user_notifications_unread", unique: false })
  }),
  Object.freeze({
    keys: Object.freeze({ recipientId: 1, eventId: 1 }),
    options: Object.freeze({ name: "user_notifications_event_unique", unique: true })
  })
]);
