import { z } from "zod";
import type {
  ChatAttachmentResponse,
  DirectConversationListResponse,
  DirectConversationResponse,
  DirectMessageListResponse,
  DirectMessageResponse
} from "@workspace/types";
import { messageReactionSchema } from "@/features/conversation-history/public";

const attachmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  downloadUrl: z.string().min(1)
}).strict() satisfies z.ZodType<ChatAttachmentResponse>;

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

const directMessageBaseSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  senderId: z.string().min(1),
  text: z.string().refine((text) => Array.from(text).length <= 4_000),
  createdAt: z.iso.datetime(),
  editedAt: z.string().datetime().nullable().optional(),
  attachments: z.array(attachmentSchema).max(5).readonly().optional(),
  reactions: z.array(messageReactionSchema).readonly().optional(),
  sender: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    image: z.string().nullable()
  }).strict()
}).strict();

const directMessageSchema = directMessageBaseSchema.transform((message): DirectMessageResponse => {
  return { ...message, attachments: message.attachments ?? [], reactions: message.reactions ?? [], editedAt: message.editedAt ?? null };
}) satisfies z.ZodType<DirectMessageResponse>;

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
