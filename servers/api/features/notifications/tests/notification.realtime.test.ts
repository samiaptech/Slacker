import test from "node:test";
import assert from "node:assert/strict";
import type { SocketIoApi } from "../../../integrations/socket-io/index.js";
import { createNotificationRealtime } from "../realtime.js";

void test("targets notification and unread-count events to the owning user room", () => {
  const calls: Readonly<Record<string, unknown>>[] = [];
  const socketIo = {
    io: {
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => calls.push({ room, event, payload })
      })
    }
  } as unknown as SocketIoApi;
  const realtime = createNotificationRealtime(socketIo);
  const notification = {
    id: "event-1:user-1",
    eventId: "event-1",
    recipientId: "user-1",
    workspaceId: "workspace-1",
    type: "channel_message" as const,
    resource: { type: "channel" as const, id: "channel-1" },
    actor: { id: "actor-1", name: "Actor" },
    createdAt: new Date("2026-10-26T09:00:00.000Z"),
    readAt: null
  };

  realtime.publishNew("user-1", notification);
  realtime.publishUnreadCount("user-1", 3);

  assert.deepEqual(calls.map(({ room, event }) => [room, event]), [
    ["user:user-1", "notification:new"],
    ["user:user-1", "notification:unread-count"]
  ]);
});
