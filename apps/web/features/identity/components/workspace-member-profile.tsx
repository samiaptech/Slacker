"use client";

import { useEffect, useState, type ReactElement } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@workspace/ui";
import { useWorkspaceContext } from "@/features/workspace-foundation/public";
import {
  workspaceMemberProfileSchema,
  workspaceMemberRoleSchema,
  type WorkspaceMemberProfileView
} from "../types";

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
  }, [activeWorkspace.id, apiBaseUrl, profileKey, userId]);

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
    <main aria-labelledby="member-profile-title" className="mx-auto w-full max-w-2xl space-y-6 py-8">
      <header>
        <p className="text-sm font-medium text-primary">{activeWorkspace.name}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground" id="member-profile-title">
          Member profile
        </h1>
      </header>
      {isLoading ? <p className="text-sm text-muted-foreground" role="status">Loading profile…</p> : null}
      {errorMessage ? (
        <section className="space-y-3 rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-destructive" role="alert">{errorMessage}</p>
          <Button onClick={() => window.location.reload()} type="button" variant="outline">Retry</Button>
        </section>
      ) : null}
      {member ? (
        <section aria-label={`${member.name ?? "Member"} profile`} className="space-y-5 rounded-lg border border-border bg-card p-6">
          <div className="flex items-center gap-4">
            {member.image ? (
              <Image alt="" className="size-16 rounded-full object-cover" height={64} src={member.image} unoptimized width={64} />
            ) : (
              <div aria-hidden="true" className="flex size-16 items-center justify-center rounded-full bg-muted text-xl font-semibold text-muted-foreground">
                {(member.name ?? member.email ?? "?").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold text-foreground">{member.name ?? "Workspace member"}</h2>
              <p className="text-sm text-muted-foreground">
                {member.role === "admin" ? "Workspace admin" : "Member"}
              </p>
            </div>
          </div>
          {member.title ? (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Role or title</h3>
              <p className="mt-1 text-foreground">{member.title}</p>
            </div>
          ) : null}
          {member.email ? (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Email</h3>
              <p className="mt-1 break-all text-foreground">{member.email}</p>
            </div>
          ) : null}
          {member.id === currentUser.id ? (
            <Link className="text-sm text-primary underline-offset-4 hover:underline" href={"/profile" as Route}>
              Edit your profile
            </Link>
          ) : null}
        </section>
      ) : null}
      {member && activeWorkspace.role === "admin" && member.id !== currentUser.id ? (
        <section aria-labelledby="member-management-title" className="space-y-4 rounded-lg border border-border bg-card p-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground" id="member-management-title">Manage workspace member</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Change {member.name ?? "this member"}’s workspace role or remove them from {activeWorkspace.name}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              disabled={isSavingRole || isRemovingMember}
              onValueChange={(value) => {
                if (value === "admin" || value === "member") void changeMemberRole(value);
              }}
              value={member.role}
            >
              <SelectTrigger aria-label="Workspace role" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Button
              disabled={isSavingRole || isRemovingMember}
              onClick={() => { setManagementMessage(null); setIsRemoveDialogOpen(true); }}
              type="button"
              variant="destructive"
            >
              Remove from workspace
            </Button>
          </div>
          {isSavingRole ? <p className="text-sm text-muted-foreground" role="status">Updating role…</p> : null}
          {managementMessage ? <p className="text-sm text-muted-foreground" role="status">{managementMessage}</p> : null}
        </section>
      ) : null}
      <Link className="text-sm text-primary underline-offset-4 hover:underline" href={"/" as Route}>
        Back to workspace
      </Link>
      <Dialog
        onOpenChange={(open) => {
          if (!isRemovingMember) setIsRemoveDialogOpen(open);
        }}
        open={isRemoveDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {member?.name ?? "this member"}?</DialogTitle>
            <DialogDescription>
              They will lose access to {activeWorkspace.name} and all its channels. You can invite them again later.
            </DialogDescription>
          </DialogHeader>
          {managementMessage ? <p className="text-sm text-destructive" role="alert">{managementMessage}</p> : null}
          <DialogFooter>
            <Button
              disabled={isRemovingMember}
              onClick={() => setIsRemoveDialogOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={isRemovingMember} onClick={() => void removeMember()} type="button" variant="destructive">
              {isRemovingMember ? "Removing…" : "Remove member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
};
