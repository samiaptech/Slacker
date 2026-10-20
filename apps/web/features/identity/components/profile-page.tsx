"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button, Input, Label } from "@workspace/ui";
import { z } from "zod";
import type { WorkspaceEmailVisibilityResponse, WorkspaceInviteLinkResponse } from "@workspace/types";
import { useWorkspaceContext } from "@/features/workspace-foundation/public";
import { workspaceEmailVisibilitySchema, workspaceMembersSchema } from "../types";
import { createAuthenticationClient } from "./auth-client";

type ProfilePageProps = Readonly<{ apiBaseUrl: string }>;
type StoredInviteLink = WorkspaceInviteLinkResponse;

const inviteLinkSchema = z.object({
  inviteUrl: z.url(),
  expiresAt: z.iso.datetime()
}) satisfies z.ZodType<StoredInviteLink>;
const memberEmailsResponseSchema = workspaceMembersSchema.pick({ memberEmailsVisible: true }) satisfies
  z.ZodType<Pick<import("@workspace/types").WorkspaceMembersResponse, "memberEmailsVisible">>;
const emailVisibilityResponseSchema = workspaceEmailVisibilitySchema satisfies z.ZodType<WorkspaceEmailVisibilityResponse>;

const getInviteStorageKey = (workspaceId: string): string => `nutshyll.workspaceInvite.${workspaceId}`;

