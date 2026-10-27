import { MESSAGE_REACTION_EMOJI } from "@workspace/types";

export const MESSAGE_REACTIONS_COLLECTION = "message_reactions";
export const MESSAGE_REACTION_USERS_LIMIT = 10;

export const MESSAGE_REACTIONS_COLLECTION_VALIDATOR = Object.freeze({
  $jsonSchema: Object.freeze({
    bsonType: "object",
    required: [
      "_id", "workspaceId", "scope", "parentId", "messageId", "emoji",
      "userId", "active", "updatedAt"
    ],
    additionalProperties: false,
    properties: Object.freeze({
      _id: Object.freeze({ bsonType: "string", minLength: 64, maxLength: 64 }),
      workspaceId: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 128 }),
      scope: Object.freeze({ enum: ["channel", "direct-message"] }),
      parentId: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 128 }),
      messageId: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 128 }),
      emoji: Object.freeze({ enum: MESSAGE_REACTION_EMOJI }),
      userId: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 128 }),
      active: Object.freeze({ bsonType: "bool" }),
      updatedAt: Object.freeze({ bsonType: "date" })
    })
  })
});

export const MESSAGE_REACTIONS_INDEXES = Object.freeze([
  Object.freeze({
    keys: Object.freeze({
      workspaceId: 1,
      scope: 1,
      parentId: 1,
      messageId: 1,
      emoji: 1,
      userId: 1
    }),
    options: Object.freeze({ name: "message_reaction_identity_unique", unique: true })
  }),
  Object.freeze({
    keys: Object.freeze({
      workspaceId: 1,
      scope: 1,
      parentId: 1,
      messageId: 1,
      userId: 1
    }),
    options: Object.freeze({
      name: "message_reaction_active_user_unique",
      unique: true,
      partialFilterExpression: Object.freeze({ active: true })
    })
  }),
  Object.freeze({
    keys: Object.freeze({
      workspaceId: 1,
      scope: 1,
      parentId: 1,
      messageId: 1,
      active: 1,
      emoji: 1,
      userId: 1
    }),
    options: Object.freeze({ name: "message_reaction_message_lookup", unique: false })
  })
]);

export type MessageReactionScope = "channel" | "direct-message";

export type MessageReactionDocument = Readonly<{
  _id: string;
  workspaceId: string;
  scope: MessageReactionScope;
  parentId: string;
  messageId: string;
  emoji: typeof MESSAGE_REACTION_EMOJI[number];
  userId: string;
  active: boolean;
  updatedAt: Date;
}>;

export type StoredMessageReaction = Readonly<{
  messageId: string;
  emoji: typeof MESSAGE_REACTION_EMOJI[number];
  count: number;
  userIds: readonly string[];
  usersTruncated: boolean;
  reactedByMe: boolean;
}>;
