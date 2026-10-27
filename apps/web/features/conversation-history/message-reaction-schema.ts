import { z } from "zod";
import {
  MESSAGE_REACTION_EMOJI,
  type MessageReactionResponse,
  type MessageReactionToggleResponse
} from "@workspace/types";

export const messageReactionSchema = z.object({
  emoji: z.enum(MESSAGE_REACTION_EMOJI),
  count: z.number().int().positive(),
  users: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    image: z.string().nullable()
  }).strict()).readonly(),
  usersTruncated: z.boolean(),
  reactedByMe: z.boolean()
}).strict() satisfies z.ZodType<MessageReactionResponse>;

export const messageReactionToggleResponseSchema = z.object({
  messageId: z.string().min(1),
  reactions: z.array(messageReactionSchema).readonly()
}).strict() satisfies z.ZodType<MessageReactionToggleResponse>;
