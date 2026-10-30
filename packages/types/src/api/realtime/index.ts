import type {
  ChannelMessageResponse,
  ChannelSystemEventResponse,
  ChannelThreadSummaryResponse
} from "../channels/index.js";
import type { DirectMessageResponse } from "../direct-messages/index.js";
import type { NotificationResponse } from "./notifications.js";
import type { MessageReactionToggleResponse } from "../chat/index.js";

export type {
  NotificationListResponse,
  NotificationResource,
  NotificationResponse,
  NotificationType
} from "./notifications.js";

export type RealtimeClientEvents = Readonly<{
  "workspace:subscribe": (workspaceId: string) => void;
  "channel:subscribe": (channelId: string) => void;
  "channel:unsubscribe": (channelId: string) => void;
  "channel:typing": (payload: Readonly<{ channelId: string; active: boolean }>) => void;
  "direct-message:subscribe": (conversationId: string) => void;
  "direct-message:unsubscribe": (conversationId: string) => void;
  "direct-message:typing": (payload: Readonly<{ conversationId: string; active: boolean }>) => void;
}>;

export type RealtimeServerEvents = Readonly<{
  "realtime:error": (payload: Readonly<{ event: string; message: string }>) => void;
  "workspace:ready": () => void;
  "channel:ready": (payload: Readonly<{ channelId: string }>) => void;
  "workspace:presence:sync": (payload: Readonly<{ onlineUserIds: readonly string[] }>) => void;
  "workspace:presence:changed": (payload: Readonly<{ userId: string; online: boolean }>) => void;
  "workspace:channels:changed": () => void;
  "workspace:members:changed": () => void;
  "workspace:access:revoked": (payload: Readonly<{ workspaceId: string }>) => void;
  "channel:message:new": (message: ChannelMessageResponse) => void;
  "channel:thread:reply:new": (payload: Readonly<{
    channelId: string;
    rootMessageId: string;
    reply: ChannelMessageResponse;
    thread: ChannelThreadSummaryResponse;
  }>) => void;
  "channel:message:updated": (message: ChannelMessageResponse) => void;
  "channel:system:new": (entry: ChannelSystemEventResponse) => void;
  "channel:message:deleted": (payload: Readonly<{ channelId: string; messageId: string }>) => void;
  "channel:message:reactions": (payload: Readonly<{ channelId: string } & MessageReactionToggleResponse>) => void;
  "channel:members:changed": (payload: Readonly<{ channelId: string }>) => void;
  "channel:access:revoked": (payload: Readonly<{ workspaceId: string; channelId: string }>) => void;
  "channel:typing": (payload: Readonly<{ channelId: string; userId: string; active: boolean }>) => void;
  "workspace:direct-messages:changed": () => void;
  "direct-message:ready": (payload: Readonly<{ conversationId: string }>) => void;
  "direct-message:new": (message: DirectMessageResponse) => void;
  "direct-message:updated": (message: DirectMessageResponse) => void;
  "direct-message:deleted": (payload: Readonly<{ conversationId: string; messageId: string }>) => void;
  "direct-message:reactions": (payload: Readonly<{ conversationId: string } & MessageReactionToggleResponse>) => void;
  "direct-message:typing": (payload: Readonly<{ conversationId: string; userId: string; active: boolean }>) => void;
  "notification:new": (payload: Readonly<{ notification: NotificationResponse & Readonly<{ recipientId: string }> }>) => void;
  "notification:unread-count": (payload: Readonly<{ unreadCount: number }>) => void;
}>;
