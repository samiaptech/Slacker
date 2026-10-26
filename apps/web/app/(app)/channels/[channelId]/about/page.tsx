import type { ReactElement } from "react";
import { createApiConfiguration, readWebEnvironment } from "@/config";
import { ChannelPage } from "@/features/channels";

type ChannelAboutRouteProps = Readonly<{ params: Promise<Readonly<{ channelId: string }>> }>;

const ChannelAboutRoute = async ({ params }: ChannelAboutRouteProps): Promise<ReactElement> => {
  const { channelId } = await params;
  const api = createApiConfiguration(readWebEnvironment());
  return <ChannelPage apiBaseUrl={api.baseUrl} channelId={channelId} view="about" />;
};

export default ChannelAboutRoute;
