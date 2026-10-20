export const CHANNEL_NAME_MIN_LENGTH = 1;
export const CHANNEL_NAME_MAX_LENGTH = 80;
/** Active channel names are unique per workspace; archived names may be reused. */
export const CHANNEL_NAME_UNIQUENESS_SCOPE = "active_channels_within_workspace" as const;

export const normalizeChannelName = (name: string): string => name.trim().toLowerCase();

export type ChannelNameError = "channel_name_required" | "channel_name_too_long" | "channel_name_invalid";

export type ChannelNameResult =
  | Readonly<{ ok: true; name: string }>
  | Readonly<{ ok: false; error: ChannelNameError }>;

export const validateChannelName = (input: string): ChannelNameResult => {
  const name = normalizeChannelName(input);
  if (name.length < CHANNEL_NAME_MIN_LENGTH) return Object.freeze({ ok: false, error: "channel_name_required" });
  if (name.length > CHANNEL_NAME_MAX_LENGTH) return Object.freeze({ ok: false, error: "channel_name_too_long" });
  if (!/^[a-z0-9_-]+$/.test(name)) return Object.freeze({ ok: false, error: "channel_name_invalid" });
  return Object.freeze({ ok: true, name });
};
