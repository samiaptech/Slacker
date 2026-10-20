"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import type { RealtimeClientEvents, RealtimeServerEvents } from "@workspace/types";

export type ChannelRealtimeSocket = Socket<RealtimeServerEvents, RealtimeClientEvents>;
export type RealtimeConnectionStatus = "connecting" | "connected" | "disconnected";

type ChannelRealtimeContextValue = Readonly<{
  socket: ChannelRealtimeSocket | null;
  status: RealtimeConnectionStatus;
  workspaceReady: boolean;
  errorMessage: string | null;
  onlineUserIds: readonly string[];
}>;

const ChannelRealtimeContext = createContext<ChannelRealtimeContextValue>({
  socket: null,
  status: "connecting",
  workspaceReady: false,
  errorMessage: null,
  onlineUserIds: []
});

type ChannelRealtimeProviderProps = Readonly<{
  apiBaseUrl: string;
  workspaceId: string;
  children: ReactNode;
}>;

export const ChannelRealtimeProvider = ({
  apiBaseUrl,
  workspaceId,
  children
}: ChannelRealtimeProviderProps): ReactElement => {
  const [socket, setSocket] = useState<ChannelRealtimeSocket | null>(null);
  const [status, setStatus] = useState<RealtimeConnectionStatus>("connecting");
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<readonly string[]>([]);
  const workspaceRevokedRef = useRef(false);

  useEffect(() => {
    const connection = io(apiBaseUrl, { withCredentials: true });
    const onConnect = (): void => {
      setStatus("connected");
      setWorkspaceReady(false);
      if (!workspaceRevokedRef.current) setErrorMessage(null);
      connection.emit("workspace:subscribe", workspaceId);
    };
    const onDisconnect = (): void => {
      setStatus("disconnected");
      setWorkspaceReady(false);
      setErrorMessage(workspaceRevokedRef.current
        ? "Your access to this workspace was removed."
        : "Live updates disconnected. Reconnecting…");
      setOnlineUserIds([]);
    };
    const onConnectionError = (): void => {
      setStatus("disconnected");
      setErrorMessage("Live updates are unavailable. Retrying…");
    };
    const onWorkspaceReady = (): void => {
      setWorkspaceReady(true);
      setErrorMessage(null);
    };
    const onRealtimeError = (error: Readonly<{ event: string; message: string }>): void => {
      if (error.event === "workspace:subscribe") {
        setWorkspaceReady(false);
        setErrorMessage(error.message);
      }
    };
    const onWorkspaceAccessRevoked = (change: Readonly<{ workspaceId: string }>): void => {
      if (change.workspaceId !== workspaceId) return;
      workspaceRevokedRef.current = true;
      setWorkspaceReady(false);
      setErrorMessage("Your access to this workspace was removed.");
    };
    const onPresenceSync = (presence: Readonly<{ onlineUserIds: readonly string[] }>): void =>
      setOnlineUserIds(presence.onlineUserIds);
    const onPresenceChanged = (presence: Readonly<{ userId: string; online: boolean }>): void => {
      setOnlineUserIds((current) => {
        const next = new Set(current);
        if (presence.online) next.add(presence.userId);
        else next.delete(presence.userId);
        return [...next];
      });
    };

    connection.on("connect", onConnect);
    connection.on("disconnect", onDisconnect);
    connection.on("connect_error", onConnectionError);
    connection.on("workspace:ready", onWorkspaceReady);
    connection.on("realtime:error", onRealtimeError);
    connection.on("workspace:access:revoked", onWorkspaceAccessRevoked);
    connection.on("workspace:presence:sync", onPresenceSync);
    connection.on("workspace:presence:changed", onPresenceChanged);
    setSocket(connection);

    return () => {
      connection.off("connect", onConnect);
      connection.off("disconnect", onDisconnect);
      connection.off("connect_error", onConnectionError);
      connection.off("workspace:ready", onWorkspaceReady);
      connection.off("realtime:error", onRealtimeError);
      connection.off("workspace:access:revoked", onWorkspaceAccessRevoked);
      connection.off("workspace:presence:sync", onPresenceSync);
      connection.off("workspace:presence:changed", onPresenceChanged);
      connection.disconnect();
      setSocket(null);
      setWorkspaceReady(false);
      setErrorMessage(null);
      workspaceRevokedRef.current = false;
      setOnlineUserIds([]);
    };
  }, [apiBaseUrl, workspaceId]);

  return (
    <ChannelRealtimeContext.Provider value={{ socket, status, workspaceReady, errorMessage, onlineUserIds }}>
      {children}
    </ChannelRealtimeContext.Provider>
  );
};

export const useChannelRealtime = (): ChannelRealtimeContextValue => useContext(ChannelRealtimeContext);
