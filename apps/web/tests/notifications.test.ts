import assert from "node:assert/strict";
import test from "node:test";
import {
  channelMessageListResponseSchema
} from "../features/channels/types/index.js";
import {
  notificationEventSchema,
  notificationListResponseSchema as inboxSchema
} from "../features/notifications/types/notification-response.js";

const notification = {
  id: "message-1:user-2",
  eventId: "message-1",
  type: "mention",
  workspaceId: "workspace-1",
  resource: { type: "channel", id: "channel-1" },
  actor: { id: "user-1", name: "Member" },
  createdAt: "2026-10-26T09:00:00.000Z",
  readAt: null
};

test("notification inbox validates durable notification records", () => {
  assert.equal(inboxSchema.safeParse({ notifications: [notification], nextCursor: null }).success, true);
  assert.equal(inboxSchema.safeParse({
    notifications: [{ ...notification, resource: { type: "channel", id: { $ne: "" } } }],
    nextCursor: null
  }).success, false);
});

test("notification socket event requires its recipient identity", () => {
  assert.equal(notificationEventSchema.safeParse({
    notification: { ...notification, recipientId: "user-2" }
  }).success, true);
  assert.equal(notificationEventSchema.safeParse({ notification }).success, false);
});

test("channel history accepts a typed member departure entry and normalizes user messages", () => {
  const parsed = channelMessageListResponseSchema.safeParse({
    messages: [
      {
        id: "message-1",
        channelId: "channel-1",
        senderId: "user-1",
        text: "Hello",
        createdAt: "2026-10-26T09:00:00.000Z",
        sender: { id: "user-1", name: "Member", image: null }
      },
      {
        id: "departure-1",
        channelId: "channel-1",
        type: "system",
        systemEvent: "member_left",
        actor: { id: "user-2", name: "Former member" },
        text: "",
        createdAt: "2026-10-26T09:01:00.000Z"
      }
    ],
    nextCursor: null
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.messages[0]?.type, "message");
    assert.equal(parsed.data.messages[1]?.type, "system");
  }
});
