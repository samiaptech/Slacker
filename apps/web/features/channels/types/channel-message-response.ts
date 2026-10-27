import { z } from "zod";
import type {
  ChannelHistoryEntryResponse,
  ChannelMessageListResponse,
  ChannelMessageResponse,
  ChannelSystemEventResponse,
  ChatAttachmentResponse
} from "@workspace/types";
import { messageReactionSchema } from "@/features/conversation-history/public";

const attachmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  downloadUrl: z.string().min(1)
}).strict() satisfies z.ZodType<ChatAttachmentResponse>;

const channelMessageBaseSchema = z.object({
  id: z.string().min(1),
  channelId: z.string().min(1),
  type: z.literal("message").optional(),
  senderId: z.string().min(1),
  text: z.string().refine((text) => Array.from(text).length <= 4_000),
  createdAt: z.iso.datetime(),
  attachments: z.array(attachmentSchema).max(5).readonly().optional(),
  reactions: z.array(messageReactionSchema).readonly().optional(),
  sender: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    image: z.string().nullable()
  }).strict()
}).strict();

const channelMessageSchema = channelMessageBaseSchema.transform((message): ChannelMessageResponse => {
  return { ...message, type: "message", attachments: message.attachments ?? [], reactions: message.reactions ?? [] };
}) satisfies z.ZodType<ChannelMessageResponse>;

const channelSystemEventSchema = z.object({
  id: z.string().min(1),
  channelId: z.string().min(1),
  type: z.literal("system"),
  systemEvent: z.literal("member_left"),
  actor: z.object({ id: z.string().min(1), name: z.string().min(1) }).strict(),
  text: z.literal(""),
  createdAt: z.iso.datetime()
}).strict() satisfies z.ZodType<ChannelSystemEventResponse>;

const channelHistoryEntrySchema = z.union([
  channelMessageSchema,
  channelSystemEventSchema
]) satisfies z.ZodType<ChannelHistoryEntryResponse>;

export const channelMessageListResponseSchema = z.object({
  messages: z.array(channelHistoryEntrySchema),
  nextCursor: z.string().min(1).max(256).nullable()
}).strict() satisfies z.ZodType<ChannelMessageListResponse>;

export const channelMessageResponseSchema = channelMessageSchema;

export type ChannelMessageView = z.infer<typeof channelMessageSchema>;
export type ChannelHistoryEntryView = z.infer<typeof channelHistoryEntrySchema>;
export type ChannelMessageListView = z.infer<typeof channelMessageListResponseSchema>;
