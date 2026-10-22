import type { ReactElement } from "react";
import type { RootLayoutProps } from "@/types";
import { createApiConfiguration, readWebEnvironment } from "@/config";
import { ChannelWorkspace } from "@/features/channels";
import { WorkspaceAccess } from "@/features/identity";

const ApplicationLayout = ({ children }: RootLayoutProps): ReactElement => {
  const api = createApiConfiguration(readWebEnvironment());
  return (
    <WorkspaceAccess apiBaseUrl={api.baseUrl} fullWidth>
      <ChannelWorkspace apiBaseUrl={api.baseUrl}>{children}</ChannelWorkspace>
    </WorkspaceAccess>
  );
};

export default ApplicationLayout;
