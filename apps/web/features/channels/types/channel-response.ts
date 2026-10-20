import { z } from "zod";
import type {
  ChannelCreateResponse,
  ChannelJoinResponse,
  ChannelListResponse,
  ChannelMemberMutationResponse,
  ChannelMembersResponse,
  ChannelMembershipResponse,
  ChannelResponse
} from "@workspace/types";

const channelSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string(),
  description: z.string().nullable(),
  visibility: z.enum(["public", "private"]),
  lifecycleState: z.enum(["active", "archived"]),
  createdBy: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable()
}) satisfies z.ZodType<ChannelResponse>;

export const channelResponseSchema = channelSchema;

export const channelListResponseSchema = z.object({
  channels: z.array(channelSchema),
  nextCursor: z.string().min(1).max(512).nullable()
}) satisfies z.ZodType<ChannelListResponse>;

export const channelCreateResponseSchema = z.object({
  channel: channelSchema,
  creatorMembership: z.object({
    channelId: z.string().min(1),
    userId: z.string().min(1),
    role: z.literal("admin"),
    joinedAt: z.iso.datetime()
  })
}) satisfies z.ZodType<ChannelCreateResponse>;

export const channelMembershipResponseSchema = z.object({
  channelId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["admin", "member"]),
  joinedAt: z.iso.datetime()
}) satisfies z.ZodType<ChannelMembershipResponse>;

export const channelJoinResponseSchema = z.object({
  membership: channelMembershipResponseSchema
}) satisfies z.ZodType<ChannelJoinResponse>;

export const channelMembersResponseSchema = z.object({
  canManage: z.boolean(),
  members: z.array(z.object({
    channelId: z.string().min(1),
    userId: z.string().min(1),
    role: z.enum(["admin", "member"]),
    joinedAt: z.iso.datetime(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    image: z.string().nullable()
  }))
}) satisfies z.ZodType<ChannelMembersResponse>;

export const channelMemberMutationResponseSchema = z.object({
  membership: channelMembershipResponseSchema,
  alreadyMember: z.boolean()
}) satisfies z.ZodType<ChannelMemberMutationResponse>;

export type ChannelResponseView = z.infer<typeof channelResponseSchema>;
export type ChannelListResponseView = z.infer<typeof channelListResponseSchema>;
export type ChannelMemberResponseView = z.infer<typeof channelMembersResponseSchema>["members"][number];
export type ChannelMembersResponseView = z.infer<typeof channelMembersResponseSchema>;
