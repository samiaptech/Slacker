import type { DirectConversation, DirectMessage } from "../domain/index.js";

export const DIRECT_CONVERSATIONS_COLLECTION = "direct_conversations";
export const DIRECT_MESSAGES_COLLECTION = "direct_messages";
export const DIRECT_CONVERSATIONS_COLLECTION_VALIDATOR = Object.freeze({
  $jsonSchema: Object.freeze({
    bsonType: "object",
    required: ["_id", "workspaceId", "pairKey", "participantIds", "createdAt", "lastActivityAt"],
    additionalProperties: false,
    properties: Object.freeze({
      _id: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 128 }),
      workspaceId: Object.freeze({ bsonType: "string", minLength: 1 }),
      pairKey: Object.freeze({ bsonType: "string", minLength: 1 }),
      participantIds: Object.freeze({
        bsonType: "array",
        minItems: 2,
        maxItems: 2,
        uniqueItems: true,
        items: Object.freeze({ bsonType: "string", minLength: 1 })
      }),
      createdAt: Object.freeze({ bsonType: "date" }),
      lastActivityAt: Object.freeze({ bsonType: "date" })
    })
  })
});

export const DIRECT_MESSAGES_COLLECTION_VALIDATOR = Object.freeze({
  $jsonSchema: Object.freeze({
    bsonType: "object",
    anyOf: Object.freeze([
      Object.freeze({
        required: Object.freeze(["text"]),
        properties: Object.freeze({ text: Object.freeze({ minLength: 1 }) })
      }),
      Object.freeze({
        required: Object.freeze(["attachments"]),
        properties: Object.freeze({ attachments: Object.freeze({ minItems: 1 }) })
      })
    ]),
    required: ["_id", "workspaceId", "conversationId", "senderId", "text", "createdAt"],
    additionalProperties: false,
    properties: Object.freeze({
      _id: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 128 }),
      workspaceId: Object.freeze({ bsonType: "string", minLength: 1 }),
      conversationId: Object.freeze({ bsonType: "string", minLength: 1 }),
      senderId: Object.freeze({ bsonType: "string", minLength: 1 }),
      text: Object.freeze({ bsonType: "string", minLength: 0, maxLength: 4000 }),
      createdAt: Object.freeze({ bsonType: "date" }),
      attachments: Object.freeze({
        bsonType: "array",
        maxItems: 5,
        items: Object.freeze({
          bsonType: "object",
          required: ["id", "name", "mimeType", "size", "publicId", "resourceType", "format"],
          additionalProperties: false,
          properties: Object.freeze({
            id: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 128 }),
            name: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 255 }),
            mimeType: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 128 }),
            size: Object.freeze({ bsonType: "int", minimum: 1, maximum: 10485760 }),
            publicId: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 512 }),
            resourceType: Object.freeze({ enum: ["image", "raw"] }),
            format: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 32 })
          })
        })
      })
    })
  })
});

export const DIRECT_CONVERSATIONS_INDEXES = Object.freeze([
  Object.freeze({
    keys: Object.freeze({ workspaceId: 1, pairKey: 1 }),
    options: Object.freeze({ name: "workspace_direct_pair_unique", unique: true })
  }),
  Object.freeze({
    keys: Object.freeze({ workspaceId: 1, participantIds: 1, lastActivityAt: -1, _id: -1 }),
    options: Object.freeze({ name: "workspace_direct_member_activity", unique: false })
  })
]);

export const DIRECT_MESSAGES_INDEXES = Object.freeze([
  Object.freeze({
    keys: Object.freeze({ workspaceId: 1, conversationId: 1, createdAt: -1, _id: -1 }),
    options: Object.freeze({ name: "direct_messages_chronological", unique: false })
  }),
  Object.freeze({
    keys: Object.freeze({ text: "text" }),
    options: Object.freeze({ name: "direct_messages_text", unique: false })
  })
]);

export type DirectConversationDocument = Omit<DirectConversation, "id"> & Readonly<{ _id: string }>;
export type DirectMessageDocument = Omit<DirectMessage, "id"> & Readonly<{ _id: string }>;
