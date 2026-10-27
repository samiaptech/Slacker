"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, BadgeCheck, Copy, Mail, ShieldCheck, UserRound, Users } from "lucide-react";
import { Button, Input, Label } from "@workspace/ui";
import { z } from "zod";
import type { WorkspaceEmailVisibilityResponse, WorkspaceInviteLinkResponse } from "@workspace/types";
import { application } from "@/constants/application";
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
    <main aria-labelledby="profile-title" className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-7 sm:py-9">
      <Link className="inline-flex items-center gap-2 rounded-lg text-sm font-medium text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/">
        <ArrowLeft aria-hidden="true" className="size-4" /> Back to workspace
      </Link>

      <header className="relative isolate overflow-hidden rounded-3xl bg-[#173b3a] p-6 text-white shadow-lg shadow-[#173b3a]/10 sm:p-9">
        <div aria-hidden="true" className="absolute -right-12 -top-24 -z-10 size-72 rounded-full border-[32px] border-white/[0.04]" />
        <div aria-hidden="true" className="absolute -bottom-28 right-24 -z-10 size-56 rounded-full bg-[#b8e3d1]/10 blur-2xl" />
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-[1.75rem] border border-white/20 bg-[#b8e3d1] text-3xl font-semibold text-[#173b3a] shadow-xl shadow-black/10">
            {currentUser.image ? (
              <Image alt="" className="size-full object-cover" height={96} src={currentUser.image} unoptimized width={96} />
            ) : (currentUser.name || currentUser.email).slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b8e3d1]">Account profile</p>
            <h1 className="mt-2 truncate text-3xl font-semibold tracking-tight" id="profile-title">{currentUser.name}</h1>
            <p className="mt-1 truncate text-sm text-white/65">{currentUser.title || "Add a role or title to introduce yourself"}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.07] px-3 py-1.5 text-sm text-white/80">
                <Mail aria-hidden="true" className="size-3.5" /> {currentUser.email}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-[#b8e3d1] px-3 py-1.5 text-sm font-medium text-[#173b3a]">
                <Users aria-hidden="true" className="size-3.5" /> {activeWorkspace.name}
              </span>
            </div>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-medium text-white/75">
            <BadgeCheck aria-hidden="true" className="size-4 text-[#b8e3d1]" /> {activeWorkspace.role === "admin" ? "Workspace admin" : "Workspace member"}
          </span>
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(19rem,0.8fr)]">
        <section aria-labelledby="profile-details-title" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
          <div className="mb-6 flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><UserRound aria-hidden="true" className="size-5" /></span>
            <div>
              <h2 className="text-lg font-semibold text-foreground" id="profile-details-title">Your details</h2>
              <p className="mt-1 text-sm text-muted-foreground">Choose how teammates see you across {application.name}.</p>
            </div>
          </div>
          <form className="space-y-5" onSubmit={(event) => void saveName(event)}>
            <div className="space-y-2">
              <Label htmlFor="profile-name">Display name</Label>
              <Input autoComplete="name" className="h-11 rounded-xl bg-background" id="profile-name" maxLength={80} onChange={(event) => setName(event.currentTarget.value)} required value={name} />
              <p className="text-xs text-muted-foreground">This is the name shown next to your messages.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-title-field">Role or title <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input autoComplete="organization-title" className="h-11 rounded-xl bg-background" id="profile-title-field" maxLength={80} onChange={(event) => setTitle(event.currentTarget.value)} placeholder="e.g. Product Designer" value={title} />
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
              <Button className="rounded-xl px-5" disabled={isSavingName || (name.trim() === currentUser.name && title.trim() === (currentUser.title ?? ""))} type="submit">
                {isSavingName ? "Saving changes…" : "Save changes"}
              </Button>
              {nameMessage ? <p className="text-sm text-muted-foreground" role="status">{nameMessage}</p> : null}
            </div>
          </form>
        </section>

        <div className="space-y-6">
          {activeWorkspace.role === "admin" ? (
            <>
              <section aria-labelledby="workspace-email-visibility-title" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eef4ef] text-primary"><ShieldCheck aria-hidden="true" className="size-5" /></span>
                  <div>
                    <h2 className="font-semibold text-foreground" id="workspace-email-visibility-title">Member privacy</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{memberEmailsVisible
                      ? "Members can see each other’s email addresses. Admins always have access."
                      : "Member email addresses are private. Admins always have access."}</p>
                  </div>
                </div>
                <Button className="mt-5 w-full rounded-xl" disabled={isSavingVisibility || isLoadingVisibility || visibilityLoadFailed} onClick={() => void saveMemberEmailVisibility(!memberEmailsVisible)} type="button" variant="outline">
                  {isLoadingVisibility ? "Loading settings…" : isSavingVisibility ? "Saving…" : memberEmailsVisible ? "Hide emails from members" : "Show emails to members"}
                </Button>
                {visibilityMessage ? <p className="mt-3 text-sm text-muted-foreground" role="status">{visibilityMessage}</p> : null}
              </section>

              <section aria-labelledby="workspace-invite-title" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eef4ef] text-primary"><Users aria-hidden="true" className="size-5" /></span>
                  <div>
                    <h2 className="font-semibold text-foreground" id="workspace-invite-title">Grow your workspace</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">Invite teammates to {activeWorkspace.name}. Links stay active for seven days.</p>
                  </div>
                </div>
                {invite ? (
                  <div className="mt-5 space-y-3">
                    <Label htmlFor="profile-invite-link">Invite link</Label>
                    <Input className="h-11 rounded-xl bg-background" id="profile-invite-link" readOnly value={invite.inviteUrl} />
                    <p className="text-xs text-muted-foreground">Expires {new Date(invite.expiresAt).toLocaleString()}.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button className="rounded-xl" onClick={() => void copyInviteLink()} type="button"><Copy aria-hidden="true" className="mr-2 size-4" />Copy link</Button>
                      <Button className="rounded-xl" disabled={isCreatingInvite} onClick={() => void createInviteLink()} type="button" variant="outline">{isCreatingInvite ? "Creating…" : "New link"}</Button>
                    </div>
                  </div>
                ) : (
                  <Button className="mt-5 w-full rounded-xl" disabled={isCreatingInvite} onClick={() => void createInviteLink()} type="button">
                    {isCreatingInvite ? "Creating invite link…" : "Create invite link"}
                  </Button>
                )}
                {inviteMessage ? <p className="mt-3 text-sm text-muted-foreground" role="status">{inviteMessage}</p> : null}
              </section>
            </>
          ) : (
            <section aria-labelledby="workspace-admin-title" className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <span className="flex size-10 items-center justify-center rounded-xl bg-[#eef4ef] text-primary"><ShieldCheck aria-hidden="true" className="size-5" /></span>
              <h2 className="mt-4 font-semibold text-foreground" id="workspace-admin-title">Workspace settings</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Ask a workspace admin to manage member privacy or create an invite link for {activeWorkspace.name}.</p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
};
