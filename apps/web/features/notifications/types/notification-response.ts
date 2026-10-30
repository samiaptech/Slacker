import { z } from "zod";
import type {
  NotificationListResponse,
  NotificationResponse,
  NotificationType
} from "@workspace/types";

const notificationTypes = [
  "channel_message",
  "direct_message",
  "channel_thread_reply",
  "mention",
  "channel_member_joined",
  "channel_member_left",
  "channel_updated"
] as const satisfies readonly NotificationType[];

const notificationObjectSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  type: z.enum(notificationTypes),
  workspaceId: z.string().min(1),
  resource: z.object({
    type: z.enum(["channel", "direct_message"]),
    id: z.string().min(1)
  }).strict(),
  actor: z.object({ id: z.string().min(1), name: z.string().min(1) }).strict(),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
  threadRootId: z.string().min(1).optional()
}).strict();

export const notificationResponseSchema = notificationObjectSchema.transform((notification): NotificationResponse => {
  const { threadRootId, ...base } = notification;
  return threadRootId ? { ...base, threadRootId } : base;
}) satisfies z.ZodType<NotificationResponse>;

export const notificationListResponseSchema = z.object({
  notifications: z.array(notificationResponseSchema),
  nextCursor: z.string().min(1).max(512).nullable()
}).strict() satisfies z.ZodType<NotificationListResponse>;

export const notificationEventSchema = z.object({
  notification: notificationObjectSchema.extend({ recipientId: z.string().min(1) }).transform(({ recipientId, threadRootId, ...base }) =>
    threadRootId ? { ...base, threadRootId, recipientId } : { ...base, recipientId }
  )
}).strict();

export const notificationUnreadCountSchema = z.object({
  unreadCount: z.number().int().nonnegative()
}).strict();

export type NotificationView = z.infer<typeof notificationResponseSchema>;
