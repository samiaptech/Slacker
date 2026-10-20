"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { Button, Input, Label, PageShell } from "@workspace/ui";
import { z } from "zod";
import type {
  WorkspaceAccessResponse,
  WorkspaceInviteLinkResponse,
  WorkspaceListResponse,
  WorkspaceMembershipSummary,
  WorkspaceMutationResponse
} from "@workspace/types";
import { WorkspaceContextProvider } from "@/features/workspace-foundation/public";
import { createAuthenticationClient } from "./auth-client";
import { workspaceAccessSchema } from "../types";

type WorkspaceAccessProps = Readonly<{ apiBaseUrl: string; children?: ReactNode; fullWidth?: boolean }>;
type PageStage = "loading" | "create" | "invite" | "ready" | "error";

const workspaceMembershipSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  role: z.enum(["admin", "member"])
}) satisfies z.ZodType<WorkspaceMembershipSummary>;

const workspaceListSchema = z.object({
  workspaces: z.array(workspaceMembershipSchema)
}) satisfies z.ZodType<WorkspaceListResponse>;

const workspaceMutationSchema = z.object({
  workspace: workspaceMembershipSchema
}) satisfies z.ZodType<WorkspaceMutationResponse>;

const inviteLinkSchema = z.object({
  inviteUrl: z.url(),
  expiresAt: z.iso.datetime()
}) satisfies z.ZodType<WorkspaceInviteLinkResponse>;
const workspaceStorageUnavailableMessage = "Workspace storage is not initialized. Run `pnpm --filter @workspace/api workspaces:initialize`, then restart the API.";

