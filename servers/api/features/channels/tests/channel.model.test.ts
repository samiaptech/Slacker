import test from "node:test";
import assert from "node:assert/strict";
import {
  CHANNEL_MESSAGES_COLLECTION_VALIDATOR,
  CHANNEL_MESSAGES_INDEXES,
  CHANNELS_COLLECTION_VALIDATOR,
  CHANNELS_INDEXES
} from "../models/index.js";

void test("MongoDB validation enforces the channel fields and active/archived timestamp consistency", () => {
  const schema = CHANNELS_COLLECTION_VALIDATOR.$jsonSchema;
  assert.deepEqual(schema.required, [
    "_id",
    "workspaceId",
    "name",
    "visibility",
    "lifecycleState",
    "createdBy",
    "createdAt",
    "updatedAt",
    "archivedAt"
  ]);
  assert.deepEqual(schema.oneOf, [
    { properties: { lifecycleState: { enum: ["active"] }, archivedAt: { bsonType: "null" } } },
    { properties: { lifecycleState: { enum: ["archived"] }, archivedAt: { bsonType: "date" } } }
  ]);
});

void test("the unique index scopes canonical active names by workspace and permits archived reuse", () => {
  assert.deepEqual(CHANNELS_INDEXES.find((index) => index.options.name === "workspace_active_channel_name_unique"), {
    keys: { workspaceId: 1, name: 1 },
    options: {
      name: "workspace_active_channel_name_unique",
      unique: true,
      partialFilterExpression: { lifecycleState: "active" }
    }
  });

  assert.deepEqual(CHANNELS_INDEXES.find((index) => index.options.name === "workspace_visibility_active_channel_browse"), {
    keys: { workspaceId: 1, visibility: 1, name: 1 },
    options: {
      name: "workspace_visibility_active_channel_browse",
      unique: false,
      partialFilterExpression: { lifecycleState: "active" }
    }
  });
});

void test("channel messages validate thread metadata and index replies by root chronology", () => {
  assert.deepEqual(CHANNEL_MESSAGES_COLLECTION_VALIDATOR.$jsonSchema.required, [
    "_id", "channelId", "text", "createdAt"
  ]);
  assert.equal(CHANNEL_MESSAGES_COLLECTION_VALIDATOR.$jsonSchema.additionalProperties, false);
  assert.deepEqual(CHANNEL_MESSAGES_COLLECTION_VALIDATOR.$jsonSchema.properties.text, {
    bsonType: "string",
    minLength: 0,
    maxLength: 4000
  });
  assert.equal(CHANNEL_MESSAGES_COLLECTION_VALIDATOR.$jsonSchema.properties.attachments.maxItems, 5);
  assert.equal(CHANNEL_MESSAGES_COLLECTION_VALIDATOR.$jsonSchema.oneOf[0]?.required[0], "senderId");
  assert.deepEqual(CHANNEL_MESSAGES_INDEXES, [
    {
      keys: { channelId: 1, createdAt: -1, _id: -1 },
      options: { name: "channel_messages_chronological", unique: false }
    },
    {
      keys: { channelId: 1, threadRootId: 1, createdAt: -1, _id: -1 },
      options: { name: "channel_thread_replies_chronological", unique: false }
    },
    {
      keys: { text: "text" },
      options: { name: "channel_messages_text", unique: false }
    }
  ]);
});
