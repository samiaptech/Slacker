import { z } from "zod";
import type { ChannelMessageListResponse, ChannelMessageResponse, ChatAttachmentResponse } from "@workspace/types";

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
  senderId: z.string().min(1),
  text: z.string().refine((text) => Array.from(text).length <= 4_000),
  createdAt: z.iso.datetime(),
  attachments: z.array(attachmentSchema).max(5).readonly().optional(),
  sender: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    image: z.string().nullable()
  }).strict()
}).strict();

const channelMessageSchema = channelMessageBaseSchema.transform((message): ChannelMessageResponse => {
  return { ...message, attachments: message.attachments ?? [] };
}) satisfies z.ZodType<ChannelMessageResponse>;

export const channelMessageListResponseSchema = z.object({
  messages: z.array(channelMessageSchema),
  nextCursor: z.string().min(1).max(256).nullable()
}).strict() satisfies z.ZodType<ChannelMessageListResponse>;

export const channelMessageResponseSchema = channelMessageSchema;

export type ChannelMessageView = z.infer<typeof channelMessageSchema>;
export type ChannelMessageListView = z.infer<typeof channelMessageListResponseSchema>;
