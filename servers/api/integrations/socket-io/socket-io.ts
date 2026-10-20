import type { IncomingHttpHeaders, Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { RealtimeClientEvents, RealtimeServerEvents } from "@workspace/types";
import type { Logger } from "@workspace/logging";
import type { AuthenticationIdentity } from "../authentication/index.js";

export type AuthenticatedSocketData = {
  identity: AuthenticationIdentity;
  workspaceId: string | null;
};

export type SocketIoApi = Readonly<{
  io: Server<RealtimeClientEvents, RealtimeServerEvents, Record<string, never>, AuthenticatedSocketData>;
  attach: (server: HttpServer) => void;
  close: () => Promise<void>;
}>;

type SocketIoDependencies = Readonly<{
  webOrigin: string;
  getIdentity: (headers: IncomingHttpHeaders) => Promise<AuthenticationIdentity | null>;
  logger: Logger;
}>;

export const createSocketIoIntegration = ({
  webOrigin,
  getIdentity,
  logger
}: SocketIoDependencies): SocketIoApi => {
  const io = new Server<
    RealtimeClientEvents,
    RealtimeServerEvents,
    Record<string, never>,
    AuthenticatedSocketData
  >({
    cors: { origin: webOrigin, credentials: true },
    serveClient: false
  });

  io.use((socket, next) => {
    const origin = socket.handshake.headers.origin;
    if (origin && origin !== webOrigin) {
      logger.warn("Realtime connection rejected.", { reason: "origin_not_allowed" });
      next(new Error("Realtime origin is not allowed."));
      return;
    }
    void getIdentity(socket.handshake.headers)
      .then((identity) => {
        if (!identity) {
          logger.warn("Realtime connection rejected.", { reason: "unauthenticated" });
          next(new Error("Authentication required."));
          return;
        }
        socket.data.identity = identity;
        socket.data.workspaceId = null;
        next();
      })
      .catch((error: unknown) => {
        logger.error("Realtime authentication failed.", {
          error: error instanceof Error ? error.message : "Unknown authentication error."
        });
        next(new Error("Realtime authentication is unavailable."));
      });
  });

  return Object.freeze({
    io,
    attach: (server) => io.attach(server),
    close: () => new Promise<void>((resolve) => io.close(() => resolve()))
  });
};
