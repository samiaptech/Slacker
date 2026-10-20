import { z } from "zod";
import type { ChannelMessageListResponse, ChannelMessageResponse } from "@workspace/types";

const channelMessageSchema = z.object({
  id: z.string().min(1),
  channelId: z.string().min(1),
  senderId: z.string().min(1),
  text: z.string().min(1).refine((text) => Array.from(text).length <= 4_000),
  createdAt: z.iso.datetime(),
  sender: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    image: z.string().nullable()
  }).strict()
}).strict() satisfies z.ZodType<ChannelMessageResponse>;

export const channelMessageListResponseSchema = z.object({
  messages: z.array(channelMessageSchema),
  nextCursor: z.string().min(1).max(256).nullable()
}).strict() satisfies z.ZodType<ChannelMessageListResponse>;

export const channelMessageResponseSchema = channelMessageSchema;

export type ChannelMessageView = z.infer<typeof channelMessageSchema>;
export type ChannelMessageListView = z.infer<typeof channelMessageListResponseSchema>;
