"use client";

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { AtSign, Bell, BellOff, LoaderCircle } from "lucide-react";
import type { ChannelNotificationPreference, ChannelNotificationPreferenceResponse } from "@workspace/types";
import { z } from "zod";
import { Button, Label } from "@workspace/ui";
import { RadioGroup, RadioGroupItem } from "@workspace/ui/primitives";
import { fetchSharedGet } from "@/app/fetch-shared-get";

const preferenceSchema = z.object({
  preference: z.enum(["all", "mentions_only", "muted"])
}).strict() satisfies z.ZodType<ChannelNotificationPreferenceResponse>;

type PreferenceState = Readonly<{
  key: string;
  preference: ChannelNotificationPreference | null;
  error: string | null;
}>;

type ChannelNotificationPreferencesProps = Readonly<{
  apiBaseUrl: string;
  channelId: string;
  workspaceId: string;
  enabled: boolean;
}>;

const options: readonly Readonly<{
  value: ChannelNotificationPreference;
  label: string;
  description: string;
  icon: typeof Bell;
}>[] = [
  { value: "all", label: "All activity", description: "Messages and channel updates", icon: Bell },
  { value: "mentions_only", label: "Mentions only", description: "Only when someone mentions you", icon: AtSign },
  { value: "muted", label: "Muted", description: "No channel notifications", icon: BellOff }
];

const getRequestError = (status: number): string => status === 401
  ? "Your session expired. Sign in again to change this setting."
  : status === 403 || status === 404
    ? "This channel is unavailable or you no longer have access."
    : status === 503
      ? "Channel settings are temporarily unavailable. Try again shortly."
      : "The notification setting could not be saved. Try again.";

export const ChannelNotificationPreferences = ({
  apiBaseUrl, channelId, workspaceId, enabled
}: ChannelNotificationPreferencesProps): ReactElement => {
  const [retry, setRetry] = useState(0);
  const requestKey = `${workspaceId}:${channelId}:${retry}`;
  const [result, setResult] = useState<PreferenceState | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const current = result?.key === requestKey ? result : null;
  const preference = current?.preference ?? null;
  const error = current?.error ?? null;
  const isLoading = enabled && !current;
  const isSaving = savingKey === requestKey;

  useEffect(() => {
    if (!enabled || result?.key === requestKey) return;
    const controller = new AbortController();
    void fetchSharedGet(new URL(`/channels/${encodeURIComponent(channelId)}/notification-preference`, apiBaseUrl), {
      credentials: "include",
      cache: "no-store",
      headers: { "X-Workspace-Id": workspaceId },
      signal: controller.signal
    }).then(async (response) => {
      if (!response.ok) throw new Error(getRequestError(response.status));
      const parsed = preferenceSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("The server returned an invalid notification setting.");
      setResult({ key: requestKey, preference: parsed.data.preference, error: null });
    }).catch((requestError: unknown) => {
      if (controller.signal.aborted) return;
      setResult({
        key: requestKey,
        preference: null,
        error: requestError instanceof Error ? requestError.message : "Notification settings could not be loaded."
      });
    });
    return () => controller.abort();
  }, [apiBaseUrl, channelId, enabled, requestKey, result, workspaceId]);

  const savePreference = useCallback(async (nextPreference: ChannelNotificationPreference): Promise<void> => {
    if (!preference || isSaving || nextPreference === preference) return;
    const previousPreference = preference;
    setResult({ key: requestKey, preference: nextPreference, error: null });
    setSavingKey(requestKey);
    try {
      const response = await fetch(new URL(`/channels/${encodeURIComponent(channelId)}/notification-preference`, apiBaseUrl), {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId },
        body: JSON.stringify({ preference: nextPreference })
      });
      if (!response.ok) throw new Error(getRequestError(response.status));
      const parsed = preferenceSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("The server returned an invalid notification setting.");
      setResult({ key: requestKey, preference: parsed.data.preference, error: null });
    } catch (requestError: unknown) {
      setResult({
        key: requestKey,
        preference: previousPreference,
        error: requestError instanceof Error ? requestError.message : "The notification setting could not be saved."
      });
    } finally {
      setSavingKey((currentKey) => currentKey === requestKey ? null : currentKey);
    }
  }, [apiBaseUrl, channelId, isSaving, preference, requestKey, workspaceId]);

  return (
    <section aria-labelledby="channel-notification-preferences-title" className="border-b border-[#e6e9e2] px-4 py-4 sm:px-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#293a32]" id="channel-notification-preferences-title">Your notifications</h3>
          <p className="mt-1 text-xs leading-relaxed text-[#77817b]">Choose what reaches your notification inbox.</p>
        </div>
        {isSaving ? <LoaderCircle aria-label="Saving notification preference" className="mt-0.5 size-4 animate-spin text-[#507b68]" /> : null}
      </div>
      {isLoading ? (
        <p className="flex items-center gap-2 py-3 text-xs text-muted-foreground" role="status">
          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> Loading your setting…
        </p>
      ) : error && !preference ? (
        <div className="space-y-2 rounded-xl bg-white/80 p-3">
          <p className="text-xs text-destructive" role="alert">{error}</p>
          <Button onClick={() => setRetry((value) => value + 1)} size="sm" type="button" variant="outline">Retry</Button>
        </div>
      ) : preference ? (
        <>
          <RadioGroup
            aria-label="Channel notification preference"
            className="gap-1.5"
            disabled={isSaving}
            onValueChange={(value) => {
              const parsed = preferenceSchema.shape.preference.safeParse(value);
              if (parsed.success) void savePreference(parsed.data);
            }}
            value={preference}
          >
            {options.map(({ value, label, description, icon: Icon }) => {
              const id = `channel-notification-${channelId}-${value}`;
              const selected = preference === value;
              return (
                <Label
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-2.5 py-2.5 transition-colors ${selected ? "border-[#9eb8a5] bg-[#edf3ed]" : "border-transparent bg-white/70 hover:border-[#dce5dc] hover:bg-white"} ${isSaving ? "cursor-wait opacity-75" : ""}`}
                  htmlFor={id}
                  key={value}
                >
                  <RadioGroupItem className="size-4 shrink-0" id={id} value={value} />
                  <Icon aria-hidden="true" className={`size-4 shrink-0 ${selected ? "text-[#507b68]" : "text-[#7c8980]"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-[#35463c]">{label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-[#7a847d]">{description}</span>
                  </span>
                </Label>
              );
            })}
          </RadioGroup>
          <p className="mt-2 text-[10px] leading-relaxed text-[#879089]">Applies to new notifications; existing ones stay in your inbox.</p>
          {error ? <p className="mt-2 text-xs text-destructive" role="alert">{error} Your previous choice is still active.</p> : null}
        </>
      ) : null}
    </section>
  );
};
