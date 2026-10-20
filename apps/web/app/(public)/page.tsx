import type { ReactElement } from "react";
import { createApiConfiguration, readWebEnvironment } from "@/config";
import { ChannelWorkspace } from "@/features/channels";
import { WorkspaceAccess } from "@/features/identity";

const HomePage = (): ReactElement => {
  const api = createApiConfiguration(readWebEnvironment());
  return (
    <WorkspaceAccess apiBaseUrl={api.baseUrl} fullWidth>
      <ChannelWorkspace apiBaseUrl={api.baseUrl}>
        <section aria-labelledby="channel-home-title" className="flex min-h-[24rem] flex-col justify-center text-center">
          <h2 className="text-xl font-semibold text-foreground" id="channel-home-title">Select a channel</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Choose a channel or member from the sidebar to open a conversation, or create a channel for a team discussion.
          </p>
        </section>
      </ChannelWorkspace>
    </WorkspaceAccess>
  );
};

export default HomePage;
