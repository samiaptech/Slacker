"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Button, PageShell } from "@workspace/ui";
import { z } from "zod";
import { createAuthenticationClient } from "./auth-client";

type WorkspaceInvitationProps = Readonly<{ apiBaseUrl: string; token: string }>;
type InvitationResult = Readonly<{ workspace: Readonly<{ id: string; name: string }>; alreadyMember: boolean }>;

const invitationResponseSchema = z.object({
  workspace: z.object({ id: z.string().min(1), name: z.string() }),
  alreadyMember: z.boolean()
}) satisfies z.ZodType<InvitationResult>;

export const WorkspaceInvitation = ({ apiBaseUrl, token }: WorkspaceInvitationProps): ReactElement => {
  const authenticationClient = useMemo(() => createAuthenticationClient(apiBaseUrl), [apiBaseUrl]);
  const [stage, setStage] = useState<"loading" | "sign-in" | "joined" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    const accept = async (): Promise<void> => {
      try {
        const response = await fetch(new URL(`/workspace-invitations/${encodeURIComponent(token)}/accept`, apiBaseUrl), {
          method: "POST",
          credentials: "include",
          cache: "no-store"
        });
        if (response.status === 401) {
          setStage("sign-in");
          return;
        }
        if (response.status === 503) {
          setMessage("Workspace storage is not initialized. Run `pnpm --filter @workspace/api workspaces:initialize`, then restart the API.");
          setStage("error");
          return;
        }
        if (!response.ok) {
          setMessage(response.status === 404
            ? "This invitation link is invalid or has expired."
            : "The invitation could not be accepted. Please try again.");
          setStage("error");
          return;
        }
        const parsed = invitationResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          setMessage("The server returned an invalid invitation response.");
          setStage("error");
          return;
        }
        window.localStorage.setItem("nutshyll.activeWorkspaceId", parsed.data.workspace.id);
        setMessage(parsed.data.alreadyMember
          ? `You already belong to ${parsed.data.workspace.name}.`
          : `You joined ${parsed.data.workspace.name}.`);
        setStage("joined");
      } catch {
        setMessage("The invitation could not be accepted. Check your connection and try again.");
        setStage("error");
      }
    };
    void accept();
  }, [apiBaseUrl, token]);

  const signIn = async (): Promise<void> => {
    setIsSigningIn(true);
    setMessage(null);
    try {
      const result = await authenticationClient.signIn.social({
        provider: "google",
        callbackURL: window.location.href
      });
      if (result.error) setMessage("Google sign-in could not be started. Please try again.");
    } catch {
      setMessage("Google sign-in could not be started. Please try again.");
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <PageShell>
      <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center">
        <section aria-labelledby="workspace-invitation-title" className="rounded-xl border border-border bg-card p-8">
          <p className="text-sm font-medium text-primary">Workspace invitation</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground" id="workspace-invitation-title">
            {stage === "joined" ? "You’re in" : "Join a workspace"}
          </h1>
          {stage === "loading" ? <p className="mt-3 text-sm text-muted-foreground" role="status">Checking your invitation…</p> : null}
          {stage === "sign-in" ? (
            <>
              <p className="mt-3 text-sm text-muted-foreground">Sign in with Google to accept this invitation. You’ll return here afterward.</p>
              <Button className="mt-6 w-full" disabled={isSigningIn} onClick={() => void signIn()} type="button" variant="outline">
                {isSigningIn ? "Connecting to Google…" : "Continue with Google"}
              </Button>
            </>
          ) : null}
          {stage === "joined" ? (
            <>
              <p className="mt-3 text-sm text-muted-foreground" role="status">{message}</p>
              <Button className="mt-6 w-full" onClick={() => window.location.assign(new URL("/", window.location.origin))} type="button">Open workspace</Button>
            </>
          ) : null}
          {stage === "error" ? <p className="mt-3 text-sm text-destructive" role="alert">{message}</p> : null}
          {stage === "error" ? <Button className="mt-6" onClick={() => window.location.reload()} type="button" variant="outline">Retry</Button> : null}
          {stage === "sign-in" && message ? <p className="mt-4 text-sm text-destructive" role="alert">{message}</p> : null}
        </section>
      </main>
    </PageShell>
  );
};
