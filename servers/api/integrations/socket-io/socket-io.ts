import type { IncomingHttpHeaders, Server as HttpServer } from "node:http";
import { isIP } from "node:net";
import { performance } from "node:perf_hooks";
import { createAdapter as createMongoAdapter } from "@socket.io/mongo-adapter";
import type { Collection } from "mongodb";
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

export const SOCKET_SESSION_REVALIDATION_INTERVAL_MS = 30_000;
export const SOCKET_CONNECTIONS_PER_USER_LIMIT = 5;
export const SOCKET_CONNECTIONS_PER_IP_LIMIT = 20;
export const SOCKET_EVENTS_PER_USER_PER_SECOND_LIMIT = 30;
export const SOCKET_MAX_PAYLOAD_BYTES = 16 * 1024;

export type SocketIoLimits = Readonly<{
  connectionsPerUser: number;
  connectionsPerIp: number;
  eventsPerUserPerSecond: number;
}>;

type EventBucket = { tokens: number; updatedAt: number };

type SocketIoDependencies = Readonly<{
  webOrigin: string;
  getIdentity: (headers: IncomingHttpHeaders) => Promise<AuthenticationIdentity | null>;
  logger: Logger;
  adapterCollection?: Collection;
  sessionRevalidationIntervalMs?: number;
  limits?: Partial<SocketIoLimits>;
  trustVercelForwardedFor?: boolean;
}>;

const normalizeIp = (value: string): string | null => {
  const candidate = value.trim();
  if (isIP(candidate) === 0) return null;
  return candidate.toLowerCase().startsWith("::ffff:")
    ? candidate.slice("::ffff:".length)
    : candidate;
};

const resolveSocketClientIp = (
  headers: IncomingHttpHeaders,
  remoteAddress: string,
  trustVercelForwardedFor: boolean
): string => {
  if (trustVercelForwardedFor) {
    const forwarded = headers["x-vercel-forwarded-for"];
    const forwardedIp = typeof forwarded === "string" ? normalizeIp(forwarded) : null;
    if (forwardedIp) return forwardedIp;
  }
  return normalizeIp(remoteAddress) ?? "unknown";
};

