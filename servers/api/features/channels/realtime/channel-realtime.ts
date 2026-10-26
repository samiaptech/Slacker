import { z } from "zod";
import type { Logger } from "@workspace/logging";
import type { ChannelMessageResponse, RealtimeClientEvents, RealtimeServerEvents } from "@workspace/types";
import type { Socket } from "socket.io";
import type { SocketIoApi, AuthenticatedSocketData } from "../../../integrations/socket-io/index.js";
import type { AuthenticationIdentity } from "../../../integrations/authentication/index.js";
import type { ChannelService } from "../services/index.js";
import type { ChannelSystemEntry } from "../domain/index.js";

type ChannelSocket = Socket<
  RealtimeClientEvents,
  RealtimeServerEvents,
  Record<string, never>,
  AuthenticatedSocketData
>;

export type ChannelRealtimePublisher = Readonly<{
  publishMessage: (workspaceId: string, channelId: string, message: ChannelMessageResponse) => void;
  publishMessageDeleted: (workspaceId: string, channelId: string, messageId: string) => void;
  publishChannelListChanged: (workspaceId: string) => void;
  publishWorkspaceMembersChanged: (workspaceId: string) => void;
  publishMembersChanged: (workspaceId: string, channelId: string) => void;
  publishSystemEntry?: (workspaceId: string, entry: ChannelSystemEntry) => void;
  revokeChannelAccess: (workspaceId: string, channelId: string, userId: string) => void;
  revokeWorkspaceAccess: (workspaceId: string, userId: string) => void;
}>;

type ChannelRealtimeDependencies = Readonly<{
  socketIo: SocketIoApi;
  channelService: Pick<ChannelService, "getForMember">;
  getWorkspaceAccess: (
    identity: AuthenticationIdentity,
    workspaceId: string
  ) => Promise<"allowed" | "denied" | "unavailable">;
  logger: Logger;
}>;

const workspaceIdSchema = z.string().trim().min(1).max(128);
const channelIdSchema = z.string().trim().min(1).max(128);
const typingPayloadSchema = z.object({
  channelId: channelIdSchema,
  active: z.boolean()
}).strict();

const workspaceRoom = (workspaceId: string): string => `workspace:${encodeURIComponent(workspaceId)}`;
const channelRoom = (workspaceId: string, channelId: string): string =>
  `channel:${encodeURIComponent(workspaceId)}:${encodeURIComponent(channelId)}`;
const userRoom = (userId: string): string => `user:${encodeURIComponent(userId)}`;

const reportFailure = (
  socket: ChannelSocket,
  logger: Logger,
  event: string,
  error: unknown
): void => {
  logger.error("Realtime channel operation failed.", {
    event,
    error: error instanceof Error ? error.message : "Unknown realtime error."
  });
  socket.emit("realtime:error", {
    event,
    message: "This realtime action could not be completed. Please try again."
  });
};

