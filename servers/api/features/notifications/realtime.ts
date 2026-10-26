import type { NotificationRecord } from "./model.js";
import type { SocketIoApi } from "../../integrations/socket-io/index.js";
import type { NotificationRealtimePublisher } from "./service.js";

const userRoom = (userId: string): string => `user:${encodeURIComponent(userId)}`;

export const createNotificationRealtime = (
  socketIo: SocketIoApi
): NotificationRealtimePublisher => {
  const emit = socketIo.io as unknown as Readonly<{
    to: (room: string) => Readonly<{ emit: (event: string, payload: unknown) => void }>;
  }>;
  return Object.freeze({
  publishNew: (userId, notification) => {
    emit.to(userRoom(userId)).emit("notification:new", Object.freeze({ notification }));
  },
  publishUnreadCount: (userId, unreadCount) => {
    emit.to(userRoom(userId)).emit("notification:unread-count", Object.freeze({ unreadCount }));
  }
  });
};

export type { NotificationRecord };
