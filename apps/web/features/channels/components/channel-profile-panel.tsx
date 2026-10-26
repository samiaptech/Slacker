"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft } from "lucide-react";
import { workspaceMembersSchema } from "@/features/identity/public";
import { channelMembersResponseSchema } from "../types";
import { useWorkspaceContext } from "@/features/workspace-foundation/public";
import { useChannelRealtime } from "./channel-realtime-provider";
import { ChannelProfileContent, type ChannelProfileMemberView } from "./channel-profile-content";

type ChannelProfilePanelProps = Readonly<{
  apiBaseUrl: string;
  channelId: string;
  channelName: string;
  description: string | null;
  visibility: "public" | "private";
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  managementPanel?: ReactNode;
  isPage?: boolean;
}>;

export const ChannelProfilePanel = ({
  apiBaseUrl,
  channelId,
  channelName,
  description,
  visibility,
  isOpen,
  onOpenChange,
  managementPanel,
  isPage = false
}: ChannelProfilePanelProps): ReactElement => {
  const { activeWorkspace } = useWorkspaceContext();
  const realtime = useChannelRealtime();
  const [members, setMembers] = useState<Readonly<{
    canManage: boolean;
    members: readonly ChannelProfileMemberView[];
  }> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [isManagingMembers, setIsManagingMembers] = useState(false);

  useEffect(() => {
    const socket = realtime.socket;
    if (!socket) return;
    const refreshMembers = (change: Readonly<{ channelId: string }>): void => {
      if (change.channelId === channelId) setReloadToken((current) => current + 1);
    };
    const refreshWorkspaceMembers = (): void => {
      if (visibility === "public") setReloadToken((current) => current + 1);
    };
    socket.on("channel:members:changed", refreshMembers);
    socket.on("workspace:members:changed", refreshWorkspaceMembers);
    return () => {
      socket.off("channel:members:changed", refreshMembers);
      socket.off("workspace:members:changed", refreshWorkspaceMembers);
    };
  }, [activeWorkspace.id, channelId, realtime.socket, visibility]);

  useEffect(() => {
    const controller = new AbortController();
    const loadMembers = async (): Promise<void> => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const memberPath = visibility === "public"
          ? "/workspace/members"
          : `/channels/${encodeURIComponent(channelId)}/memberships`;
        const response = await fetch(new URL(memberPath, apiBaseUrl), {
          credentials: "include",
          cache: "no-store",
          headers: { "X-Workspace-Id": activeWorkspace.id },
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Channel members could not be loaded. You may no longer have access.");
        const responseBody: unknown = await response.json();
        if (visibility === "public") {
          const parsed = workspaceMembersSchema.safeParse(responseBody);
          if (!parsed.success) throw new Error("The server returned an invalid workspace member list.");
          setMembers({
            canManage: false,
            members: parsed.data.members.map((member) => ({
              id: member.id,
              name: member.name,
              title: member.title,
              email: member.email,
              image: member.image,
              role: member.role
            }))
          });
        } else {
          const parsed = channelMembersResponseSchema.safeParse(responseBody);
          if (!parsed.success) throw new Error("The server returned an invalid channel member list.");
          setMembers({
            canManage: parsed.data.canManage,
            members: parsed.data.members.map((member) => ({
              id: member.userId,
              name: member.name,
              title: null,
              email: member.email,
              image: member.image,
              role: member.role
            }))
          });
        }
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMembers(null);
        setLoadError(error instanceof Error ? error.message : "Channel members could not be loaded. Check your connection and try again.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };
    void loadMembers();
    return () => controller.abort();
  }, [activeWorkspace.id, apiBaseUrl, channelId, reloadToken, visibility]);

  const profile = (
    <ChannelProfileContent
      channelName={channelName}
      description={description}
      errorMessage={loadError}
      isLoading={isLoading}
      members={members?.members ?? []}
      onRetry={() => setReloadToken((current) => current + 1)}
      visibility={visibility}
    />
  );
  const management = managementPanel && members?.canManage ? (
    <details className="mt-3 rounded-2xl border border-[#e5e9e3] bg-white" onToggle={(event) => setIsManagingMembers(event.currentTarget.open)} open={isManagingMembers}>
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-[#355d4f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Manage channel members
      </summary>
      {isManagingMembers ? <div className="border-t border-[#edf0eb] p-3">{managementPanel}</div> : null}
    </details>
  ) : null;

  return (
    <>
      {isPage ? (
        <main aria-label={`About #${channelName}`} className="h-full min-h-0 overflow-y-auto bg-[#fbfaf8]">
          <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-7 sm:py-6">
            <Link
              className="mb-4 inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-medium text-[#416652] transition-colors hover:bg-[#e9f0e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={`/channels/${encodeURIComponent(channelId)}` as Route}
              onClick={() => onOpenChange(false)}
            >
              <ArrowLeft aria-hidden="true" className="size-4" /> Back to conversation
            </Link>
            <div className="overflow-hidden rounded-2xl border border-[#e6e9e2] bg-white shadow-sm">
              {profile}
              <div className="px-4 pb-4 sm:px-5">{management}</div>
            </div>
          </div>
        </main>
      ) : isOpen ? (
        <aside aria-label={`About #${channelName}`} className="hidden min-h-0 w-80 shrink-0 flex-col overflow-y-auto border-l border-[#e8ece7] bg-[#f8f8f4] lg:flex" id="channel-profile-panel">
          {profile}{management}
        </aside>
      ) : null}
    </>
  );
};
