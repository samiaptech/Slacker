import type { Logger } from "@workspace/logging";
import type { MongoDbIntegration } from "../integrations/index.js";
import type { SocketIoApi } from "../integrations/index.js";
import type { ApiServer } from "./create-server.js";
import type { OpenTelemetryIntegration } from "../integrations/index.js";

type ShutdownDependencies = Readonly<{
  database: Pick<MongoDbIntegration, "disconnect">;
  logger: Logger;
  server: Pick<ApiServer, "stop">;
  socketIo?: Pick<SocketIoApi, "close">;
  telemetry?: Pick<OpenTelemetryIntegration, "shutdown">;
}>;

export const createShutdown = ({ database, logger, server, socketIo, telemetry }: ShutdownDependencies) =>
  async (signal: NodeJS.Signals): Promise<void> => {
    logger.info("API shutdown requested.", { signal });
    await socketIo?.close();
    await server.stop();
    await telemetry?.shutdown();
    await database.disconnect();
  };
