import type { ReactElement } from "react";
import { createApiConfiguration, readWebEnvironment } from "@/config";
import { ChannelWorkspace } from "@/features/channels";
import { DirectMessagePage } from "@/features/direct-messages";
import { WorkspaceAccess } from "@/features/identity";

type DirectMessageRouteProps = Readonly<{
  params: Promise<Readonly<{ conversationId: string }>>;
}>;

const DirectMessageRoute = async ({ params }: DirectMessageRouteProps): Promise<ReactElement> => {
  const { conversationId } = await params;
  const api = createApiConfiguration(readWebEnvironment());
  return (
    <WorkspaceAccess apiBaseUrl={api.baseUrl} fullWidth>
      <ChannelWorkspace apiBaseUrl={api.baseUrl}>
        <DirectMessagePage apiBaseUrl={api.baseUrl} conversationId={conversationId} />
      </ChannelWorkspace>
    </WorkspaceAccess>
  );
};

export default DirectMessageRoute;
