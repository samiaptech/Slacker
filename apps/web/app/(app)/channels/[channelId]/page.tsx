import type { ReactElement } from "react";
import { createApiConfiguration, readWebEnvironment } from "@/config";
import { ChannelPage } from "@/features/channels";

type ChannelRouteProps = Readonly<{ params: Promise<Readonly<{ channelId: string }>> }>;

const ChannelRoute = async ({ params }: ChannelRouteProps): Promise<ReactElement> => {
  const { channelId } = await params;
  const api = createApiConfiguration(readWebEnvironment());
  return <ChannelPage apiBaseUrl={api.baseUrl} channelId={channelId} />;
};

export default ChannelRoute;
