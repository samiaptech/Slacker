"use client";

import { createContext, useContext, type ReactNode } from "react";

export type ChannelLeaveTarget = Readonly<{ id: string; name: string }>;
type ChannelLeaveRequest = (channel: ChannelLeaveTarget) => void;

const ChannelLeaveContext = createContext<ChannelLeaveRequest | null>(null);

export const ChannelLeaveProvider = ({ children, onRequestLeave }: Readonly<{
  children: ReactNode;
  onRequestLeave: ChannelLeaveRequest;
}>) => <ChannelLeaveContext.Provider value={onRequestLeave}>{children}</ChannelLeaveContext.Provider>;

export const useChannelLeaveRequest = (): ChannelLeaveRequest => {
  const requestLeave = useContext(ChannelLeaveContext);
  if (!requestLeave) throw new Error("Channel leave must be requested inside the workspace shell.");
  return requestLeave;
};
