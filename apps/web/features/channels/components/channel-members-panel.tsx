"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label
} from "@workspace/ui";
import {
  channelMemberMutationResponseSchema,
  channelMembersResponseSchema,
  type ChannelMemberResponseView,
  type ChannelMembersResponseView
} from "../types";
import { useWorkspaceContext } from "@/features/workspace-foundation/public";
import { useChannelRealtime } from "./channel-realtime-provider";

type ChannelMembersPanelProps = Readonly<{
  apiBaseUrl: string;
  channelId: string;
  isActive: boolean;
}>;

export const ChannelMembersPanel = ({
  apiBaseUrl,
  channelId,
  isActive
}: ChannelMembersPanelProps): ReactElement => {
  const { activeWorkspace } = useWorkspaceContext();
  const realtime = useChannelRealtime();
  const [members, setMembers] = useState<ChannelMembersResponseView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<ChannelMemberResponseView | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const socket = realtime.socket;
    if (!socket) return;
    const refreshMembers = (change: Readonly<{ channelId: string }>): void => {
      if (change.channelId === channelId) setReloadToken((current) => current + 1);
    };
    const revokeAccess = (change: Readonly<{ workspaceId: string; channelId: string }>): void => {
      if (change.workspaceId !== activeWorkspace.id || change.channelId !== channelId) return;
      setMembers(null);
      setLoadError("You no longer have access to this channel.");
    };
    const revokeWorkspaceAccess = (change: Readonly<{ workspaceId: string }>): void => {
      if (change.workspaceId !== activeWorkspace.id) return;
      setMembers(null);
      setLoadError("Your access to this workspace was removed.");
    };
    socket.on("channel:members:changed", refreshMembers);
    socket.on("channel:access:revoked", revokeAccess);
    socket.on("workspace:access:revoked", revokeWorkspaceAccess);
    return () => {
      socket.off("channel:members:changed", refreshMembers);
      socket.off("channel:access:revoked", revokeAccess);
      socket.off("workspace:access:revoked", revokeWorkspaceAccess);
    };
  }, [activeWorkspace.id, channelId, realtime.socket]);

  useEffect(() => {
    const controller = new AbortController();
    const loadMembers = async (): Promise<void> => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(
          new URL(`/channels/${encodeURIComponent(channelId)}/memberships`, apiBaseUrl),
          {
            credentials: "include",
            cache: "no-store",
            headers: { "X-Workspace-Id": activeWorkspace.id },
            signal: controller.signal
          }
        );
        if (!response.ok) {
          setLoadError(response.status === 401
            ? "Your session has expired. Sign in again to view channel members."
            : "Channel members could not be loaded. You may no longer have access.");
          return;
        }
        const parsed = channelMembersResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          setLoadError("The server returned an invalid member list. Please try again.");
          return;
        }
        setMembers(parsed.data);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError("Channel members could not be loaded. Check your connection and try again.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };
    void loadMembers();
    return () => controller.abort();
  }, [activeWorkspace.id, apiBaseUrl, channelId, reloadToken]);

  const inviteMember = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!members?.canManage || !isActive || isSubmitting) return;
    setIsSubmitting(true);
    setActionError(null);
    setFeedback(null);
    try {
      const response = await fetch(
        new URL(`/channels/${encodeURIComponent(channelId)}/invitations`, apiBaseUrl),
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json", "X-Workspace-Id": activeWorkspace.id },
          body: JSON.stringify({ email: email.trim() })
        }
      );
      if (!response.ok) {
        setActionError(response.status === 401
          ? "Your session has expired. Sign in again to invite a member."
          : response.status === 503
            ? "Channel storage is unavailable. Please try again later."
            : "No available workspace account was found for that email, or you can no longer manage this channel.");
        return;
      }
      const parsed = channelMemberMutationResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setActionError("The server returned an invalid invitation response.");
        return;
      }
      setEmail("");
      setFeedback(parsed.data.alreadyMember ? "That account is already a channel member." : "Member added to the channel.");
      setReloadToken((current) => current + 1);
    } catch {
      setActionError("The member could not be added. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const removeMember = async (): Promise<void> => {
    if (!memberToRemove || !members?.canManage || !isActive || isSubmitting) return;
    const target = memberToRemove;
    setIsSubmitting(true);
    setActionError(null);
    setFeedback(null);
    try {
      const response = await fetch(
        new URL(`/channels/${encodeURIComponent(channelId)}/memberships/${encodeURIComponent(target.userId)}`, apiBaseUrl),
        {
          method: "DELETE",
          credentials: "include",
          cache: "no-store",
          headers: { "X-Workspace-Id": activeWorkspace.id }
        }
      );
      if (!response.ok) {
        setActionError(response.status === 409
          ? "Administrators cannot be removed. They must leave the channel themselves."
          : response.status === 401
            ? "Your session has expired. Sign in again to remove a member."
            : response.status === 503
              ? "Channel storage is unavailable. Please try again later."
              : "The member could not be removed. You may no longer have permission.");
        return;
      }
      setMemberToRemove(null);
      setFeedback("Member removed from the channel.");
      setReloadToken((current) => current + 1);
    } catch {
      setActionError("The member could not be removed. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="channel-members-title" className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground" id="channel-members-title">Members</h2>
          <p className="text-sm text-muted-foreground">
            Private channels are visible only to their current members.
          </p>
        </div>
        {members ? <p className="text-sm text-muted-foreground">{members.members.length} members</p> : null}
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">Loading members…</p>
      ) : loadError ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-destructive" role="alert">{loadError}</p>
          <Button onClick={() => setReloadToken((current) => current + 1)} size="sm" type="button" variant="outline">
            Retry
          </Button>
        </div>
      ) : members ? (
        <>
          {members.canManage && isActive ? (
            <form className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(event) => void inviteMember(event)}>
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor="channel-member-email">Invite an existing workspace account</Label>
                <Input
                  autoComplete="email"
                  disabled={isSubmitting}
                  id="channel-member-email"
                  onChange={(event) => { setEmail(event.currentTarget.value); setActionError(null); setFeedback(null); }}
                  placeholder="name@example.com"
                  required
                  type="email"
                  value={email}
                />
              </div>
              <Button disabled={isSubmitting} type="submit">
                {isSubmitting ? "Adding…" : "Add member"}
              </Button>
            </form>
          ) : null}

          {members.members.length === 0 ? (
            <p className="mt-5 text-sm text-muted-foreground">This channel has no members.</p>
          ) : (
            <ul className="mt-5 divide-y divide-border">
              {members.members.map((member) => (
                <li className="flex items-center justify-between gap-3 py-3" key={member.userId}>
                  <div className="min-w-0">
                    <Link
                      className="truncate text-sm font-medium text-foreground underline-offset-4 hover:underline"
                      href={`/members/${encodeURIComponent(member.userId)}` as Route}
                    >
                      {member.name ?? "Workspace account"}
                    </Link>
                    {member.email ? <p className="truncate text-xs text-muted-foreground">{member.email}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs capitalize text-muted-foreground">{member.role}</span>
                    {members.canManage && isActive && member.role === "member" ? (
                      <Button
                        aria-label={`Remove ${member.name ?? member.email ?? "member"}`}
                        disabled={isSubmitting}
                        onClick={() => { setMemberToRemove(member); setActionError(null); setFeedback(null); }}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!members.canManage && !members.members.some((member) => member.role === "admin") ? (
            <p className="mt-4 text-sm text-muted-foreground" role="status">
              This channel currently has no administrators. Existing members retain access, but member management is unavailable.
            </p>
          ) : null}
        </>
      ) : null}

      {actionError ? <p className="mt-4 text-sm text-destructive" role="alert">{actionError}</p> : null}
      {feedback ? <p className="mt-4 text-sm text-muted-foreground" role="status">{feedback}</p> : null}

      <Dialog
        onOpenChange={(open) => { if (!open && !isSubmitting) setMemberToRemove(null); }}
        open={memberToRemove !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {memberToRemove?.name ?? memberToRemove?.email ?? "this member"}?</DialogTitle>
            <DialogDescription>
              They will immediately lose access to this channel. Existing messages and authorship will remain unchanged.
            </DialogDescription>
          </DialogHeader>
          {actionError ? <p className="text-sm text-destructive" role="alert">{actionError}</p> : null}
          <DialogFooter>
            <Button disabled={isSubmitting} onClick={() => setMemberToRemove(null)} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={isSubmitting} onClick={() => void removeMember()} type="button" variant="destructive">
              {isSubmitting ? "Removing…" : "Remove member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};
