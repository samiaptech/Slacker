import { z } from "zod";

const messageSearchResultSchema = z.object({
  id: z.string().min(1),
  threadRootId: z.string().min(1).nullable().optional(),
  snippet: z.string().max(182),
  createdAt: z.string().datetime(),
  sender: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    image: z.string().nullable()
  }).strict(),
  conversation: z.object({
    type: z.enum(["channel", "direct"]),
    id: z.string().min(1),
    name: z.string().min(1)
  }).strict()
}).strict();

export const messageSearchResponseSchema = z.object({
  query: z.string(),
  page: z.number().int().positive(),
  results: z.array(messageSearchResultSchema),
  hasMore: z.boolean(),
  truncated: z.boolean()
}).strict();

export type MessageSearchResponseView = z.infer<typeof messageSearchResponseSchema>;