export const ProfilePage = ({ apiBaseUrl }: ProfilePageProps): ReactElement => {
  const { activeWorkspace, currentUser, setCurrentUserProfile } = useWorkspaceContext();
  const authenticationClient = useMemo(() => createAuthenticationClient(apiBaseUrl), [apiBaseUrl]);
  const [name, setName] = useState(currentUser.name);
  const [title, setTitle] = useState(currentUser.title ?? "");
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [invite, setInvite] = useState<StoredInviteLink | null>(null);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [emailVisibilitySettings, setEmailVisibilitySettings] = useState<Readonly<{
    workspaceId: string;
    memberEmailsVisible: boolean;
    status: "ready" | "error";
  }> | null>(null);
  const [isSavingVisibility, setIsSavingVisibility] = useState(false);
  const [visibilityMessage, setVisibilityMessage] = useState<string | null>(null);
  const visibilitySettings = emailVisibilitySettings?.workspaceId === activeWorkspace.id
    ? emailVisibilitySettings
    : null;
  const memberEmailsVisible = visibilitySettings?.memberEmailsVisible ?? true;
  const isLoadingVisibility = visibilitySettings === null;
  const visibilityLoadFailed = visibilitySettings?.status === "error";

  useEffect(() => {
    let isCurrent = true;
    const loadSavedInvite = async (): Promise<void> => {
      try {
        const storageKey = getInviteStorageKey(activeWorkspace.id);
        const rawInvite = await Promise.resolve(window.localStorage.getItem(storageKey));
        if (rawInvite) {
          const parsed = inviteLinkSchema.safeParse(JSON.parse(rawInvite));
          if (!parsed.success || new Date(parsed.data.expiresAt).getTime() <= Date.now()) {
            window.localStorage.removeItem(storageKey);
            if (isCurrent) setInvite(null);
          } else if (isCurrent) {
            setInvite(parsed.data);
          }
        } else if (isCurrent) {
          setInvite(null);
        }
      } catch (error: unknown) {
        if (isCurrent) {
          setInvite(null);
          setInviteMessage(error instanceof SyntaxError
            ? "The saved invitation could not be read. Create a new link."
            : "Saved invitation storage is unavailable in this browser.");
        }
      }
    };
    const loadEmailVisibility = async (): Promise<void> => {
      try {
        const response = await fetch(new URL("/workspace/members", apiBaseUrl), {
          credentials: "include",
          cache: "no-store",
          headers: { "X-Workspace-Id": activeWorkspace.id }
        });
        if (!response.ok) throw new Error("Workspace profile settings could not be loaded.");
        const parsedSettings = memberEmailsResponseSchema.safeParse(await response.json());
        if (!parsedSettings.success) throw new Error("The server returned invalid workspace profile settings.");
        if (isCurrent) setEmailVisibilitySettings({
          workspaceId: activeWorkspace.id,
          memberEmailsVisible: parsedSettings.data.memberEmailsVisible,
          status: "ready"
        });
      } catch {
        if (isCurrent) {
          setEmailVisibilitySettings({
            workspaceId: activeWorkspace.id,
            memberEmailsVisible: true,
            status: "error"
          });
          setVisibilityMessage("Workspace profile settings could not be loaded. Reload the page and try again.");
        }
      }
    };
    void loadSavedInvite();
    void loadEmailVisibility();
    return () => { isCurrent = false; };
  }, [activeWorkspace.id, apiBaseUrl]);

  const saveName = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const normalizedName = name.trim();
    const normalizedTitle = title.trim();
    if (!normalizedName || normalizedName.length > 80 || normalizedTitle.length > 80 || isSavingName) return;
    setIsSavingName(true);
    setNameMessage(null);
    try {
      const result = await authenticationClient.updateUser({ name: normalizedName, title: normalizedTitle });
      if (result.error) {
        setNameMessage("Your profile could not be updated. Please try again.");
        return;
      }
      setName(normalizedName);
      setTitle(normalizedTitle);
      setCurrentUserProfile({ name: normalizedName, title: normalizedTitle || null });
      setNameMessage("Your profile was updated.");
    } catch {
      setNameMessage("Your profile could not be updated. Check your connection and try again.");
    } finally {
      setIsSavingName(false);
    }
  };

  const saveMemberEmailVisibility = async (visible: boolean): Promise<void> => {
    if (isSavingVisibility) return;
    setIsSavingVisibility(true);
    setVisibilityMessage(null);
    try {
      const response = await fetch(new URL(
        `/workspaces/${encodeURIComponent(activeWorkspace.id)}/settings`,
        apiBaseUrl
      ), {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": activeWorkspace.id
        },
        body: JSON.stringify({ memberEmailsVisible: visible })
      });
      if (!response.ok) throw new Error("Workspace email visibility could not be updated.");
      const parsed = emailVisibilityResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("The server returned invalid email visibility settings.");
      setEmailVisibilitySettings({
        workspaceId: activeWorkspace.id,
        memberEmailsVisible: parsed.data.memberEmailsVisible,
        status: "ready"
      });
      setVisibilityMessage(parsed.data.memberEmailsVisible
        ? "Workspace members can now see each other’s email addresses."
        : "Email addresses are now hidden from regular workspace members.");
    } catch {
      setVisibilityMessage("Workspace email visibility could not be updated. Please try again.");
    } finally {
      setIsSavingVisibility(false);
    }
  };

  const createInviteLink = async (): Promise<void> => {
    if (isCreatingInvite) return;
    setIsCreatingInvite(true);
    setInviteMessage(null);
    try {
      const response = await fetch(new URL(
        `/workspaces/${encodeURIComponent(activeWorkspace.id)}/invite-links`,
        apiBaseUrl
      ), {
        method: "POST",
        credentials: "include",
        cache: "no-store"
      });
      if (response.status === 401) {
        window.location.assign(new URL("/sign-in", window.location.origin));
        return;
      }
      if (response.status === 403 || response.status === 404) {
        setInviteMessage("Only a workspace admin can create an invitation link.");
        return;
      }
      if (response.status === 503) {
        setInviteMessage("Workspace storage is unavailable. Please try again later.");
        return;
      }
      if (!response.ok) {
        setInviteMessage("An invitation link could not be created. Please try again.");
        return;
      }
      const parsed = inviteLinkSchema.safeParse(await response.json());
      if (!parsed.success) {
        setInviteMessage("The server returned an invalid invitation link.");
        return;
      }
      window.localStorage.setItem(getInviteStorageKey(activeWorkspace.id), JSON.stringify(parsed.data));
      setInvite(parsed.data);
      setInviteMessage("Invite link created. It expires in seven days.");
    } catch {
      setInviteMessage("An invitation link could not be created. Check your connection and try again.");
    } finally {
      setIsCreatingInvite(false);
    }
  };

  const copyInviteLink = async (): Promise<void> => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.inviteUrl);
      setInviteMessage("Invite link copied. Anyone with it can join until it expires.");
    } catch {
      setInviteMessage("Copy failed. Select and copy the invitation link manually.");
    }
  };

  return (
    <main aria-labelledby="profile-title" className="mx-auto w-full max-w-2xl space-y-8 py-8">
      <header>
        <p className="text-sm font-medium text-primary">Account</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground" id="profile-title">Your profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">Manage your profile and workspace settings for {activeWorkspace.name}.</p>
      </header>

      <section aria-labelledby="profile-details-title" className="space-y-5 rounded-lg border border-border bg-card p-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground" id="profile-details-title">Profile details</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your profile is used across your workspaces.</p>
        </div>
        <div className="flex items-center gap-4">
          {currentUser.image ? (
            <Image alt="" className="size-14 rounded-full object-cover" height={56} src={currentUser.image} unoptimized width={56} />
          ) : (
            <div aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">
              {(currentUser.name || currentUser.email).slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{currentUser.name}</p>
            <p className="truncate text-sm text-muted-foreground">{currentUser.email}</p>
          </div>
        </div>
        <form className="space-y-3" onSubmit={(event) => void saveName(event)}>
          <div className="space-y-2">
            <Label htmlFor="profile-name">Display name</Label>
            <Input
              autoComplete="name"
              id="profile-name"
              maxLength={80}
              onChange={(event) => setName(event.currentTarget.value)}
              required
              value={name}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-title-field">Role or title</Label>
            <Input
              autoComplete="organization-title"
              id="profile-title-field"
              maxLength={80}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder="e.g. Product Designer"
              value={title}
            />
          </div>
          <Button disabled={isSavingName || (name.trim() === currentUser.name && title.trim() === (currentUser.title ?? ""))} type="submit">
            {isSavingName ? "Saving…" : "Save profile"}
          </Button>
          {nameMessage ? <p className="text-sm text-muted-foreground" role="status">{nameMessage}</p> : null}
        </form>
      </section>

      {activeWorkspace.role === "admin" ? (
        <>
        <section aria-labelledby="workspace-email-visibility-title" className="space-y-4 rounded-lg border border-border bg-card p-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground" id="workspace-email-visibility-title">Member email visibility</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {memberEmailsVisible
                ? "Regular members can see each other’s email addresses. Admins can always see member emails."
                : "Regular members cannot see member email addresses. Admins can still see them."}
            </p>
          </div>
          <Button
            disabled={isSavingVisibility || isLoadingVisibility || visibilityLoadFailed}
            onClick={() => void saveMemberEmailVisibility(!memberEmailsVisible)}
            type="button"
            variant="outline"
          >
            {isLoadingVisibility ? "Loading settings…" : isSavingVisibility ? "Saving…" : memberEmailsVisible ? "Hide emails from members" : "Show emails to members"}
          </Button>
          {visibilityMessage ? <p className="text-sm text-muted-foreground" role="status">{visibilityMessage}</p> : null}
        </section>
        <section aria-labelledby="workspace-invite-title" className="space-y-4 rounded-lg border border-border bg-card p-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground" id="workspace-invite-title">Invite to {activeWorkspace.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a reusable invite link and send it to people you want to add to this workspace. Links expire after seven days.
            </p>
          </div>
          {invite ? (
            <div className="space-y-3">
              <Label htmlFor="profile-invite-link">Workspace invite link</Label>
              <Input id="profile-invite-link" readOnly value={invite.inviteUrl} />
              <p className="text-xs text-muted-foreground">
                Expires {new Date(invite.expiresAt).toLocaleString()}.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void copyInviteLink()} type="button">Copy invite link</Button>
                <Button disabled={isCreatingInvite} onClick={() => void createInviteLink()} type="button" variant="outline">
                  {isCreatingInvite ? "Creating…" : "Create new link"}
                </Button>
              </div>
            </div>
          ) : (
            <Button disabled={isCreatingInvite} onClick={() => void createInviteLink()} type="button">
              {isCreatingInvite ? "Creating link…" : "Create invite link"}
            </Button>
          )}
          {inviteMessage ? <p className="text-sm text-muted-foreground" role="status">{inviteMessage}</p> : null}
        </section>
        </>
      ) : (
        <section aria-labelledby="workspace-admin-title" className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground" id="workspace-admin-title">Workspace invitations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask a workspace admin to create an invite link for {activeWorkspace.name}.
          </p>
        </section>
      )}

      <Link className="text-sm text-primary underline-offset-4 hover:underline" href="/">Back to workspace</Link>
    </main>
  );
};
