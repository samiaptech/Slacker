import type { Channel, ChannelMembership } from "../domain/index.js";

export const CHANNELS_COLLECTION = "channels";
export const CHANNEL_MEMBERSHIPS_COLLECTION = "channel_memberships";
export const CHANNEL_CREATION_REQUESTS_COLLECTION = "channel_creation_requests";
export const CHANNEL_MESSAGES_COLLECTION = "channel_messages";

export type ChannelDocument = Omit<Channel, "id"> & Readonly<{ _id: string; membershipRevision?: number }>;
export type ChannelMembershipDocument = ChannelMembership & Readonly<{ _id: string }>;
export type ChannelCreationRequestDocument = Readonly<{
  _id: string;
  workspaceId: string;
  actorId: string;
  key: string;
  fingerprint: string;
  channelId: string;
  createdAt: Date;
}>;
export type ChannelMessageDocument = Readonly<{
  _id: string;
  channelId: string;
  senderId: string;
  text: string;
  createdAt: Date;
}>;

/** MongoDB collection validation keeps persisted channel documents aligned with the domain contract. */
export const CHANNELS_COLLECTION_VALIDATOR = Object.freeze({
  $jsonSchema: Object.freeze({
    bsonType: "object",
    required: [
      "_id",
      "workspaceId",
      "name",
      "visibility",
      "lifecycleState",
      "createdBy",
      "createdAt",
      "updatedAt",
      "archivedAt"
    ],
    additionalProperties: false,
    properties: Object.freeze({
      _id: Object.freeze({ bsonType: "string", minLength: 1 }),
      workspaceId: Object.freeze({ bsonType: "string", minLength: 1 }),
      name: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 80, pattern: "^[a-z0-9_-]+$" }),
      description: Object.freeze({ bsonType: ["string", "null"], maxLength: 500 }),
      visibility: Object.freeze({ enum: ["public", "private"] }),
      lifecycleState: Object.freeze({ enum: ["active", "archived"] }),
      createdBy: Object.freeze({ bsonType: "string", minLength: 1 }),
      createdAt: Object.freeze({ bsonType: "date" }),
      updatedAt: Object.freeze({ bsonType: "date" }),
      archivedAt: Object.freeze({ bsonType: ["date", "null"] }),
      membershipRevision: Object.freeze({ bsonType: ["int", "long"], minimum: 0 })
    }),
    oneOf: [
      Object.freeze({ properties: Object.freeze({ lifecycleState: Object.freeze({ enum: ["active"] }), archivedAt: Object.freeze({ bsonType: "null" }) }) }),
      Object.freeze({ properties: Object.freeze({ lifecycleState: Object.freeze({ enum: ["archived"] }), archivedAt: Object.freeze({ bsonType: "date" }) }) })
    ]
  })
});

export const CHANNEL_MEMBERSHIPS_COLLECTION_VALIDATOR = Object.freeze({
  $jsonSchema: Object.freeze({
    bsonType: "object",
    required: ["_id", "channelId", "userId", "role", "joinedAt"],
    additionalProperties: false,
    properties: Object.freeze({
      _id: Object.freeze({ bsonType: "string", minLength: 1 }),
      channelId: Object.freeze({ bsonType: "string", minLength: 1 }),
      userId: Object.freeze({ bsonType: "string", minLength: 1 }),
      role: Object.freeze({ enum: ["admin", "member"] }),
      joinedAt: Object.freeze({ bsonType: "date" })
    })
  })
});

export const CHANNEL_CREATION_REQUESTS_COLLECTION_VALIDATOR = Object.freeze({
  $jsonSchema: Object.freeze({
    bsonType: "object",
    required: ["_id", "workspaceId", "actorId", "key", "fingerprint", "channelId", "createdAt"],
    additionalProperties: false,
    properties: Object.freeze({
      _id: Object.freeze({ bsonType: "string", minLength: 1 }),
      workspaceId: Object.freeze({ bsonType: "string", minLength: 1 }),
      actorId: Object.freeze({ bsonType: "string", minLength: 1 }),
      key: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 128 }),
      fingerprint: Object.freeze({ bsonType: "string", minLength: 1 }),
      channelId: Object.freeze({ bsonType: "string", minLength: 1 }),
      createdAt: Object.freeze({ bsonType: "date" })
    })
  })
});

export const CHANNEL_MESSAGES_COLLECTION_VALIDATOR = Object.freeze({
  $jsonSchema: Object.freeze({
    bsonType: "object",
    required: ["_id", "channelId", "senderId", "text", "createdAt"],
    additionalProperties: false,
    properties: Object.freeze({
      _id: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 128 }),
      channelId: Object.freeze({ bsonType: "string", minLength: 1 }),
      senderId: Object.freeze({ bsonType: "string", minLength: 1 }),
      text: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 4000 }),
      createdAt: Object.freeze({ bsonType: "date" })
    })
  })
});

export const CHANNELS_INDEXES = Object.freeze([
  Object.freeze({
    keys: Object.freeze({ workspaceId: 1, visibility: 1, name: 1 }),
    options: Object.freeze({
      name: "workspace_visibility_active_channel_browse",
      unique: false,
      partialFilterExpression: Object.freeze({ lifecycleState: "active" })
    })
  }),
  Object.freeze({
    keys: Object.freeze({ workspaceId: 1, name: 1 }),
    options: Object.freeze({
      name: "workspace_active_channel_name_unique",
      unique: true,
      partialFilterExpression: Object.freeze({ lifecycleState: "active" })
    })
  })
]);

export const CHANNEL_MEMBERSHIPS_INDEXES = Object.freeze([
  Object.freeze({
    keys: Object.freeze({ channelId: 1, userId: 1 }),
    options: Object.freeze({ name: "channel_membership_user_unique", unique: true })
  }),
  Object.freeze({
    keys: Object.freeze({ userId: 1, channelId: 1 }),
    options: Object.freeze({ name: "user_channel_memberships", unique: false })
  })
]);

export const CHANNEL_CREATION_REQUESTS_INDEXES = Object.freeze([
  Object.freeze({
    keys: Object.freeze({ workspaceId: 1, actorId: 1, key: 1 }),
    options: Object.freeze({ name: "channel_creation_idempotency_unique", unique: true })
  })
]);

export const CHANNEL_MESSAGES_INDEXES = Object.freeze([
  Object.freeze({
    keys: Object.freeze({ channelId: 1, createdAt: -1, _id: -1 }),
    options: Object.freeze({ name: "channel_messages_chronological", unique: false })
  })
]);