export const WorkspaceAccess = ({ apiBaseUrl, children, fullWidth = false }: WorkspaceAccessProps): ReactElement => {
  const authenticationClient = useMemo(() => createAuthenticationClient(apiBaseUrl), [apiBaseUrl]);
  const [stage, setStage] = useState<PageStage>("loading");
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceMembershipSummary[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceMembershipSummary | null>(null);
  const [access, setAccess] = useState<WorkspaceAccessResponse | null>(null);
  const [newWorkspace, setNewWorkspace] = useState<WorkspaceMembershipSummary | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const loadWorkspaces = async (): Promise<void> => {
      try {
        const response = await fetch(new URL("/workspaces", apiBaseUrl), {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal
        });
        if (response.status === 401) {
          window.location.assign(new URL("/sign-in", window.location.origin));
          return;
        }
        if (response.status === 503) {
          setErrorMessage(workspaceStorageUnavailableMessage);
          setStage("error");
          return;
        }
        if (!response.ok) throw new Error("Your workspaces could not be loaded.");
        const parsed = workspaceListSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("The server returned an invalid workspace list.");
        if (parsed.data.workspaces.length === 0) {
          setStage("create");
          return;
        }
        setWorkspaces(parsed.data.workspaces);
        const storedId = window.localStorage.getItem("nutshyll.activeWorkspaceId");
        const selected = parsed.data.workspaces.find((workspace) => workspace.id === storedId)
          ?? parsed.data.workspaces[0];
        if (!selected) throw new Error("No workspace is available.");
        const accessResponse = await fetch(new URL("/workspace", apiBaseUrl), {
          credentials: "include",
          cache: "no-store",
          headers: { "X-Workspace-Id": selected.id },
          signal: controller.signal
        });
        if (accessResponse.status === 503) {
          setErrorMessage(workspaceStorageUnavailableMessage);
          setStage("error");
          return;
        }
        if (!accessResponse.ok) throw new Error("Workspace access could not be verified.");
        const parsedAccess = workspaceAccessSchema.safeParse(await accessResponse.json());
        if (!parsedAccess.success) throw new Error("The server returned invalid workspace access.");
        setActiveWorkspace(selected);
        setAccess(parsedAccess.data);
        window.localStorage.setItem("nutshyll.activeWorkspaceId", selected.id);
        setStage("ready");
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setErrorMessage("Your workspaces could not be loaded. Check your connection and try again.");
        setStage("error");
      }
    };
    void loadWorkspaces();
    return () => controller.abort();
  }, [apiBaseUrl]);

  const selectWorkspace = (workspaceId: string): void => {
    const selected = workspaces.find((workspace) => workspace.id === workspaceId);
    if (!selected || !access) return;
    setActiveWorkspace(selected);
    setAccess({ ...access, workspace: { id: selected.id, name: selected.name } });
    window.localStorage.setItem("nutshyll.activeWorkspaceId", selected.id);
  };

  const setCurrentUserProfile = (profile: Readonly<{ name: string; title: string | null }>): void => {
    setAccess((current) => current ? { ...current, user: { ...current.user, ...profile } } : current);
  };

  const createWorkspace = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch(new URL("/workspaces", apiBaseUrl), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: workspaceName })
      });
      if (response.status === 401) {
        window.location.assign(new URL("/sign-in", window.location.origin));
        return;
      }
      if (response.status === 503) {
        setErrorMessage(workspaceStorageUnavailableMessage);
        return;
      }
      if (!response.ok) throw new Error("The workspace could not be created.");
      const parsed = workspaceMutationSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("The server returned an invalid workspace.");
      const created = parsed.data.workspace;
      setWorkspaces((current) => [...current, created]);
      setNewWorkspace(created);
      setActiveWorkspace(created);
      window.localStorage.setItem("nutshyll.activeWorkspaceId", created.id);
      const accessResponse = await fetch(new URL("/workspace", apiBaseUrl), {
        credentials: "include",
        cache: "no-store",
        headers: { "X-Workspace-Id": created.id }
      });
      if (accessResponse.status === 503) {
        setErrorMessage(workspaceStorageUnavailableMessage);
        setStage("error");
        return;
      }
      if (!accessResponse.ok) throw new Error("Workspace access could not be verified.");
      const parsedAccess = workspaceAccessSchema.safeParse(await accessResponse.json());
      if (!parsedAccess.success) throw new Error("The server returned invalid workspace access.");
      setAccess(parsedAccess.data);
      setInviteUrl(null);
      setStage("invite");
    } catch {
      setErrorMessage("The workspace could not be created. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const createInviteLink = async (): Promise<void> => {
    if (!newWorkspace || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch(new URL(`/workspaces/${encodeURIComponent(newWorkspace.id)}/invite-links`, apiBaseUrl), {
        method: "POST",
        credentials: "include",
        cache: "no-store"
      });
      if (response.status === 503) {
        setErrorMessage(workspaceStorageUnavailableMessage);
        return;
      }
      if (!response.ok) throw new Error("Invite link creation failed.");
      const parsed = inviteLinkSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("The server returned an invalid invitation link.");
      setInviteUrl(parsed.data.inviteUrl);
    } catch {
      setErrorMessage("An invitation link could not be created. You can skip this step and create one later.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyInviteLink = async (): Promise<void> => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyFeedback("Invite link copied. Anyone with it can join until it expires in 7 days.");
    } catch {
      setCopyFeedback("Copy failed. Select and copy the invitation link manually.");
    }
  };

  const signOut = async (): Promise<void> => {
    try {
      await authenticationClient.signOut();
    } catch {
      setErrorMessage("Sign out could not be confirmed.");
    }
    window.location.assign(new URL("/sign-in", window.location.origin));
  };

  return (
    <PageShell {...(fullWidth ? { className: "max-w-none px-3 py-3 sm:px-4 sm:py-4" } : {})}>
      <main className={fullWidth
        ? "flex min-h-0 w-full flex-1 flex-col"
        : "mx-auto flex min-h-[70vh] w-full max-w-5xl flex-col justify-center"}>
        {stage === "loading" ? (
          <p className="text-sm text-muted-foreground" role="status">Loading your workspaces…</p>
        ) : stage === "error" ? (
          <section className="rounded-xl border border-border bg-card p-8">
            <h1 className="text-xl font-semibold text-foreground">Workspaces unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground" role="alert">{errorMessage}</p>
            <Button className="mt-6" onClick={() => window.location.reload()} type="button" variant="outline">Retry</Button>
          </section>
        ) : stage === "create" ? (
          <section aria-labelledby="workspace-create-title" className="rounded-xl border border-border bg-card p-8">
            <p className="text-sm font-medium text-primary">Get started</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground" id="workspace-create-title">Create a workspace</h1>
            <p className="mt-2 text-sm text-muted-foreground">Create a home for your team. You can join other workspaces with an invite link.</p>
            <form className="mt-6 space-y-4" onSubmit={(event) => void createWorkspace(event)}>
              <div className="space-y-2">
                <Label htmlFor="workspace-name">Workspace name</Label>
                <Input autoFocus id="workspace-name" maxLength={80} onChange={(event) => setWorkspaceName(event.currentTarget.value)} required value={workspaceName} />
              </div>
              {errorMessage ? <p className="text-sm text-destructive" role="alert">{errorMessage}</p> : null}
              <div className="flex justify-end gap-2">
                {workspaces.length > 0 ? <Button onClick={() => setStage("ready")} type="button" variant="outline">Cancel</Button> : null}
                <Button disabled={isSubmitting} type="submit">{isSubmitting ? "Creating…" : "Next"}</Button>
              </div>
            </form>
          </section>
        ) : stage === "invite" ? (
          <section aria-labelledby="workspace-invite-title" className="rounded-xl border border-border bg-card p-8">
            <p className="text-sm font-medium text-primary">Workspace created</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground" id="workspace-invite-title">Invite your team to {newWorkspace?.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">Create a reusable link and share it with anyone. They’ll sign in with Google before joining; the link expires in 7 days.</p>
            {inviteUrl ? (
              <div className="mt-6 space-y-3">
                <Label htmlFor="workspace-invite-link">Invite link</Label>
                <Input id="workspace-invite-link" readOnly value={inviteUrl} />
                <Button onClick={() => void copyInviteLink()} type="button" variant="outline">Copy invite link</Button>
                {copyFeedback ? <p className="text-sm text-muted-foreground" role="status">{copyFeedback}</p> : null}
              </div>
            ) : (
              <Button className="mt-6" disabled={isSubmitting} onClick={() => void createInviteLink()} type="button">
                {isSubmitting ? "Creating link…" : "Create invite link"}
              </Button>
            )}
            {errorMessage ? <p className="mt-4 text-sm text-destructive" role="alert">{errorMessage}</p> : null}
            <div className="mt-8 flex justify-end">
              <Button onClick={() => setStage("ready")} type="button">
                {inviteUrl ? "Continue to workspace" : "Skip for now"}
              </Button>
            </div>
          </section>
        ) : activeWorkspace && access ? (
          <WorkspaceContextProvider value={{
            activeWorkspace,
            workspaces,
            currentUser: access.user,
            selectWorkspace,
            setCurrentUserProfile
          }}>
            <section
              aria-labelledby="workspace-title"
              className={fullWidth
                ? "flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-card p-3 sm:p-4"
                : "rounded-xl border border-border bg-card p-8"}
            >
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-primary">Workspace</p>
                  <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground" id="workspace-title">
                    {access.workspace.name}
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">Signed in as {access.user.email}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {workspaces.length > 1 ? (
                    <select
                      aria-label="Switch workspace"
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      onChange={(event) => selectWorkspace(event.currentTarget.value)}
                      value={activeWorkspace.id}
                    >
                      {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
                    </select>
                  ) : null}
                  <Button onClick={() => { setWorkspaceName(""); setErrorMessage(null); setStage("create"); }} type="button" variant="outline">
                    New workspace
                  </Button>
                  <Button onClick={() => void signOut()} type="button" variant="outline">Sign out</Button>
                </div>
              </div>
              <div className={fullWidth
                ? "flex min-h-0 flex-1 flex-col border-t border-border pt-1"
                : "border-t border-border pt-1"}
              >
                {children}
              </div>
            </section>
          </WorkspaceContextProvider>
        ) : (
          <section className="rounded-xl border border-border bg-card p-8">
            <h1 className="text-xl font-semibold text-foreground">Workspace unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">Choose a workspace or create one to continue.</p>
            <Button className="mt-6" onClick={() => setStage("create")} type="button">New workspace</Button>
            <Button asChild className="ml-2 mt-6" variant="outline"><Link href="/sign-in">Go to sign in</Link></Button>
          </section>
        )}
      </main>
    </PageShell>
  );
};
