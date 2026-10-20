import type { ReactElement } from "react";
import { createApiConfiguration, readWebEnvironment } from "@/config";
import { ChannelPage, ChannelWorkspace } from "@/features/channels";
import { WorkspaceAccess } from "@/features/identity";

type ChannelRouteProps = Readonly<{ params: Promise<Readonly<{ channelId: string }>> }>;

const ChannelRoute = async ({ params }: ChannelRouteProps): Promise<ReactElement> => {
  const { channelId } = await params;
  const api = createApiConfiguration(readWebEnvironment());
  return (
    <WorkspaceAccess apiBaseUrl={api.baseUrl} fullWidth>
      <ChannelWorkspace apiBaseUrl={api.baseUrl}>
        <ChannelPage apiBaseUrl={api.baseUrl} channelId={channelId} />
      </ChannelWorkspace>
    </WorkspaceAccess>
  );
};

export default ChannelRoute;
