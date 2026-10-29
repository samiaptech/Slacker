import type { ChannelNotificationPreference } from "@workspace/types";
import { z } from "zod";

const channelPageSchema = z.object({
  channels: z.array(z.object({ id: z.string().min(1) })),
  nextCursor: z.string().min(1).nullable()
});
const preferenceResponseSchema = z.object({
  preference: z.enum(["all", "mentions_only", "muted"])
}).strict();
const UPDATE_CONCURRENCY = 4;

type ApplyPreferencesInput = Readonly<{
  apiBaseUrl: string;
  workspaceId: string;
  preference: ChannelNotificationPreference;
  onProgress: (completed: number, total: number) => void;
}>;

type ApplyPreferencesResult = Readonly<{
  total: number;
  updated: number;
  failed: number;
}>;

const readJoinedChannelIds = async (apiBaseUrl: string, workspaceId: string): Promise<readonly string[]> => {
  const channelIds: string[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const url = new URL("/channels", apiBaseUrl);
    url.searchParams.set("scope", "joined");
    url.searchParams.set("limit", "50");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      headers: { "X-Workspace-Id": workspaceId }
    });
    if (!response.ok) throw new Error(response.status === 401
      ? "Your session expired. Sign in again and retry."
      : "Your joined channels could not be loaded. No settings were changed.");
    const parsed = channelPageSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("The server returned an invalid channel list. No settings were changed.");
    channelIds.push(...parsed.data.channels.map(({ id }) => id));
    cursor = parsed.data.nextCursor;
    if (cursor && seenCursors.has(cursor)) throw new Error("Channel paging stopped unexpectedly. No settings were changed.");
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return channelIds;
};

export const applyChannelNotificationPreference = async ({
  apiBaseUrl, workspaceId, preference, onProgress
}: ApplyPreferencesInput): Promise<ApplyPreferencesResult> => {
  const channelIds = await readJoinedChannelIds(apiBaseUrl, workspaceId);
  let completed = 0;
  let updated = 0;
  let nextIndex = 0;
  onProgress(0, channelIds.length);

  const worker = async (): Promise<void> => {
    while (nextIndex < channelIds.length) {
      const channelId = channelIds[nextIndex++];
      if (!channelId) continue;
      try {
        const response = await fetch(new URL(
          `/channels/${encodeURIComponent(channelId)}/notification-preference`, apiBaseUrl
        ), {
          method: "PATCH",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId },
          body: JSON.stringify({ preference })
        });
        const parsed = response.ok ? preferenceResponseSchema.safeParse(await response.json()) : null;
        if (parsed?.success && parsed.data.preference === preference) updated += 1;
      } catch {
        // This channel is reported as failed; reapplying the same preference is safe.
      } finally {
        completed += 1;
        onProgress(completed, channelIds.length);
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(UPDATE_CONCURRENCY, channelIds.length) },
    () => worker()
  ));
  return { total: channelIds.length, updated, failed: channelIds.length - updated };
};
