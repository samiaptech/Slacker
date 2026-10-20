"use client";

import { useEffect, useState, type ReactElement } from "react";
import Link from "next/link";
import { Button } from "@workspace/ui";
import { channelResponseSchema, type ChannelResponseView } from "../types";
import { ChannelMembersPanel } from "./channel-members-panel";
import { ChannelMessages } from "./channel-messages";
import { useWorkspaceContext } from "@/features/workspace-foundation/public";

type ChannelPageProps = Readonly<{ apiBaseUrl: string; channelId: string }>;

export const ChannelPage = ({ apiBaseUrl, channelId }: ChannelPageProps): ReactElement => {
  const { activeWorkspace } = useWorkspaceContext();
  const [channel, setChannel] = useState<ChannelResponseView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const loadChannel = async (): Promise<void> => {
      try {
        const response = await fetch(new URL(`/channels/${encodeURIComponent(channelId)}`, apiBaseUrl), {
          credentials: "include",
          cache: "no-store",
          headers: { "X-Workspace-Id": activeWorkspace.id },
          signal: controller.signal
        });
        if (!response.ok) {
          setErrorMessage(response.status === 401
            ? "Your session has expired. Sign in again to open this channel."
            : "This channel is unavailable or you do not have access.");
          return;
        }
        const parsed = channelResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          setErrorMessage("The server returned invalid channel details. Please try again.");
          return;
        }
        setChannel(parsed.data);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setErrorMessage("The channel could not be loaded. Check your connection and try again.");
      } finally {
        setIsLoading(false);
      }
    };
    void loadChannel();
    return () => controller.abort();
  }, [activeWorkspace.id, apiBaseUrl, channelId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <Button asChild variant="outline"><Link href="/">Back to workspace</Link></Button>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">Opening channel…</p>
      ) : errorMessage ? (
        <section aria-labelledby="channel-error-title" className="rounded-xl border border-border bg-card p-8">
          <h1 className="text-xl font-semibold text-foreground" id="channel-error-title">Channel unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground" role="alert">{errorMessage}</p>
        </section>
      ) : channel ? (
        <>
          <section aria-labelledby="channel-title" className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <p className="text-sm font-medium text-primary">
              {channel.visibility === "public" ? "Public channel" : "Private channel"}
              {channel.lifecycleState === "archived" ? " · Archived" : ""}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground" id="channel-title">
              # {channel.name}
            </h1>
            {channel.description ? (
              <p className="mt-3 text-sm text-muted-foreground">{channel.description}</p>
            ) : null}
          </section>
          <ChannelMessages
            apiBaseUrl={apiBaseUrl}
            canSend={channel.lifecycleState === "active"}
            channelId={channel.id}
          />
        </>
      ) : null}
      {channel?.visibility === "private" ? (
        <ChannelMembersPanel
          apiBaseUrl={apiBaseUrl}
          channelId={channel.id}
          isActive={channel.lifecycleState === "active"}
        />
      ) : null}
    </div>
  );
};
