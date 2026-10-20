import type { ChannelCreateResponse } from "@workspace/types";
import { channelCreateResponseSchema } from "./channel-response";
import { validateCreateChannelForm, type CreateChannelFormErrors, type CreateChannelFormValues } from "./create-channel-form";

type ApiError = Readonly<{ error: Readonly<{ code: string; message: string; details?: unknown }> }>;

export type SubmitChannelCreationResult =
  | Readonly<{ kind: "invalid"; fieldErrors: CreateChannelFormErrors }>
  | Readonly<{ kind: "error"; fieldErrors: CreateChannelFormErrors; message: string }>
  | Readonly<{ kind: "created"; response: ChannelCreateResponse }>;

type SubmitChannelCreationDependencies = Readonly<{
  apiBaseUrl: string;
  workspaceId: string;
  values: CreateChannelFormValues;
  getIdempotencyKey: () => string;
  fetchChannel: typeof fetch;
  onSubmittingChange: (isSubmitting: boolean) => void;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const errorResponse = (value: unknown): ApiError | null => {
  if (!isRecord(value) || !("error" in value)) return null;
  const error = value.error;
  if (!isRecord(error) || typeof error.code !== "string" || typeof error.message !== "string") return null;
  return Object.freeze({
    error: Object.freeze({
      code: error.code,
      message: error.message,
      ...("details" in error ? { details: error.details } : {})
    })
  });
};

const messageForApiError = (payload: ApiError | null): string => {
  switch (payload?.error.code) {
    case "channel_name_conflict":
      return "A channel with this name already exists. Choose another name.";
    case "unauthenticated":
      return "Your session has expired. Sign in again to create a channel.";
    case "workspace_access_denied":
      return "Your account does not have access to this workspace.";
    case "channel_storage_unavailable":
      return "Channel creation is temporarily unavailable. Please try again.";
    default:
      return "The channel could not be created. Check your details and try again.";
  }
};

const serverFieldErrors = (payload: ApiError | null): CreateChannelFormErrors => {
  const details = payload?.error.details;
  if (Array.isArray(details)) {
    const issue = details.find((item) => isRecord(item) && Array.isArray(item.path) && typeof item.message === "string");
    if (isRecord(issue) && Array.isArray(issue.path)) {
      const field = issue.path[0];
      if (field === "name" || field === "description") return { [field]: "Check this field and try again." };
    }
  }
  if (isRecord(details) && details.field === "name") return { name: "Check this field and try again." };
  if (isRecord(details) && details.field === "description") return { description: "Check this field and try again." };
  return {};
};

export const submitChannelCreation = async ({
  apiBaseUrl,
  workspaceId,
  values,
  getIdempotencyKey,
  fetchChannel,
  onSubmittingChange
}: SubmitChannelCreationDependencies): Promise<SubmitChannelCreationResult> => {
  const fieldErrors = validateCreateChannelForm(values);
  if (Object.keys(fieldErrors).length > 0) {
    return Object.freeze({ kind: "invalid", fieldErrors });
  }

  onSubmittingChange(true);
  try {
    const response = await fetchChannel(new URL("/channels", apiBaseUrl), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceId,
        "Idempotency-Key": getIdempotencyKey()
      },
      body: JSON.stringify({
        name: values.name.trim(),
        description: values.description.trim() || undefined,
        visibility: values.visibility
      })
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const apiError = errorResponse(body);
      const serverErrors = serverFieldErrors(apiError);
      const conflictErrors = apiError?.error.code === "channel_name_conflict"
        ? { name: "A channel with this name already exists. Choose another name." }
        : serverErrors;
      return Object.freeze({
        kind: "error",
        fieldErrors: conflictErrors,
        message: messageForApiError(apiError)
      });
    }
    const parsed = channelCreateResponseSchema.safeParse(body);
    if (!parsed.success) {
      return Object.freeze({
        kind: "error",
        fieldErrors: {},
        message: "The server returned an invalid channel response. Please try again."
      });
    }
    return Object.freeze({ kind: "created", response: parsed.data });
  } catch {
    return Object.freeze({
      kind: "error",
      fieldErrors: {},
      message: "The channel could not be created. Check your connection and try again."
    });
  } finally {
    onSubmittingChange(false);
  }
};
