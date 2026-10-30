export type ApiErrorCode =
  | "internal_error"
  | "route_not_found"
  | "validation_error"
  | "unauthenticated"
  | "workspace_access_denied"
  | "workspace_storage_unavailable"
  | "workspace_membership_conflict"
  | "channel_name_conflict"
  | "idempotency_key_reused"
  | "channel_storage_unavailable"
  | "channel_join_not_allowed"
  | "channel_membership_conflict"
  | "direct_message_storage_unavailable"
  | "chat_attachment_storage_unavailable"
  | "profile_image_storage_unavailable"
  | "profile_image_update_failed"
  | "message_delete_forbidden"
  | "message_delete_cleanup_failed"
  | "message_edit_forbidden"
  | "message_edit_conflict"
  | "message_search_unavailable"
  | "rate_limited"
  | "api_rate_limited"
  | "rate_limit_unavailable";

export type ApiErrorDetails = Readonly<Record<string, unknown>> | readonly unknown[];

export type ApiErrorResponse = Readonly<{
  error: Readonly<{
    code: ApiErrorCode;
    message: string;
    details?: ApiErrorDetails;
  }>;
}>;
