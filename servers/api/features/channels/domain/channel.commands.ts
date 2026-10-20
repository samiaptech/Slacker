import type { Channel, ChannelMembership, ChannelVisibility } from "./channel.entity.js";
import { validateChannelName } from "./channel.rules.js";

export type CreateChannelCommand = Readonly<{
  workspaceId: string;
  creatorId: string;
  name: string;
  description: string | null;
  visibility: ChannelVisibility;
}>;

export type CreateChannelCommandInput = Readonly<{
  workspaceId: string;
  creatorId: string;
  name: string;
  description?: string;
  visibility: string;
}>;

export type CreateChannelCommandError =
  | "workspace_access_denied"
  | "channel_name_required"
  | "channel_name_too_long"
  | "channel_name_invalid"
  | "channel_description_too_long"
  | "channel_visibility_invalid"
  | "channel_name_conflict";

export type CreateChannelCommandResult =
  | Readonly<{ ok: true; command: CreateChannelCommand }>
  | Readonly<{ ok: false; error: CreateChannelCommandError }>;

export type CreateChannelResult = Readonly<{
  channel: Channel;
  /** An active channel administrator membership, committed atomically with the channel. */
  creatorMembership: ChannelMembership & Readonly<{ role: "admin" }>;
}>;

export const prepareCreateChannelCommand = (input: CreateChannelCommandInput): CreateChannelCommandResult => {
  if (!input.workspaceId.trim() || !input.creatorId.trim()) {
    return Object.freeze({ ok: false, error: "workspace_access_denied" });
  }

  const nameResult = validateChannelName(input.name);
  if (!nameResult.ok) return nameResult;
  const description = input.description?.trim() ?? "";
  if (description.length > 500) return Object.freeze({ ok: false, error: "channel_description_too_long" });
  if (input.visibility !== "public" && input.visibility !== "private") {
    return Object.freeze({ ok: false, error: "channel_visibility_invalid" });
  }

  return Object.freeze({
    ok: true,
    command: Object.freeze({
      workspaceId: input.workspaceId,
      creatorId: input.creatorId,
      name: nameResult.name,
      description: description || null,
      visibility: input.visibility
    })
  });
};
