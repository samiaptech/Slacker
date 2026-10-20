import type { ReactElement } from "react";
import { createApiConfiguration, readWebEnvironment } from "@/config";
import { ChannelWorkspace } from "@/features/channels";
import { WorkspaceAccess, WorkspaceMemberProfile } from "@/features/identity";

type WorkspaceMemberRouteProps = Readonly<{
  params: Promise<Readonly<{ userId: string }>>;
}>;

const WorkspaceMemberRoute = async ({ params }: WorkspaceMemberRouteProps): Promise<ReactElement> => {
  const { userId } = await params;
  const api = createApiConfiguration(readWebEnvironment());
  return (
    <WorkspaceAccess apiBaseUrl={api.baseUrl}>
      <ChannelWorkspace apiBaseUrl={api.baseUrl}>
        <WorkspaceMemberProfile apiBaseUrl={api.baseUrl} userId={userId} />
      </ChannelWorkspace>
    </WorkspaceAccess>
  );
};

export default WorkspaceMemberRoute;