export const createChannelRealtime = ({
  socketIo,
  channelService,
  getWorkspaceAccess,
  logger
}: ChannelRealtimeDependencies): ChannelRealtimePublisher => {
  const { io } = socketIo;
  const onlineSockets = new Map<string, Map<string, Set<string>>>();
  const lastTypingEventAt = new WeakMap<ChannelSocket, number>();

  const removeWorkspacePresence = async (socket: ChannelSocket, workspaceId: string): Promise<void> => {
    const room = workspaceRoom(workspaceId);
    await socket.leave(room);
    for (const joinedRoom of socket.rooms) {
      if (joinedRoom.startsWith(`channel:${encodeURIComponent(workspaceId)}:`)) {
        await socket.leave(joinedRoom);
      }
    }
    const members = onlineSockets.get(workspaceId);
    const sockets = members?.get(socket.data.identity.id);
    sockets?.delete(socket.id);
    if (sockets?.size === 0) {
      members?.delete(socket.data.identity.id);
      io.to(room).emit("workspace:presence:changed", {
        userId: socket.data.identity.id,
        online: false
      });
    }
    if (members?.size === 0) onlineSockets.delete(workspaceId);
  };

  io.on("connection", (rawSocket) => {
    const socket: ChannelSocket = rawSocket;
    void socket.join(userRoom(socket.data.identity.id));

    socket.on("workspace:subscribe", (requestedWorkspaceId) => {
      void (async () => {
        const parsedWorkspaceId = workspaceIdSchema.safeParse(requestedWorkspaceId);
        if (!parsedWorkspaceId.success) {
          socket.emit("realtime:error", {
            event: "workspace:subscribe",
            message: "The requested workspace is invalid."
          });
          return;
        }
        const nextWorkspaceId = parsedWorkspaceId.data;
        const access = await getWorkspaceAccess(socket.data.identity, nextWorkspaceId);
        if (access !== "allowed") {
          socket.emit("realtime:error", {
            event: "workspace:subscribe",
            message: access === "unavailable"
              ? "Workspace access could not be verified. Please try again."
              : "You do not have access to this workspace."
          });
          return;
        }
        const currentWorkspaceId = socket.data.workspaceId;
        if (currentWorkspaceId && currentWorkspaceId !== nextWorkspaceId) {
          await removeWorkspacePresence(socket, currentWorkspaceId);
        }
        socket.data.workspaceId = nextWorkspaceId;
        await socket.join(workspaceRoom(nextWorkspaceId));
        const workspaceSockets = onlineSockets.get(nextWorkspaceId) ?? new Map<string, Set<string>>();
        const memberSockets = workspaceSockets.get(socket.data.identity.id) ?? new Set<string>();
        const wasOnline = memberSockets.size > 0;
        memberSockets.add(socket.id);
        workspaceSockets.set(socket.data.identity.id, memberSockets);
        onlineSockets.set(nextWorkspaceId, workspaceSockets);
        socket.emit("workspace:presence:sync", {
          onlineUserIds: [...workspaceSockets.keys()]
        });
        socket.emit("workspace:ready");
        if (!wasOnline) {
          io.to(workspaceRoom(nextWorkspaceId)).emit("workspace:presence:changed", {
            userId: socket.data.identity.id,
            online: true
          });
        }
      })().catch((error: unknown) => {
        reportFailure(socket, logger, "workspace:subscribe", error);
      });
    });

    socket.on("channel:subscribe", (requestedChannelId) => {
      void (async () => {
        const parsedChannelId = channelIdSchema.safeParse(requestedChannelId);
        const workspaceId = socket.data.workspaceId;
        if (!parsedChannelId.success || !workspaceId) {
          socket.emit("realtime:error", {
            event: "channel:subscribe",
            message: "Subscribe to an accessible workspace and channel."
          });
          return;
        }
        const channel = await channelService.getForMember(
          workspaceId,
          parsedChannelId.data,
          socket.data.identity.id
        );
        if (!channel) {
          socket.emit("realtime:error", {
            event: "channel:subscribe",
            message: "You do not have access to this channel."
          });
          return;
        }
        await socket.join(channelRoom(workspaceId, parsedChannelId.data));
        socket.emit("channel:ready", { channelId: parsedChannelId.data });
      })().catch((error: unknown) => {
        reportFailure(socket, logger, "channel:subscribe", error);
      });
    });

    socket.on("channel:unsubscribe", (requestedChannelId) => {
      const parsedChannelId = channelIdSchema.safeParse(requestedChannelId);
      const workspaceId = socket.data.workspaceId;
      if (!parsedChannelId.success || !workspaceId) {
        socket.emit("realtime:error", {
          event: "channel:unsubscribe",
          message: "The channel subscription is invalid."
        });
        return;
      }
      void socket.leave(channelRoom(workspaceId, parsedChannelId.data));
    });

    socket.on("channel:typing", (payload) => {
      void (async () => {
        const parsed = typingPayloadSchema.safeParse(payload);
        const workspaceId = socket.data.workspaceId;
        if (!parsed.success || !workspaceId) {
          socket.emit("realtime:error", {
            event: "channel:typing",
            message: "The typing update is invalid or the workspace is not active."
          });
          return;
        }
        const room = channelRoom(workspaceId, parsed.data.channelId);
        if (!socket.rooms.has(room)) {
          socket.emit("realtime:error", {
            event: "channel:typing",
            message: "Subscribe to the channel before sending typing updates."
          });
          return;
        }
        const channel = await channelService.getForMember(
          workspaceId,
          parsed.data.channelId,
          socket.data.identity.id
        );
        if (!channel) {
          socket.emit("channel:access:revoked", {
            workspaceId,
            channelId: parsed.data.channelId
          });
          await socket.leave(room);
          return;
        }
        const now = Date.now();
        const lastEventAt = lastTypingEventAt.get(socket) ?? 0;
        if (parsed.data.active && now - lastEventAt < 250) return;
        lastTypingEventAt.set(socket, now);
        socket.to(room).emit("channel:typing", {
          channelId: parsed.data.channelId,
          userId: socket.data.identity.id,
          active: parsed.data.active
        });
      })().catch((error: unknown) => {
        reportFailure(socket, logger, "channel:typing", error);
      });
    });

    socket.on("disconnect", () => {
      const workspaceId = socket.data.workspaceId;
      if (workspaceId) {
        void removeWorkspacePresence(socket, workspaceId)
          .catch((error: unknown) => {
            reportFailure(socket, logger, "workspace:disconnect", error);
          });
      }
    });
  });

  return Object.freeze({
    publishMessage: (workspaceId, channelId, message) => {
      io.to(channelRoom(workspaceId, channelId)).emit("channel:message:new", message);
    },
    publishMessageDeleted: (workspaceId, channelId, messageId) => {
      io.to(channelRoom(workspaceId, channelId)).emit("channel:message:deleted", { channelId, messageId });
    },
    publishChannelListChanged: (workspaceId) => {
      io.to(workspaceRoom(workspaceId)).emit("workspace:channels:changed");
    },
    publishWorkspaceMembersChanged: (workspaceId) => {
      io.to(workspaceRoom(workspaceId)).emit("workspace:members:changed");
    },
    publishMembersChanged: (workspaceId, channelId) => {
      io.to(channelRoom(workspaceId, channelId)).emit("channel:members:changed", { channelId });
    },
    publishSystemEntry: (workspaceId, entry) => {
      const emitter = io as unknown as Readonly<{
        to: (room: string) => Readonly<{
          except: (room: string) => Readonly<{ emit: (event: string, payload: unknown) => void }>;
        }>;
      }>;
      emitter.to(channelRoom(workspaceId, entry.channelId))
        .except(userRoom(entry.actor.id))
        .emit("channel:system:new", Object.freeze({
          id: entry.id,
          channelId: entry.channelId,
          type: entry.type,
          systemEvent: entry.systemEvent,
          actor: entry.actor,
          text: entry.text,
          createdAt: entry.createdAt.toISOString()
        }));
    },
    revokeChannelAccess: (workspaceId, channelId, userId) => {
      const room = channelRoom(workspaceId, channelId);
      const membersRoom = userRoom(userId);
      io.to(membersRoom).emit("channel:access:revoked", { workspaceId, channelId });
      io.in(membersRoom).socketsLeave(room);
    },
    revokeWorkspaceAccess: (workspaceId, userId) => {
      const membersRoom = userRoom(userId);
      io.to(membersRoom).emit("workspace:access:revoked", { workspaceId });
      io.in(membersRoom).disconnectSockets(true);
    }
  });
};
