import { z } from "zod";
import type {
  WorkspaceAccessResponse,
  WorkspaceEmailVisibilityResponse,
  WorkspaceMemberProfileResponse,
  WorkspaceMemberRoleResponse,
  WorkspaceMembersResponse
} from "@workspace/types";

export const workspaceAccessSchema = z.object({
  workspace: z.object({ id: z.string(), name: z.string() }),
  user: z.object({
    id: z.string(),
    name: z.string(),
    title: z.string().nullable(),
    email: z.email(),
    image: z.url().nullable()
  })
}) satisfies z.ZodType<WorkspaceAccessResponse>;

export const workspaceMembersSchema = z.object({
  members: z.array(z.object({
    id: z.string().min(1),
    name: z.string().nullable(),
    title: z.string().nullable(),
    email: z.email().nullable(),
    image: z.url().nullable(),
    role: z.enum(["admin", "member"]),
    joinedAt: z.iso.datetime()
  })),
  memberEmailsVisible: z.boolean()
}) satisfies z.ZodType<WorkspaceMembersResponse>;

export const workspaceMemberProfileSchema = z.object({
  member: z.object({
    id: z.string().min(1),
    name: z.string().nullable(),
    title: z.string().nullable(),
    email: z.email().nullable(),
    image: z.url().nullable(),
    role: z.enum(["admin", "member"]),
    joinedAt: z.iso.datetime()
  })
}) satisfies z.ZodType<WorkspaceMemberProfileResponse>;

export const workspaceEmailVisibilitySchema = z.object({
  memberEmailsVisible: z.boolean()
}) satisfies z.ZodType<WorkspaceEmailVisibilityResponse>;

export const workspaceMemberRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["admin", "member"])
}) satisfies z.ZodType<WorkspaceMemberRoleResponse>;

export type WorkspaceAccessView = z.infer<typeof workspaceAccessSchema>;
export type WorkspaceMembersView = z.infer<typeof workspaceMembersSchema>;
export type WorkspaceMemberProfileView = z.infer<typeof workspaceMemberProfileSchema>["member"];
