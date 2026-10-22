"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type ChannelProfileToggle = Readonly<{
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  toggle: () => void;
}>;

const ChannelProfileToggleContext = createContext<ChannelProfileToggle | null>(null);

export const ChannelProfileToggleProvider = ({ children }: Readonly<{ children: ReactNode }>) => {
  const [isOpen, setIsOpen] = useState(true);
  const toggle = (): void => setIsOpen((current) => !current);
  return <ChannelProfileToggleContext.Provider value={{ isOpen, setIsOpen, toggle }}>{children}</ChannelProfileToggleContext.Provider>;
};

export const useChannelProfileToggle = (): ChannelProfileToggle => {
  const context = useContext(ChannelProfileToggleContext);
  if (!context) throw new Error("Channel profile controls must be used inside their provider.");
  return context;
};
