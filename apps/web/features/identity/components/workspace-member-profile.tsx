"use client";

import { useEffect, useState, type ReactElement } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { ArrowLeft } from "lucide-react";
import { Button } from "@workspace/ui";
import { Skeleton } from "@workspace/ui/primitives";
import { useWorkspaceContext } from "@/features/workspace-foundation/public";
import {
  workspaceMemberProfileSchema,
  workspaceMemberRoleSchema,
  type WorkspaceMemberProfileView
} from "../types";
import { WorkspaceMemberManagement } from "./workspace-member-management";
import { WorkspaceMemberProfileCard } from "./workspace-member-profile-card";

type WorkspaceMemberProfileProps = Readonly<{
  apiBaseUrl: string;
  userId: string;
}>;

type MemberProfileState =
  | Readonly<{ key: string; status: "found"; member: WorkspaceMemberProfileView }>
  | Readonly<{ key: string; status: "error"; message: string }>;

export const WorkspaceMemberProfile = ({ apiBaseUrl, userId }: WorkspaceMemberProfileProps): ReactElement => {
  const { activeWorkspace, currentUser } = useWorkspaceContext();
  const router = useRouter();
  const [profileState, setProfileState] = useState<MemberProfileState | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const profileKey = `${activeWorkspace.id}\u0000${userId}`;
  const currentProfileState = profileState?.key === profileKey ? profileState : null;
  const member = currentProfileState?.status === "found" ? currentProfileState.member : null;
  const isLoading = currentProfileState === null;
  const errorMessage = currentProfileState?.status === "error" ? currentProfileState.message : null;
  const [isSavingRole, setIsSavingRole] = useState(false);
  const [isRemovingMember, setIsRemovingMember] = useState(false);
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);
  const [managementMessage, setManagementMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const loadProfile = async (): Promise<void> => {
      try {
        const response = await fetch(new URL(
          `/workspace/members/${encodeURIComponent(userId)}`,
          apiBaseUrl
        ), {
          credentials: "include",
          cache: "no-store",
          headers: { "X-Workspace-Id": activeWorkspace.id },
          signal: controller.signal
        });
        if (response.status === 401) throw new Error("Sign in to view this workspace profile.");
        if (response.status === 403 || response.status === 404) {
          throw new Error("This member profile is not available in the active workspace.");
        }
        if (!response.ok) throw new Error("This member profile could not be loaded. Please try again.");
        const parsed = workspaceMemberProfileSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("The server returned an invalid member profile.");
        setProfileState({ key: profileKey, status: "found", member: parsed.data.member });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setProfileState({
          key: profileKey,
          status: "error",
          message: error instanceof Error
            ? error.message
            : "This member profile could not be loaded. Please try again."
        });
      }
    };
    void loadProfile();
    return () => controller.abort();
  }, [activeWorkspace.id, apiBaseUrl, profileKey, reloadToken, userId]);

  const changeMemberRole = async (role: "admin" | "member"): Promise<void> => {
    if (!member || isSavingRole || member.role === role) return;
    setIsSavingRole(true);
    setManagementMessage(null);
    try {
      const response = await fetch(new URL(
        `/workspaces/${encodeURIComponent(activeWorkspace.id)}/members/${encodeURIComponent(member.id)}`,
        apiBaseUrl
      ), {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role })
      });
      if (!response.ok) {
        setManagementMessage(response.status === 409
          ? "At least one workspace admin must remain."
          : response.status === 403
            ? "Only a workspace admin can change member roles."
            : "This member’s role could not be changed. Please try again.");
        return;
      }
      const parsed = workspaceMemberRoleSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.userId !== member.id) {
        setManagementMessage("The server returned an invalid member role.");
        return;
      }
      setProfileState((current) => current?.key === profileKey && current.status === "found"
        ? { ...current, member: { ...current.member, role: parsed.data.role } }
        : current);
      setManagementMessage(`Member role changed to ${parsed.data.role}.`);
    } catch {
      setManagementMessage("This member’s role could not be changed. Check your connection and try again.");
    } finally {
      setIsSavingRole(false);
    }
  };

  const removeMember = async (): Promise<void> => {
    if (!member || isRemovingMember) return;
    setIsRemovingMember(true);
    setManagementMessage(null);
    try {
      const response = await fetch(new URL(
        `/workspaces/${encodeURIComponent(activeWorkspace.id)}/members/${encodeURIComponent(member.id)}`,
        apiBaseUrl
      ), {
        method: "DELETE",
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) {
        setManagementMessage(response.status === 409
          ? "At least one workspace admin must remain."
          : response.status === 403
            ? "Only a workspace admin can remove workspace members."
            : "This member could not be removed. Please try again.");
        return;
      }
      setIsRemoveDialogOpen(false);
      router.replace("/" as Route);
    } catch {
      setManagementMessage("This member could not be removed. Check your connection and try again.");
    } finally {
      setIsRemovingMember(false);
    }
  };

  return (
    <main aria-labelledby="member-profile-title" className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-7 sm:py-9">
      <Link className="inline-flex items-center gap-2 rounded-lg text-sm font-medium text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/">
        <ArrowLeft aria-hidden="true" className="size-4" /> Back to workspace
      </Link>
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{activeWorkspace.name}</p>
        <p className="text-sm text-muted-foreground">Get to know someone in your workspace.</p>
      </div>
      {isLoading ? (
        <section aria-label="Loading member profile" className="overflow-hidden rounded-3xl border border-border bg-card" role="status">
          <div className="flex flex-col gap-4 bg-[#173b3a] p-6 sm:flex-row sm:items-center sm:p-9">
            <Skeleton className="size-24 shrink-0 rounded-[1.75rem]" />
            <div className="w-full space-y-3"><Skeleton className="h-3 w-32" /><Skeleton className="h-8 w-56" /><Skeleton className="h-4 w-40" /></div>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-7"><Skeleton className="h-20 rounded-2xl" /><Skeleton className="h-20 rounded-2xl" /></div>
        </section>
      ) : null}
      {errorMessage ? (
        <section className="space-y-4 rounded-3xl border border-[#e3e9e3] bg-white p-6 sm:p-8">
          <div><h1 className="font-semibold text-foreground" id="member-profile-title">Profile unavailable</h1><p className="mt-2 text-sm text-destructive" role="alert">{errorMessage}</p></div>
          <Button onClick={() => setReloadToken((current) => current + 1)} type="button" variant="outline">Try again</Button>
        </section>
      ) : null}
      {member ? <WorkspaceMemberProfileCard isCurrentUser={member.id === currentUser.id} member={member} /> : null}
      {member && activeWorkspace.role === "admin" && member.id !== currentUser.id ? (
        <WorkspaceMemberManagement
          isRemoveDialogOpen={isRemoveDialogOpen}
          isRemovingMember={isRemovingMember}
          isSavingRole={isSavingRole}
          managementMessage={managementMessage}
          member={member}
          onRemove={() => void removeMember()}
          onRemoveDialogChange={(open) => { setManagementMessage(null); setIsRemoveDialogOpen(open); }}
          onRoleChange={(role) => void changeMemberRole(role)}
          workspaceName={activeWorkspace.name}
        />
      ) : null}
    </main>
  );
};