export const createSocketIoIntegration = ({
  webOrigin,
  getIdentity,
  logger,
  adapterCollection,
  sessionRevalidationIntervalMs = SOCKET_SESSION_REVALIDATION_INTERVAL_MS,
  limits,
  trustVercelForwardedFor = false
}: SocketIoDependencies): SocketIoApi => {
  const configuredLimits: SocketIoLimits = Object.freeze({
    connectionsPerUser: limits?.connectionsPerUser ?? SOCKET_CONNECTIONS_PER_USER_LIMIT,
    connectionsPerIp: limits?.connectionsPerIp ?? SOCKET_CONNECTIONS_PER_IP_LIMIT,
    eventsPerUserPerSecond: limits?.eventsPerUserPerSecond ?? SOCKET_EVENTS_PER_USER_PER_SECOND_LIMIT
  });
  const connectionsByUser = new Map<string, number>();
  const connectionsByIp = new Map<string, number>();
  const eventBucketsByUser = new Map<string, EventBucket>();
  const increment = (counts: Map<string, number>, key: string): number => {
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    return next;
  };
  const decrement = (counts: Map<string, number>, key: string): number => {
    const next = (counts.get(key) ?? 1) - 1;
    if (next <= 0) {
      counts.delete(key);
      return 0;
    }
    counts.set(key, next);
    return next;
  };
  const io = new Server<
    RealtimeClientEvents,
    RealtimeServerEvents,
    Record<string, never>,
    AuthenticatedSocketData
  >({
    cors: { origin: webOrigin, credentials: true },
    maxHttpBufferSize: SOCKET_MAX_PAYLOAD_BYTES,
    serveClient: false
  });
  if (adapterCollection) {
    io.adapter(createMongoAdapter(adapterCollection, { addCreatedAtField: true }));
    logger.info("Socket.IO MongoDB adapter enabled for cross-instance broadcasts.");
  }

  io.use((socket, next) => {
    const origin = socket.handshake.headers.origin;
    if (origin !== webOrigin) {
      logger.warn("Realtime connection rejected.", {
        reason: origin ? "origin_not_allowed" : "origin_missing"
      });
      next(new Error("Realtime origin is not allowed."));
      return;
    }
    const clientIp = resolveSocketClientIp(
      socket.handshake.headers,
      socket.handshake.address,
      trustVercelForwardedFor
    );
    if ((connectionsByIp.get(clientIp) ?? 0) >= configuredLimits.connectionsPerIp) {
      logger.warn("Realtime connection rejected.", { reason: "ip_connection_limit" });
      next(new Error("Realtime connection limit reached."));
      return;
    }
    increment(connectionsByIp, clientIp);
    let ipSlotReserved = true;
    const releaseIpSlot = (): void => {
      if (!ipSlotReserved) return;
      ipSlotReserved = false;
      decrement(connectionsByIp, clientIp);
    };
    void getIdentity(socket.handshake.headers)
      .then((identity) => {
        if (!identity) {
          releaseIpSlot();
          logger.warn("Realtime connection rejected.", { reason: "unauthenticated" });
          next(new Error("Authentication required."));
          return;
        }
        if ((connectionsByUser.get(identity.id) ?? 0) >= configuredLimits.connectionsPerUser) {
          releaseIpSlot();
          logger.warn("Realtime connection rejected.", { reason: "user_connection_limit" });
          next(new Error("Realtime connection limit reached."));
          return;
        }
        increment(connectionsByUser, identity.id);
        socket.data.identity = identity;
        socket.data.workspaceId = null;
        socket.once("disconnect", () => {
          releaseIpSlot();
          if (decrement(connectionsByUser, identity.id) === 0) {
            eventBucketsByUser.delete(identity.id);
          }
        });
        socket.onAny(() => {
          const now = performance.now();
          const previous = eventBucketsByUser.get(identity.id);
          const bucket = previous ?? { tokens: configuredLimits.eventsPerUserPerSecond, updatedAt: now };
          bucket.tokens = Math.min(
            configuredLimits.eventsPerUserPerSecond,
            bucket.tokens + ((now - bucket.updatedAt) * configuredLimits.eventsPerUserPerSecond) / 1_000
          );
          bucket.updatedAt = now;
          if (bucket.tokens < 1) {
            eventBucketsByUser.set(identity.id, bucket);
            logger.warn("Realtime connection closed after exceeding the event rate limit.", {
              reason: "user_event_rate_limit"
            });
            socket.disconnect(true);
            return;
          }
          bucket.tokens -= 1;
          eventBucketsByUser.set(identity.id, bucket);
        });
        next();
      })
      .catch((error: unknown) => {
        releaseIpSlot();
        logger.error("Realtime authentication failed.", {
          error: error instanceof Error ? error.message : "Unknown authentication error."
        });
        next(new Error("Realtime authentication is unavailable."));
      });
  });

  io.on("connection", (socket) => {
    let revalidationInProgress = false;
    const revalidationTimer = setInterval(() => {
      if (revalidationInProgress || !socket.connected) return;
      revalidationInProgress = true;
      void getIdentity(socket.handshake.headers)
          .then((identity) => {
            if (!identity || identity.id !== socket.data.identity.id) {
              logger.warn("Realtime connection closed after session invalidation.", {
                reason: "session_invalid"
              });
              socket.disconnect(true);
              return;
            }
            socket.data.identity = identity;
          })
          .catch((error: unknown) => {
            logger.error("Realtime session revalidation failed; closing connection.", {
              error: error instanceof Error ? error.message : "Unknown authentication error."
            });
            socket.disconnect(true);
          })
          .finally(() => {
            revalidationInProgress = false;
          });
    }, sessionRevalidationIntervalMs);
    revalidationTimer.unref();
    socket.once("disconnect", () => {
      clearInterval(revalidationTimer);
    });
  });

  return Object.freeze({
    io,
    attach: (server) => io.attach(server),
    close: async () => {
      await io.close();
    }
  });
};
