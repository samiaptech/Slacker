import type { ReactElement } from "react";
import { createApiConfiguration, readWebEnvironment } from "@/config";
import { WorkspaceInvitation } from "@/features/identity";

type WorkspaceInvitePageProps = Readonly<{ params: Promise<Readonly<{ token: string }>> }>;

const WorkspaceInvitePage = async ({ params }: WorkspaceInvitePageProps): Promise<ReactElement> => {
  const { token } = await params;
  const api = createApiConfiguration(readWebEnvironment());
  return <WorkspaceInvitation apiBaseUrl={api.baseUrl} token={token} />;
};

export default WorkspaceInvitePage;
