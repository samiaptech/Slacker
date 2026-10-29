"use client";

import { useState, type ReactElement } from "react";
import { AtSign, Bell, BellOff, LoaderCircle } from "lucide-react";
import type { ChannelNotificationPreference } from "@workspace/types";
import { z } from "zod";
import { Button, Label } from "@workspace/ui";
import { RadioGroup, RadioGroupItem } from "@workspace/ui/primitives";
import { applyChannelNotificationPreference } from "./apply-channel-notification-preference";

const preferences: readonly Readonly<{
  value: ChannelNotificationPreference;
  label: string;
  description: string;
  icon: typeof Bell;
}>[] = [
  { value: "all", label: "All activity", description: "Messages and channel updates", icon: Bell },
  { value: "mentions_only", label: "Mentions only", description: "Only when someone mentions you", icon: AtSign },
  { value: "muted", label: "Muted", description: "No channel notifications", icon: BellOff }
];
const preferenceSchema = z.enum(["all", "mentions_only", "muted"]);

type ProfileChannelNotificationsProps = Readonly<{ apiBaseUrl: string; workspaceId: string; workspaceName: string }>;

export const ProfileChannelNotifications = ({
  apiBaseUrl, workspaceId, workspaceName
}: ProfileChannelNotificationsProps): ReactElement => {
  const [preference, setPreference] = useState<ChannelNotificationPreference>("all");
  const [isApplying, setIsApplying] = useState(false);
  const [progress, setProgress] = useState<Readonly<{ completed: number; total: number }> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isFailure, setIsFailure] = useState(false);

  const apply = async (): Promise<void> => {
    if (isApplying) return;
    setIsApplying(true);
    setProgress(null);
    setMessage(null);
    setIsFailure(false);
    try {
      const result = await applyChannelNotificationPreference({
        apiBaseUrl,
        workspaceId,
        preference,
        onProgress: (completed, total) => setProgress({ completed, total })
      });
      if (result.total === 0) setMessage("You have no joined channels to update.");
      else if (result.failed === 0) setMessage(`Updated notifications in all ${result.total} joined channels.`);
      else {
        setIsFailure(true);
        setMessage(`Updated ${result.updated} of ${result.total} channels. Retry to apply the setting everywhere.`);
      }
    } catch (error: unknown) {
      setIsFailure(true);
      setMessage(error instanceof Error ? error.message : "Channel notification settings could not be updated.");
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <section aria-labelledby="profile-channel-notifications-title" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <h2 className="font-semibold text-foreground" id="profile-channel-notifications-title">Channel notifications</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">Choose a preference for every channel you’ve joined in {workspaceName}.</p>
      <RadioGroup
        aria-label="Preference to apply across joined channels"
        className="mt-4 gap-2"
        disabled={isApplying}
        onValueChange={(value) => {
          const parsed = preferenceSchema.safeParse(value);
          if (parsed.success) setPreference(parsed.data);
        }}
        value={preference}
      >
        {preferences.map(({ value, label, description, icon: Icon }) => (
          <Label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/70 bg-background px-3 py-2.5 hover:bg-accent/40" htmlFor={`profile-channel-pref-${value}`} key={value}>
            <RadioGroupItem id={`profile-channel-pref-${value}`} value={value} />
            <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
            <span><span className="block text-sm font-medium text-foreground">{label}</span><span className="block text-xs text-muted-foreground">{description}</span></span>
          </Label>
        ))}
      </RadioGroup>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">Only channels you’ve already joined are updated. New channels keep their own setting.</p>
      <Button className="mt-4 w-full rounded-xl" disabled={isApplying} onClick={() => void apply()} type="button">
        {isApplying ? <><LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin" />Updating {progress ? `${progress.completed}/${progress.total}` : "channels…"}</> : "Apply to all joined channels"}
      </Button>
      {message ? <p className={`mt-3 text-sm ${isFailure ? "text-destructive" : "text-muted-foreground"}`} role={isFailure ? "alert" : "status"}>{message}</p> : null}
    </section>
  );
};
