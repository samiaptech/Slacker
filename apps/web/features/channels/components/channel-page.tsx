"use client";

import { useEffect, useState, type ReactElement } from "react";
import { channelResponseSchema, type ChannelResponseView } from "../types";
import { ChannelMembersPanel } from "./channel-members-panel";
import { ChannelMessages } from "./channel-messages";
import { ChannelProfilePanel } from "./channel-profile-panel";
import { useChannelProfileToggle } from "./channel-profile-toggle-context";
import { useWorkspaceContext } from "@/features/workspace-foundation/public";

type ChannelPageProps = Readonly<{ apiBaseUrl: string; channelId: string }>;

export const ChannelPage = ({ apiBaseUrl, channelId }: ChannelPageProps): ReactElement => {
  const { activeWorkspace } = useWorkspaceContext();
  const [channel, setChannel] = useState<ChannelResponseView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { isOpen: isProfileOpen, setIsOpen: setIsProfileOpen } = useChannelProfileToggle();

  useEffect(() => {
    const controller = new AbortController();
    const loadChannel = async (): Promise<void> => {
      setChannel(null);
      setErrorMessage(null);
      setIsLoading(true);
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {isLoading ? (
          channel ? null : (
            <ChannelMessages
              apiBaseUrl={apiBaseUrl}
              canSend={false}
              channelId={channelId}
              channelDescription={null}
              channelName="channel"
            />
          )
        ) : errorMessage ? (
          <section aria-labelledby="channel-error-title" className="m-4 rounded-xl border border-border bg-card p-8">
            <h1 className="text-xl font-semibold text-foreground" id="channel-error-title">Channel unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground" role="alert">{errorMessage}</p>
          </section>
        ) : channel ? (
          <ChannelMessages
            apiBaseUrl={apiBaseUrl}
            canSend={channel.lifecycleState === "active"}
            channelId={channel.id}
            channelDescription={channel.description}
            channelName={channel.name}
          />
        ) : null}
      </div>
      {channel ? (
        <ChannelProfilePanel
          apiBaseUrl={apiBaseUrl}
          channelId={channel.id}
          channelName={channel.name}
          description={channel.description}
          isOpen={isProfileOpen}
          onOpenChange={setIsProfileOpen}
          managementPanel={channel.visibility === "private" ? (
            <ChannelMembersPanel apiBaseUrl={apiBaseUrl} channelId={channel.id} isActive={channel.lifecycleState === "active"} />
          ) : undefined}
          visibility={channel.visibility}
        />
      ) : null}
    </div>
  );
};
