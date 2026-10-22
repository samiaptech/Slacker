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
  | "message_search_unavailable"
  | "rate_limited";

export type ApiErrorDetails = Readonly<Record<string, unknown>> | readonly unknown[];

export type ApiErrorResponse = Readonly<{
  error: Readonly<{
    code: ApiErrorCode;
    message: string;
    details?: ApiErrorDetails;
  }>;
}>;
