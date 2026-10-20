import type { ApiErrorCode } from "@workspace/types";

export const ERROR_CODES = Object.freeze({
  internal: "internal_error",
  routeNotFound: "route_not_found",
  validation: "validation_error",
  unauthenticated: "unauthenticated",
  workspaceAccessDenied: "workspace_access_denied",
  workspaceStorageUnavailable: "workspace_storage_unavailable",
  workspaceMembershipConflict: "workspace_membership_conflict",
  channelNameConflict: "channel_name_conflict",
  idempotencyKeyReused: "idempotency_key_reused",
  channelStorageUnavailable: "channel_storage_unavailable",
  channelJoinNotAllowed: "channel_join_not_allowed",
  channelMembershipConflict: "channel_membership_conflict",
  directMessageStorageUnavailable: "direct_message_storage_unavailable"
} as const satisfies Readonly<Record<string, ApiErrorCode>>);
