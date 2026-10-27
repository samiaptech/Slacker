"use client";

import { createContext, useCallback, useContext, useMemo, useRef, type ReactElement, type ReactNode } from "react";

type RefreshHandler = () => void;
type ChannelMessageRefreshContextValue = Readonly<{
  registerRefreshHandler: (handler: RefreshHandler) => () => void;
  refreshMessages: () => void;
}>;

const ChannelMessageRefreshContext = createContext<ChannelMessageRefreshContextValue | null>(null);

export const ChannelMessageRefreshProvider = ({ children }: Readonly<{ children: ReactNode }>): ReactElement => {
  const refreshHandler = useRef<RefreshHandler | null>(null);
  const registerRefreshHandler = useCallback((handler: RefreshHandler) => {
    refreshHandler.current = handler;
    return (): void => {
      if (refreshHandler.current === handler) refreshHandler.current = null;
    };
  }, []);
  const refreshMessages = useCallback((): void => refreshHandler.current?.(), []);
  const value = useMemo(() => ({ registerRefreshHandler, refreshMessages }), [registerRefreshHandler, refreshMessages]);

  return <ChannelMessageRefreshContext.Provider value={value}>{children}</ChannelMessageRefreshContext.Provider>;
};

export const useChannelMessageRefresh = (): ChannelMessageRefreshContextValue => {
  const context = useContext(ChannelMessageRefreshContext);
  if (!context) throw new Error("Channel message refresh is unavailable outside the workspace.");
  return context;
};
