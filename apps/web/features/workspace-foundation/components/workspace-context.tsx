"use client";

import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import type { WorkspaceAccessResponse, WorkspaceMembershipSummary } from "@workspace/types";

export type WorkspaceContextValue = Readonly<{
  activeWorkspace: WorkspaceMembershipSummary;
  workspaces: readonly WorkspaceMembershipSummary[];
  currentUser: WorkspaceAccessResponse["user"];
  selectWorkspace: (workspaceId: string) => void;
  leaveWorkspace: () => Promise<void>;
  startCreatingWorkspace: () => void;
  signOut: () => Promise<void>;
  setCurrentUserProfile: (profile: Readonly<{ name: string; title: string | null }>) => void;
}>;

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const WorkspaceContextProvider = ({
  value,
  children
}: Readonly<{ value: WorkspaceContextValue; children: ReactNode }>): ReactElement => (
  <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
);

export const useWorkspaceContext = (): WorkspaceContextValue => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Workspace context is not available outside WorkspaceAccess.");
  return context;
};
