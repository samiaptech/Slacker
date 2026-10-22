import type { ReactElement } from "react";
import { createApiConfiguration, readWebEnvironment } from "@/config";
import { WorkspaceMemberProfile } from "@/features/identity";

type WorkspaceMemberRouteProps = Readonly<{
  params: Promise<Readonly<{ userId: string }>>;
}>;

const WorkspaceMemberRoute = async ({ params }: WorkspaceMemberRouteProps): Promise<ReactElement> => {
  const { userId } = await params;
  const api = createApiConfiguration(readWebEnvironment());
  return <WorkspaceMemberProfile apiBaseUrl={api.baseUrl} userId={userId} />;
};

export default WorkspaceMemberRoute;
