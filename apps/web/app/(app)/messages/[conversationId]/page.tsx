import type { ReactElement } from "react";
import { createApiConfiguration, readWebEnvironment } from "@/config";
import { DirectMessagePage } from "@/features/direct-messages";

type DirectMessageRouteProps = Readonly<{
  params: Promise<Readonly<{ conversationId: string }>>;
}>;

const DirectMessageRoute = async ({ params }: DirectMessageRouteProps): Promise<ReactElement> => {
  const { conversationId } = await params;
  const api = createApiConfiguration(readWebEnvironment());
  return <DirectMessagePage apiBaseUrl={api.baseUrl} conversationId={conversationId} />;
};

export default DirectMessageRoute;
