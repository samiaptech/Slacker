import { z } from "zod";
import type { Logger } from "@workspace/logging";
import type {
  DirectMessageResponse,
  MessageReactionToggleResponse,
  RealtimeClientEvents,
  RealtimeServerEvents
} from "@workspace/types";
import type { Socket } from "socket.io";
import type { AuthenticatedSocketData, SocketIoApi } from "../../../integrations/socket-io/index.js";
import type { DirectMessageService } from "../services/index.js";

type DirectMessageSocket = Socket<
  RealtimeClientEvents,
  RealtimeServerEvents,
  Record<string, never>,
  AuthenticatedSocketData
>;

export type DirectMessageRealtimePublisher = Readonly<{
  publishDirectMessage: (workspaceId: string, conversationId: string, message: DirectMessageResponse) => void;
  publishMessageUpdated: (workspaceId: string, conversationId: string, message: DirectMessageResponse) => void;
  publishMessageDeleted: (workspaceId: string, conversationId: string, messageId: string) => void;
  publishMessageReactions: (
    workspaceId: string,
    conversationId: string,
    payload: MessageReactionToggleResponse
  ) => void;
  publishConversationChanged: (workspaceId: string) => void;
}>;

type DirectMessageRealtimeDependencies = Readonly<{
  socketIo: SocketIoApi;
  service: Pick<DirectMessageService, "get">;
  logger: Logger;
}>;

const conversationIdSchema = z.string().trim().min(1).max(128);
const typingSchema = z.object({
  conversationId: conversationIdSchema,
  active: z.boolean()
}).strict();

const workspaceRoom = (workspaceId: string): string => `workspace:${encodeURIComponent(workspaceId)}`;
const directMessageRoom = (workspaceId: string, conversationId: string): string =>
  `direct-message:${encodeURIComponent(workspaceId)}:${encodeURIComponent(conversationId)}`;

const reportFailure = (
  socket: DirectMessageSocket,
  logger: Logger,
  event: string,
  error: unknown
): void => {
  logger.error("Realtime direct-message operation failed.", {
    event,
    error: error instanceof Error ? error.message : "Unknown realtime error."
  });
  socket.emit("realtime:error", {
    event,
    message: "This realtime action could not be completed. Please try again."
  });
};

export const createDirectMessageRealtime = ({
  socketIo,
  service,
  logger
}: DirectMessageRealtimeDependencies): DirectMessageRealtimePublisher => {
  const { io } = socketIo;
  const lastTypingEventAt = new WeakMap<DirectMessageSocket, number>();

  io.on("connection", (rawSocket) => {
    const socket: DirectMessageSocket = rawSocket;
    socket.on("direct-message:subscribe", (requestedConversationId) => {
      void (async () => {
        const parsedId = conversationIdSchema.safeParse(requestedConversationId);
        const workspaceId = socket.data.workspaceId;
        if (!parsedId.success || !workspaceId) {
          socket.emit("realtime:error", {
            event: "direct-message:subscribe",
            message: "Subscribe to an accessible workspace and conversation."
          });
          return;
        }
        const result = await service.get(workspaceId, parsedId.data, socket.data.identity.id);
        if (result.kind !== "found") {
          socket.emit("realtime:error", {
            event: "direct-message:subscribe",
            message: result.kind === "unavailable"
              ? "Direct conversation access could not be verified. Please try again."
              : "You do not have access to this direct conversation."
          });
          return;
        }
        await socket.join(directMessageRoom(workspaceId, parsedId.data));
        socket.emit("direct-message:ready", { conversationId: parsedId.data });
      })().catch((error: unknown) => {
        reportFailure(socket, logger, "direct-message:subscribe", error);
      });
    });

    socket.on("direct-message:unsubscribe", (requestedConversationId) => {
      const parsedId = conversationIdSchema.safeParse(requestedConversationId);
      const workspaceId = socket.data.workspaceId;
      if (!parsedId.success || !workspaceId) {
        socket.emit("realtime:error", {
          event: "direct-message:unsubscribe",
          message: "The direct conversation subscription is invalid."
        });
        return;
      }
      void socket.leave(directMessageRoom(workspaceId, parsedId.data));
    });

    socket.on("direct-message:typing", (payload) => {
      void (async () => {
        const parsed = typingSchema.safeParse(payload);
        const workspaceId = socket.data.workspaceId;
        if (!parsed.success || !workspaceId) {
          socket.emit("realtime:error", {
            event: "direct-message:typing",
            message: "The typing update is invalid or the workspace is not active."
          });
          return;
        }
        const room = directMessageRoom(workspaceId, parsed.data.conversationId);
        if (!socket.rooms.has(room)) {
          socket.emit("realtime:error", {
            event: "direct-message:typing",
            message: "Subscribe to the conversation before sending typing updates."
          });
          return;
        }
        const access = await service.get(workspaceId, parsed.data.conversationId, socket.data.identity.id);
        if (access.kind !== "found") {
          await socket.leave(room);
          return;
        }
        const now = Date.now();
        const lastEventAt = lastTypingEventAt.get(socket) ?? 0;
        if (parsed.data.active && now - lastEventAt < 250) return;
        lastTypingEventAt.set(socket, now);
        socket.to(room).emit("direct-message:typing", {
          conversationId: parsed.data.conversationId,
          userId: socket.data.identity.id,
          active: parsed.data.active
        });
      })().catch((error: unknown) => {
        reportFailure(socket, logger, "direct-message:typing", error);
      });
    });
  });

  return Object.freeze({
    publishDirectMessage: (workspaceId, conversationId, message) => {
      io.to(directMessageRoom(workspaceId, conversationId)).emit("direct-message:new", message);
      io.to(workspaceRoom(workspaceId)).emit("workspace:direct-messages:changed");
    },
    publishMessageUpdated: (workspaceId, conversationId, message) => {
      io.to(directMessageRoom(workspaceId, conversationId)).emit("direct-message:updated", message);
    },
    publishMessageDeleted: (workspaceId, conversationId, messageId) => {
      io.to(directMessageRoom(workspaceId, conversationId)).emit("direct-message:deleted", {
        conversationId,
        messageId
      });
    },
    publishMessageReactions: (workspaceId, conversationId, payload) => {
      io.to(directMessageRoom(workspaceId, conversationId)).emit("direct-message:reactions", {
        conversationId,
        ...payload
      });
    },
    publishConversationChanged: (workspaceId) => {
      io.to(workspaceRoom(workspaceId)).emit("workspace:direct-messages:changed");
    }
  });
};
