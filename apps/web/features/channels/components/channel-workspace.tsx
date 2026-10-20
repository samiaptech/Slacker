"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import { LogOut, MessageCircle, MoreHorizontal, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@workspace/ui/primitives";
import { ChannelCreateDialog } from "./create-channel-dialog";
import { ChannelRealtimeProvider, useChannelRealtime } from "./channel-realtime-provider";
import { directConversationListResponseSchema, directConversationResponseSchema } from "@/features/direct-messages/public";
import type { DirectConversationView } from "@/features/direct-messages/public";
import {
  channelJoinResponseSchema,
  channelListResponseSchema,
  type ChannelListResponseView,
  type ChannelResponseView
} from "../types";
import { useWorkspaceContext } from "@/features/workspace-foundation/public";
import { workspaceMembersSchema, type WorkspaceMembersView } from "@/features/identity/public";

type ChannelWorkspaceProps = Readonly<{
  apiBaseUrl: string;
  children: ReactNode;
}>;

type ChannelListScope = "joined" | "discoverable";

const ChannelWorkspaceContent = ({ apiBaseUrl, children }: ChannelWorkspaceProps): ReactElement => {
  const { activeWorkspace, currentUser } = useWorkspaceContext();
  const realtime = useChannelRealtime();
  const pathname = usePathname();
  const router = useRouter();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [scope, setScope] = useState<ChannelListScope>("joined");
  const [channelList, setChannelList] = useState<ChannelListResponseView["channels"]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pageErrorMessage, setPageErrorMessage] = useState<string | null>(null);
  const [membershipActionId, setMembershipActionId] = useState<string | null>(null);
  const [membershipErrorMessage, setMembershipErrorMessage] = useState<string | null>(null);
  const [channelToLeave, setChannelToLeave] = useState<ChannelResponseView | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMembersView["members"]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);
  const [membersErrorMessage, setMembersErrorMessage] = useState<string | null>(null);
  const [membersReloadToken, setMembersReloadToken] = useState(0);
  const [directConversations, setDirectConversations] = useState<readonly DirectConversationView[]>([]);
  const [directMessagesError, setDirectMessagesError] = useState<string | null>(null);
  const [directMessagesLoading, setDirectMessagesLoading] = useState(true);
  const [directMessagesReloadToken, setDirectMessagesReloadToken] = useState(0);
  const [openingDirectMessageFor, setOpeningDirectMessageFor] = useState<string | null>(null);
  const [directMessageActionError, setDirectMessageActionError] = useState<string | null>(null);

  useEffect(() => {
    const socket = realtime.socket;
    if (!socket) return;
    const reloadChannels = (): void => setReloadToken((current) => current + 1);
    const reloadMembers = (): void => setMembersReloadToken((current) => current + 1);
    const reloadDirectMessages = (): void => setDirectMessagesReloadToken((current) => current + 1);
    const reloadWorkspace = (): void => {
      setReloadToken((current) => current + 1);
      setMembersReloadToken((current) => current + 1);
      setDirectMessagesReloadToken((current) => current + 1);
    };
    socket.on("workspace:channels:changed", reloadChannels);
    socket.on("workspace:members:changed", reloadMembers);
    socket.on("workspace:direct-messages:changed", reloadDirectMessages);
    socket.on("workspace:access:revoked", reloadWorkspace);
    return () => {
      socket.off("workspace:channels:changed", reloadChannels);
      socket.off("workspace:members:changed", reloadMembers);
      socket.off("workspace:direct-messages:changed", reloadDirectMessages);
      socket.off("workspace:access:revoked", reloadWorkspace);
    };
  }, [realtime.socket]);

  useEffect(() => {
    const controller = new AbortController();
    const loadDirectMessages = async (): Promise<void> => {
      setDirectMessagesLoading(true);
      setDirectMessagesError(null);
      try {
        const response = await fetch(new URL("/direct-messages", apiBaseUrl), {
          credentials: "include",
          cache: "no-store",
          headers: { "X-Workspace-Id": activeWorkspace.id },
          signal: controller.signal
        });
        if (!response.ok) {
          setDirectMessagesError(response.status === 503
            ? "Direct messages are not initialized. Ask an administrator to run `pnpm --filter @workspace/api direct-messages:initialize`."
            : "Direct conversations could not be loaded. Please try again.");
          return;
        }
        const parsed = directConversationListResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          setDirectMessagesError("The server returned an invalid direct-conversation list.");
          return;
        }
        setDirectConversations(parsed.data.conversations);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDirectMessagesError("Direct conversations could not be loaded. Check your connection and retry.");
      } finally {
        if (!controller.signal.aborted) setDirectMessagesLoading(false);
      }
    };
    void loadDirectMessages();
    return () => controller.abort();
  }, [activeWorkspace.id, apiBaseUrl, directMessagesReloadToken]);

  useEffect(() => {
    const controller = new AbortController();
    const loadChannels = async (): Promise<void> => {
      setIsLoading(true);
      setErrorMessage(null);
      setPageErrorMessage(null);
      setChannelList([]);
      setNextCursor(null);
      try {
        const url = new URL("/channels", apiBaseUrl);
        url.searchParams.set("scope", scope);
        const response = await fetch(url, {
          credentials: "include",
          cache: "no-store",
          headers: { "X-Workspace-Id": activeWorkspace.id },
          signal: controller.signal
        });
        if (!response.ok) {
          setErrorMessage(response.status === 401
            ? "Your session has expired. Sign in again to load your channels."
            : "Your channels could not be loaded. Please try again.");
          return;
        }
        const parsed = channelListResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          setErrorMessage("The server returned an invalid channel list. Please try again.");
          return;
        }
        setChannelList(parsed.data.channels);
        setNextCursor(parsed.data.nextCursor);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setErrorMessage("Your channels could not be loaded. Check your connection and try again.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };
    void loadChannels();
    return () => controller.abort();
  }, [activeWorkspace.id, apiBaseUrl, reloadToken, scope]);

  useEffect(() => {
    const controller = new AbortController();
    const loadMembers = async (): Promise<void> => {
      setIsLoadingMembers(true);
      setMembersErrorMessage(null);
      setWorkspaceMembers([]);
      try {
        const response = await fetch(new URL("/workspace/members", apiBaseUrl), {
          credentials: "include",
          cache: "no-store",
          headers: { "X-Workspace-Id": activeWorkspace.id },
          signal: controller.signal
        });
        if (!response.ok) {
          setMembersErrorMessage(response.status === 401
            ? "Your session has expired. Sign in again to load workspace members."
            : response.status === 403
              ? "You no longer have access to this workspace."
              : "Workspace members could not be loaded. Please try again.");
          return;
        }
        const parsed = workspaceMembersSchema.safeParse(await response.json());
        if (!parsed.success) {
          setMembersErrorMessage("The server returned an invalid workspace member list.");
          return;
        }
        setWorkspaceMembers(parsed.data.members);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMembersErrorMessage("Workspace members could not be loaded. Check your connection and try again.");
      } finally {
        if (!controller.signal.aborted) setIsLoadingMembers(false);
      }
    };
    void loadMembers();
    return () => controller.abort();
  }, [activeWorkspace.id, apiBaseUrl, membersReloadToken]);

  const loadNextPage = async (): Promise<void> => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setPageErrorMessage(null);
    try {
      const url = new URL("/channels", apiBaseUrl);
      url.searchParams.set("scope", scope);
      url.searchParams.set("cursor", nextCursor);
      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        headers: { "X-Workspace-Id": activeWorkspace.id }
      });
      if (!response.ok) {
        setPageErrorMessage("More channels could not be loaded. Please try again.");
        return;
      }
      const parsed = channelListResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setPageErrorMessage("The server returned an invalid channel page. Please try again.");
        return;
      }
      setChannelList((current) => {
        const knownIds = new Set(current.map((channel) => channel.id));
        return [...current, ...parsed.data.channels.filter((channel) => !knownIds.has(channel.id))];
      });
      setNextCursor(parsed.data.nextCursor);
    } catch {
      setPageErrorMessage("More channels could not be loaded. Check your connection and try again.");
    } finally {
      setIsLoadingMore(false);
    }
  };

  const joinChannel = async (channelId: string): Promise<void> => {
    if (membershipActionId) return;
    setMembershipActionId(channelId);
    setMembershipErrorMessage(null);
    try {
      const response = await fetch(new URL(`/channels/${encodeURIComponent(channelId)}/memberships`, apiBaseUrl), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "X-Workspace-Id": activeWorkspace.id }
      });
      if (!response.ok) {
        setMembershipErrorMessage(response.status === 401
          ? "Your session has expired. Sign in again to join this channel."
          : response.status === 403
            ? "Only public channels can be joined from the directory."
            : response.status === 503
              ? "Channel storage is not ready. Run `pnpm --filter @workspace/api channels:initialize`, then restart the API."
            : "This channel could not be joined. Refresh the directory and try again.");
        return;
      }
      const result = channelJoinResponseSchema.safeParse(await response.json());
      if (!result.success) {
        setMembershipErrorMessage("The server returned an invalid membership response.");
        return;
      }
      setReloadToken((current) => current + 1);
    } catch {
      setMembershipErrorMessage("The channel could not be joined. Check your connection and try again.");
    } finally {
      setMembershipActionId(null);
    }
  };

  const leaveChannel = async (): Promise<void> => {
    if (!channelToLeave || membershipActionId) return;
    const channel = channelToLeave;
    setMembershipActionId(channel.id);
    setMembershipErrorMessage(null);
    try {
      const response = await fetch(new URL(`/channels/${encodeURIComponent(channel.id)}/memberships`, apiBaseUrl), {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
        headers: { "X-Workspace-Id": activeWorkspace.id }
      });
      if (!response.ok) {
        setMembershipErrorMessage(response.status === 401
          ? "Your session has expired. Sign in again to leave this channel."
          : response.status === 503
            ? "Channel storage is not ready. Run `pnpm --filter @workspace/api channels:initialize`, then restart the API."
            : "This channel could not be left. Please try again.");
        return;
      }
      setChannelToLeave(null);
      setReloadToken((current) => current + 1);
      if (pathname === `/channels/${encodeURIComponent(channel.id)}`) router.push("/" as Route);
    } catch {
      setMembershipErrorMessage("The channel could not be left. Check your connection and try again.");
    } finally {
      setMembershipActionId(null);
    }
  };

  const openDirectMessage = async (recipientId: string): Promise<void> => {
    if (openingDirectMessageFor) return;
    setOpeningDirectMessageFor(recipientId);
    setDirectMessageActionError(null);
    try {
      const response = await fetch(new URL("/direct-messages", apiBaseUrl), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": activeWorkspace.id },
        body: JSON.stringify({ recipientId })
      });
      if (!response.ok) {
        setDirectMessageActionError(response.status === 503
          ? "Direct messages are not initialized. Ask an administrator to run `pnpm --filter @workspace/api direct-messages:initialize`."
          : response.status === 400
            ? "You cannot start a direct message with yourself."
            : "This member is unavailable for direct messages.");
        return;
      }
      const parsed = directConversationResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setDirectMessageActionError("The server returned an invalid direct-conversation response.");
        return;
      }
      router.push(`/messages/${encodeURIComponent(parsed.data.conversation.id)}` as Route);
    } catch {
      setDirectMessageActionError("The direct conversation could not be opened. Check your connection and retry.");
    } finally {
      setOpeningDirectMessageFor(null);
    }
  };

  return (
    <div className={`mt-4 grid min-h-[28rem] flex-1 overflow-hidden rounded-lg border border-border bg-background md:min-h-0 ${
      isSidebarOpen ? "md:grid-cols-[15rem_minmax(0,1fr)]" : "grid-cols-1"
    }`}>
      <aside
        aria-label="Workspace channels"
        className={isSidebarOpen
          ? "flex min-w-0 flex-col border-b border-border bg-muted/20 md:min-h-0 md:overflow-y-auto md:border-b-0 md:border-r"
          : "hidden"}
        id="workspace-channel-sidebar"
      >
        <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-4">
          <h2 className="text-sm font-semibold text-foreground">Channels</h2>
          <ChannelCreateDialog apiBaseUrl={apiBaseUrl} />
        </div>
        <Link
          aria-current={pathname === "/profile" ? "page" : undefined}
          className={`mx-2 mb-2 rounded-md px-3 py-2 text-sm transition-colors ${
            pathname === "/profile"
              ? "bg-accent font-medium text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          }`}
          href={"/profile" as Route}
        >
          Profile
        </Link>
        {directMessageActionError ? (
          <p className="mx-3 mb-2 text-xs text-destructive" role="alert">{directMessageActionError}</p>
        ) : null}
        <section aria-label="Direct messages" className="border-b border-border px-3 pb-3">
          <div className="flex items-center justify-between gap-2 py-2">
            <h3 className="text-sm font-semibold text-foreground">Direct messages</h3>
            <Button
              aria-label="Refresh direct messages"
              disabled={directMessagesLoading}
              onClick={() => setDirectMessagesReloadToken((current) => current + 1)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {directMessagesLoading ? "Loading…" : "Refresh"}
            </Button>
          </div>
          {directMessagesError ? (
            <div className="space-y-2 py-1">
              <p className="text-xs text-destructive" role="alert">{directMessagesError}</p>
              <Button onClick={() => setDirectMessagesReloadToken((current) => current + 1)} size="sm" type="button" variant="outline">
                Retry
              </Button>
            </div>
          ) : directMessagesLoading ? (
            <p className="py-2 text-xs text-muted-foreground" role="status">Loading conversations…</p>
          ) : directConversations.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">Select a workspace member below to start a private chat.</p>
          ) : (
            <ul className="space-y-1">
              {directConversations.map((conversation) => {
                const href = `/messages/${encodeURIComponent(conversation.id)}`;
                return (
                  <li key={conversation.id}>
                    <Link
                      aria-current={pathname === href ? "page" : undefined}
                      className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                        pathname === href
                          ? "bg-accent font-medium text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                      }`}
                      href={href as Route}
                    >
                      <MessageCircle aria-hidden="true" className="size-4 shrink-0" />
                      <span className="truncate">{conversation.otherParticipant.name}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <div aria-label="Channel list scope" className="grid grid-cols-2 gap-1 px-3 pb-2" role="group">
          <Button
            aria-pressed={scope === "joined"}
            onClick={() => setScope("joined")}
            size="sm"
            type="button"
            variant={scope === "joined" ? "secondary" : "ghost"}
          >
            Your channels
          </Button>
          <Button
            aria-pressed={scope === "discoverable"}
            onClick={() => setScope("discoverable")}
            size="sm"
            type="button"
            variant={scope === "discoverable" ? "secondary" : "ghost"}
          >
            Browse public
          </Button>
        </div>
        <nav aria-label="Channels" className="min-h-0 flex-1 px-2 pb-4">
          {isLoading ? (
            <p className="px-2 py-3 text-sm text-muted-foreground" role="status">Loading channels…</p>
          ) : errorMessage ? (
            <div className="space-y-2 px-2 py-2">
              <p className="text-sm text-destructive" role="alert">{errorMessage}</p>
              <Button onClick={() => setReloadToken((current) => current + 1)} size="sm" type="button" variant="outline">
                Retry
              </Button>
            </div>
          ) : (
            channelList.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                {scope === "joined" ? "No channels yet. Create one to get started." : "No public channels are available to discover."}
              </p>
            ) : (
              <>
                <ul className="space-y-1">
                  {channelList.map((channel) => {
                    const href = `/channels/${encodeURIComponent(channel.id)}`;
                    const isActive = pathname === href;
                    return (
                      <li key={channel.id}>
                        {scope === "joined" ? (
                          <div className="flex min-w-0 items-center gap-1">
                            <Link
                              aria-current={isActive ? "page" : undefined}
                              className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                                isActive
                                  ? "bg-accent font-medium text-accent-foreground"
                                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                              }`}
                              href={href as Route}
                            >
                              <span aria-hidden="true" className="shrink-0">{channel.visibility === "private" ? "lock" : "#"}</span>
                              <span className="truncate">{channel.name}</span>
                            </Link>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  aria-label={`More options for #${channel.name}`}
                                  disabled={membershipActionId !== null}
                                  size="icon"
                                  type="button"
                                  variant="ghost"
                                >
                                  <MoreHorizontal aria-hidden="true" className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setMembershipErrorMessage(null);
                                    setChannelToLeave(channel);
                                  }}
                                >
                                  <LogOut aria-hidden="true" />
                                  Leave channel
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        ) : (
                          <div className="min-w-0 rounded-md px-2 py-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-medium text-foreground"># {channel.name}</p>
                              <Button
                                disabled={membershipActionId !== null}
                                onClick={() => void joinChannel(channel.id)}
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                {membershipActionId === channel.id ? "Joining…" : "Join"}
                              </Button>
                            </div>
                            {channel.description ? (
                              <p className="truncate pl-4 text-xs text-muted-foreground">{channel.description}</p>
                            ) : null}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {pageErrorMessage ? <p className="px-2 pt-2 text-sm text-destructive" role="alert">{pageErrorMessage}</p> : null}
                {membershipErrorMessage ? <p className="px-2 pt-2 text-sm text-destructive" role="alert">{membershipErrorMessage}</p> : null}
                {nextCursor ? (
                  <Button
                    className="mt-2 w-full"
                    disabled={isLoadingMore}
                    onClick={() => void loadNextPage()}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {isLoadingMore ? "Loading…" : "Load more"}
                  </Button>
                ) : null}
              </>
            )
          )}
        </nav>
        <section aria-label="Workspace members" className="border-t border-border px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              Members{!isLoadingMembers && !membersErrorMessage ? ` (${workspaceMembers.length})` : ""}
            </h3>
            <Button
              aria-label="Refresh workspace members"
              disabled={isLoadingMembers}
              onClick={() => setMembersReloadToken((current) => current + 1)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {isLoadingMembers ? "Loading…" : "Refresh"}
            </Button>
          </div>
          {isLoadingMembers ? (
            <p className="px-2 py-2 text-sm text-muted-foreground" role="status">Loading members…</p>
          ) : membersErrorMessage ? (
            <div className="space-y-2 px-2 py-2">
              <p className="text-sm text-destructive" role="alert">{membersErrorMessage}</p>
              <Button onClick={() => setMembersReloadToken((current) => current + 1)} size="sm" type="button" variant="outline">
                Retry
              </Button>
            </div>
          ) : workspaceMembers.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">No workspace members found.</p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto pt-2">
              {workspaceMembers.map((member) => (
                <li key={member.id} className="flex items-center gap-1 rounded-md px-2 py-1.5">
                  <Link
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={`/members/${encodeURIComponent(member.id)}` as Route}
                  >
                    <span
                      aria-label={realtime.onlineUserIds.includes(member.id) ? "Online" : "Offline"}
                      className={`size-2 shrink-0 rounded-full ${
                        realtime.onlineUserIds.includes(member.id) ? "bg-emerald-500" : "bg-muted-foreground/40"
                      }`}
                      title={realtime.onlineUserIds.includes(member.id) ? "Online" : "Offline"}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{member.name ?? "Workspace member"}</span>
                      {member.title ? <span className="block truncate text-xs text-muted-foreground">{member.title}</span> : null}
                      {member.email ? <span className="block truncate text-xs text-muted-foreground">{member.email}</span> : null}
                      {member.role === "admin" ? <span className="block text-xs text-muted-foreground">Workspace admin</span> : null}
                    </span>
                  </Link>
                  {member.id !== currentUser.id ? (
                    <Button
                      aria-label={`Message ${member.name ?? "workspace member"}`}
                      disabled={openingDirectMessageFor !== null}
                      onClick={() => void openDirectMessage(member.id)}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <MessageCircle aria-hidden="true" className="size-4" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
      <section aria-label="Channel content" className="flex min-w-0 flex-col overflow-y-auto p-3 sm:p-4 md:min-h-0">
        <div className="mb-2 flex">
          <Button
            aria-controls="workspace-channel-sidebar"
            aria-expanded={isSidebarOpen}
            aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
            onClick={() => setIsSidebarOpen((isOpen) => !isOpen)}
            size="icon"
            type="button"
            variant="ghost"
          >
            {isSidebarOpen
              ? <PanelLeftClose aria-hidden="true" className="size-4" />
              : <PanelLeftOpen aria-hidden="true" className="size-4" />}
          </Button>
        </div>
        {children}
      </section>
      <Dialog
        onOpenChange={(open) => { if (!open && membershipActionId === null) setChannelToLeave(null); }}
        open={channelToLeave !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave #{channelToLeave?.name}?</DialogTitle>
            <DialogDescription>
              You will lose access to this channel and its history until you join again. The channel and its messages will remain for other members, even if no administrators remain.
            </DialogDescription>
          </DialogHeader>
          {membershipErrorMessage ? <p className="text-sm text-destructive" role="alert">{membershipErrorMessage}</p> : null}
          <DialogFooter>
            <Button
              disabled={membershipActionId !== null}
              onClick={() => setChannelToLeave(null)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={membershipActionId !== null} onClick={() => void leaveChannel()} type="button" variant="destructive">
              {membershipActionId === channelToLeave?.id ? "Leaving…" : "Leave channel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const ChannelWorkspace = ({ apiBaseUrl, children }: ChannelWorkspaceProps): ReactElement => {
  const { activeWorkspace } = useWorkspaceContext();
  return (
    <ChannelRealtimeProvider apiBaseUrl={apiBaseUrl} workspaceId={activeWorkspace.id}>
      <ChannelWorkspaceContent apiBaseUrl={apiBaseUrl}>{children}</ChannelWorkspaceContent>
    </ChannelRealtimeProvider>
  );
};
