import assert from "node:assert/strict";
import test from "node:test";
import { shouldApplyNotificationLoad } from "./notification-load-state";
import type { NotificationView } from "./types/notification-response";

const socketNotification: NotificationView = {
  id: "notification-2",
  recipientId: "user-1",
  eventId: "message-2",
  type: "mention",
  workspaceId: "workspace-1",
  resource: { type: "channel", id: "channel-1" },
  actor: { id: "user-2", name: "Member" },
  createdAt: "2026-10-26T09:00:00.000Z",
  readAt: "2026-10-26T09:01:00.000Z"
};

void test("late loads preserve socket-added and locally read notification state", () => {
  const current = { notifications: [socketNotification], unreadCount: 0, nextCursor: null };
  const stale = { notifications: [], unreadCount: 1, nextCursor: "older-page" };
  let state = current;

  if (shouldApplyNotificationLoad(1, 1, 4, 6)) state = stale;

  assert.equal(state, current);
  assert.equal(state.notifications[0]?.readAt, socketNotification.readAt);
  assert.equal(state.unreadCount, 0);
});
