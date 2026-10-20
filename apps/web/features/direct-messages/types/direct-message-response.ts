import { z } from "zod";
import type {
  DirectConversationListResponse,
  DirectConversationResponse,
  DirectMessageListResponse,
  DirectMessageResponse
} from "@workspace/types";

const directConversationSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  otherParticipant: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    image: z.string().nullable()
  }).strict(),
  createdAt: z.iso.datetime(),
  lastActivityAt: z.iso.datetime()
}).strict() satisfies z.ZodType<DirectConversationResponse>;

const directMessageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  senderId: z.string().min(1),
  text: z.string().min(1).refine((text) => Array.from(text).length <= 4_000),
  createdAt: z.iso.datetime(),
  sender: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    image: z.string().nullable()
  }).strict()
}).strict() satisfies z.ZodType<DirectMessageResponse>;

export const directConversationResponseSchema = z.object({
  conversation: directConversationSchema
}).strict();

export const directConversationListResponseSchema = z.object({
  conversations: z.array(directConversationSchema)
}).strict() satisfies z.ZodType<DirectConversationListResponse>;

export const directMessageListResponseSchema = z.object({
  messages: z.array(directMessageSchema),
  nextCursor: z.string().min(1).max(256).nullable()
}).strict() satisfies z.ZodType<DirectMessageListResponse>;

export const directMessageResponseSchema = directMessageSchema;

export type DirectConversationView = z.infer<typeof directConversationSchema>;
export type DirectMessageView = z.infer<typeof directMessageSchema>;
