import type { ReactElement } from "react";
import { createApiConfiguration, readWebEnvironment } from "@/config";
import { ChannelWorkspace } from "@/features/channels";
import { ProfilePage, WorkspaceAccess } from "@/features/identity";

const ProfileRoute = (): ReactElement => {
  const api = createApiConfiguration(readWebEnvironment());
  return (
    <WorkspaceAccess apiBaseUrl={api.baseUrl}>
      <ChannelWorkspace apiBaseUrl={api.baseUrl}>
        <ProfilePage apiBaseUrl={api.baseUrl} />
      </ChannelWorkspace>
    </WorkspaceAccess>
  );
};

export default ProfileRoute;
