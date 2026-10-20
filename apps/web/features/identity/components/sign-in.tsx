"use client";

import { useMemo, useState, type ReactElement } from "react";
import { Button, PageShell } from "@workspace/ui";
import { createAuthenticationClient } from "./auth-client";

type SignInProps = Readonly<{ apiBaseUrl: string }>;

export const SignIn = ({ apiBaseUrl }: SignInProps): ReactElement => {
  const authenticationClient = useMemo(() => createAuthenticationClient(apiBaseUrl), [apiBaseUrl]);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const signInWithGoogle = async (): Promise<void> => {
    setIsSigningIn(true);
    setErrorMessage(null);
    try {
      const result = await authenticationClient.signIn.social({
        provider: "google",
        callbackURL: new URL("/", window.location.origin).toString()
      });
      if (result.error) setErrorMessage("Google sign-in could not be started. Please try again.");
    } catch {
      setErrorMessage("Google sign-in could not be started. Please try again.");
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <PageShell>
      <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center">
        <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
          <p className="text-sm font-medium text-primary">Squid workspace</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">Sign in to continue</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Sign in with Google to create a workspace or join one with an invitation.
          </p>
          <Button className="mt-7 w-full" disabled={isSigningIn} onClick={() => void signInWithGoogle()} type="button" variant="outline">
            {isSigningIn ? "Connecting to Google…" : "Continue with Google"}
          </Button>
          {errorMessage ? <p className="mt-4 text-sm text-destructive" role="alert">{errorMessage}</p> : null}
        </div>
      </main>
    </PageShell>
  );
};
