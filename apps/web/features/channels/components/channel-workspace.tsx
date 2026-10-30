"use client";

import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import type { NotificationResponse } from "@workspace/types";
import { application } from "@/constants/application";
import { fetchSharedGet } from "@/app/fetch-shared-get";
import { Activity, ChevronDown, Hash, LogOut, MessageCircle, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, UserRound, Users } from "lucide-react";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@workspace/ui/primitives";
import { ChannelCreateDialog } from "./create-channel-dialog";
import { WorkspaceSearchDialog } from "./workspace-search-dialog";
import { ChannelRealtimeProvider, useChannelRealtime } from "./channel-realtime-provider";
import { ChannelProfileToggleProvider, useChannelProfileToggle } from "./channel-profile-toggle-context";
import { ChannelLeaveProvider, type ChannelLeaveTarget } from "./channel-leave-context";
import { ChannelMessageRefreshProvider, useChannelMessageRefresh } from "./channel-message-refresh-context";
import { useAppVisualViewport } from "./use-app-visual-viewport";
import { NotificationCenter, useNotifications } from "@/features/notifications/public";
import { directConversationListResponseSchema, directConversationResponseSchema } from "@/features/direct-messages/public";
import type { DirectConversationView } from "@/features/direct-messages/public";
import {
  channelJoinResponseSchema,
  channelListResponseSchema,
  type ChannelListResponseView
} from "../types";
import { useWorkspaceContext, WorkspaceLeaveDialog, WorkspaceLeaveMenuItem } from "@/features/workspace-foundation/public";
import { UserAvatar, workspaceMembersSchema, type WorkspaceMembersView } from "@/features/identity/public";

type ChannelWorkspaceProps = Readonly<{
  apiBaseUrl: string;
  children: ReactNode;
}>;

type ChannelListScope = "joined" | "discoverable";

const ChannelWorkspaceContent = ({ apiBaseUrl, children }: ChannelWorkspaceProps): ReactElement => {
  useAppVisualViewport();
  const { activeWorkspace, currentUser, selectWorkspace, signOut, startCreatingWorkspace, workspaces } = useWorkspaceContext();
  const profileToggle = useChannelProfileToggle();
  const realtime = useChannelRealtime();
  const { refreshMessages } = useChannelMessageRefresh();
  const notificationInbox = useNotifications(apiBaseUrl, realtime.socket);
  const pathname = usePathname();
  const router = useRouter();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isLeaveWorkspaceOpen, setIsLeaveWorkspaceOpen] = useState(false);
  const [scope, setScope] = useState<ChannelListScope>("joined");
  const [channelList, setChannelList] = useState<ChannelListResponseView["channels"]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pageErrorMessage, setPageErrorMessage] = useState<string | null>(null);
  const [membershipActionId, setMembershipActionId] = useState<string | null>(null);
  const [membershipErrorMessage, setMembershipErrorMessage] = useState<string | null>(null);
  const [channelToLeave, setChannelToLeave] = useState<ChannelLeaveTarget | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMembersView["members"]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);
  const [membersErrorMessage, setMembersErrorMessage] = useState<string | null>(null);
  const [membersReloadToken, setMembersReloadToken] = useState(0);
  const pendingWorkspaceLanding = useRef<string | null>(null);
  const [directConversations, setDirectConversations] = useState<readonly DirectConversationView[]>([]);
  const [directMessagesError, setDirectMessagesError] = useState<string | null>(null);
  const [directMessagesLoading, setDirectMessagesLoading] = useState(true);
  const [directMessagesReloadToken, setDirectMessagesReloadToken] = useState(0);
  const [openingDirectMessageFor, setOpeningDirectMessageFor] = useState<string | null>(null);
  const [directMessageActionError, setDirectMessageActionError] = useState<string | null>(null);
  const activeChannel = pathname.startsWith("/channels/")
    ? channelList.find((channel) => {
        const channelPath = `/channels/${encodeURIComponent(channel.id)}`;
        return pathname === channelPath || pathname === `${channelPath}/about`;
      })
    : undefined;
  const activeConversation = pathname.startsWith("/messages/")
    ? directConversations.find((conversation) => pathname === `/messages/${encodeURIComponent(conversation.id)}`)
    : undefined;

  useEffect(() => {
    const focusNavigationSearch = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener("keydown", focusNavigationSearch);
    return () => window.removeEventListener("keydown", focusNavigationSearch);
  }, []);

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
        const response = await fetchSharedGet(new URL("/direct-messages", apiBaseUrl), {
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
        const response = await fetchSharedGet(url, {
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
        if (pendingWorkspaceLanding.current === activeWorkspace.id) {
          const landingChannel = parsed.data.channels.find(
            (channel) => channel.name.trim().toLocaleLowerCase() === "general"
          ) ?? parsed.data.channels[0];
          pendingWorkspaceLanding.current = null;
          if (landingChannel) router.replace(`/channels/${encodeURIComponent(landingChannel.id)}` as Route);
        }
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setErrorMessage("Your channels could not be loaded. Check your connection and try again.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };
    void loadChannels();
    return () => controller.abort();
  }, [activeWorkspace.id, apiBaseUrl, reloadToken, router, scope]);

  useEffect(() => {
    const controller = new AbortController();
    const loadMembers = async (): Promise<void> => {
      setIsLoadingMembers(true);
      setMembersErrorMessage(null);
      setWorkspaceMembers([]);
      try {
        const response = await fetchSharedGet(new URL("/workspace/members", apiBaseUrl), {
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
      const channelPath = `/channels/${encodeURIComponent(channel.id)}`;
      if (pathname === channelPath || pathname === `${channelPath}/about`) router.push("/" as Route);
    } catch {
      setMembershipErrorMessage("The channel could not be left. Check your connection and try again.");
    } finally {
      setMembershipActionId(null);
    }
  };

  const requestLeaveChannel = useCallback((channel: ChannelLeaveTarget): void => {
    setMembershipErrorMessage(null);
    setChannelToLeave(channel);
  }, []);

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

  const switchWorkspace = (workspaceId: string): void => {
    if (workspaceId === activeWorkspace.id) return;
    pendingWorkspaceLanding.current = workspaceId;
    setScope("joined");
    selectWorkspace(workspaceId);
    setIsMobileSidebarOpen(false);
    router.replace("/");
  };

  const openNotification = (notification: NotificationResponse): boolean => {
    if (!workspaces.some(({ id }) => id === notification.workspaceId)) return false;
    if (notification.workspaceId !== activeWorkspace.id) selectWorkspace(notification.workspaceId);
    notificationInbox.markResourceReadLocally(notification.resource);
    setIsMobileSidebarOpen(false);
    const target = notification.resource.type === "channel"
      ? `/channels/${encodeURIComponent(notification.resource.id)}`
      : `/messages/${encodeURIComponent(notification.resource.id)}`;
    const threadTarget = notification.threadRootId
      ? `${target}?thread=${encodeURIComponent(notification.threadRootId)}`
      : target;
    router.push(threadTarget as Route);
    return true;
  };

  return (
    <div className={`workspace-layout ${isSidebarOpen ? "" : "workspace-layout-collapsed"}`}>
      {isMobileSidebarOpen ? (
        <button aria-label="Close navigation" className="workspace-layout-backdrop" onClick={() => setIsMobileSidebarOpen(false)} type="button" />
      ) : null}
      <aside aria-label="Workspace rail" className="workspace-layout-rail">
        <Link aria-label={`${application.name} home`} className="workspace-rail-logo" href="/">
          <span aria-hidden="true">n.</span>
        </Link>
        <TooltipProvider delayDuration={300}>
          <div aria-label="Workspaces" className="workspace-rail-switcher">
            {workspaces.map((workspace) => (
              <Tooltip key={workspace.id}>
                <TooltipTrigger asChild>
                  <Button
                    aria-current={workspace.id === activeWorkspace.id ? "true" : undefined}
                    aria-label={`Switch to ${workspace.name}`}
                    className={workspace.id === activeWorkspace.id ? "workspace-rail-workspace is-active" : "workspace-rail-workspace"}
                    onClick={() => switchWorkspace(workspace.id)}
                    type="button"
                    variant="ghost"
                  >
                    {workspace.name.trim().slice(0, 1).toUpperCase()}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>{workspace.name}</TooltipContent>
              </Tooltip>
            ))}
          <Button aria-label="Create workspace" className="workspace-rail-add" onClick={startCreatingWorkspace} size="icon" type="button" variant="ghost">
            <Plus aria-hidden="true" className="size-5" />
          </Button>
          {!isSidebarOpen ? (
            <Button aria-controls="workspace-channel-sidebar" aria-label="Open sidebar" className="workspace-rail-add" onClick={() => setIsSidebarOpen(true)} size="icon" type="button" variant="ghost">
              <PanelLeftOpen aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
          </div>
        </TooltipProvider>
        <Link aria-label="Open your profile" className="workspace-rail-profile" href="/profile">
          <UserAvatar className="size-full rounded-full bg-[#b8e3d1] text-sm font-semibold text-[#173b3a]" image={currentUser.image} name={currentUser.name || currentUser.email} />
        </Link>
      </aside>
      <aside
        aria-label="Workspace navigation"
        className={`workspace-layout-sidebar border-r border-white/10 bg-[#173b3a] text-white shadow-2xl ${isMobileSidebarOpen ? "is-mobile-open" : ""} ${isSidebarOpen ? "" : "is-sidebar-collapsed"}`}
        id="workspace-channel-sidebar"
      >
        <div className="workspace-sidebar-brand">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight" id="workspace-title">{application.name}</h1>
            <p className="mt-0.5 truncate text-xs text-white/55">A little closer, together.</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label={`Workspace options for ${activeWorkspace.name}`} className="workspace-sidebar-workspace-button" size="icon" type="button" variant="ghost">
                <ChevronDown aria-hidden="true" className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              {workspaces.map((workspace) => (
                <DropdownMenuItem key={workspace.id} onSelect={() => switchWorkspace(workspace.id)}>
                  {workspace.name}{workspace.id === activeWorkspace.id ? " · Current" : ""}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={startCreatingWorkspace}><Plus aria-hidden="true" />New workspace</DropdownMenuItem>
              <DropdownMenuSeparator />
              <WorkspaceLeaveMenuItem onSelect={() => setIsLeaveWorkspaceOpen(true)} />
              <DropdownMenuItem onSelect={() => void signOut()}><LogOut aria-hidden="true" />Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button aria-controls="workspace-channel-sidebar" aria-label="Close sidebar" className="workspace-sidebar-collapse-button" onClick={() => setIsSidebarOpen(false)} size="icon" type="button" variant="ghost">
            <PanelLeftClose aria-hidden="true" className="size-4" />
          </Button>
        </div>
        <Button
          aria-haspopup="dialog"
          className="workspace-sidebar-search"
          onClick={() => setIsSearchOpen(true)}
          type="button"
          variant="ghost"
        >
          <Search aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Search workspace</span>
          <kbd aria-hidden="true">Ctrl / ⌘ K</kbd>
        </Button>
        <nav aria-label="Workspace" className="workspace-sidebar-primary-nav">
          <Link aria-current={pathname === "/" ? "page" : undefined} className={`workspace-sidebar-primary-link ${pathname === "/" ? "is-active" : ""}`} href="/" onClick={() => setIsMobileSidebarOpen(false)}>
            <Activity aria-hidden="true" className="size-4" /> Overview
          </Link>
          <Link className="workspace-sidebar-primary-link" href="#workspace-direct-messages">
            <MessageCircle aria-hidden="true" className="size-4" /> Messages
          </Link>
          <Link className="workspace-sidebar-primary-link" href="#workspace-members">
            <Users aria-hidden="true" className="size-4" /> Members
          </Link>
        </nav>
        {directMessageActionError ? (
          <p className="mx-4 mb-2 text-xs text-red-200" role="alert">{directMessageActionError}</p>
        ) : null}
        <section aria-label="Direct messages" className="workspace-sidebar-dms mt-4 border-b border-white/10 px-3 pb-4" id="workspace-direct-messages">
          <div className="flex items-center justify-between gap-2 px-2 py-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Messages</h3>
            <Button
              aria-label="Refresh direct messages"
              disabled={directMessagesLoading}
              onClick={() => setDirectMessagesReloadToken((current) => current + 1)}
              className="size-7 text-white/55 hover:bg-white/10 hover:text-white"
              size="icon"
              type="button"
              variant="ghost"
            >
              <span aria-hidden="true" className="text-lg leading-none">↻</span>
            </Button>
          </div>
          {directMessagesError ? (
            <div className="space-y-2 py-1">
              <p className="text-xs text-red-200" role="alert">{directMessagesError}</p>
              <Button onClick={() => setDirectMessagesReloadToken((current) => current + 1)} size="sm" type="button" variant="outline">
                Retry
              </Button>
            </div>
          ) : directMessagesLoading ? (
            <p className="py-2 text-xs text-white/45" role="status">Loading conversations…</p>
          ) : directConversations.length === 0 ? (
            <p className="py-2 text-xs leading-relaxed text-white/45">Choose a teammate below to start a private chat.</p>
          ) : (
            <ul className="space-y-1">
              {directConversations.map((conversation) => {
                const href = `/messages/${encodeURIComponent(conversation.id)}`;
                return (
                  <li key={conversation.id}>
                    <Link
                      aria-current={pathname === href ? "page" : undefined}
                      className={`flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                        pathname === href
                          ? "bg-[#b8e3d1]/15 font-medium text-[#d5f3e6]"
                          : "text-white/70 hover:bg-white/[0.07] hover:text-white"
                      }`}
                      href={href as Route}
                      onClick={() => {
                        notificationInbox.markResourceReadLocally({ type: "direct_message", id: conversation.id });
                        setIsMobileSidebarOpen(false);
                      }}
                    >
                      <UserAvatar className="size-7 shrink-0 rounded-lg bg-white/10 text-[11px] font-semibold text-[#c8e8d8]" image={conversation.otherParticipant.image} name={conversation.otherParticipant.name} />
                      <span className="truncate">{conversation.otherParticipant.name}</span>
                      {notificationInbox.isUnread({ type: "direct_message", id: conversation.id }) ? (
                        <>
                          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[#b8e3d1]" />
                          <span className="sr-only">Unread messages</span>
                        </>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <div className="workspace-sidebar-section-heading workspace-channels-heading">
          <h3>Channels</h3>
          <ChannelCreateDialog apiBaseUrl={apiBaseUrl} trigger={
            <Button aria-label="Create channel" className="workspace-sidebar-icon-button" size="icon" type="button" variant="ghost">
              <Plus aria-hidden="true" className="size-4" />
            </Button>
          } />
        </div>
        <nav aria-label="Channels" className="workspace-sidebar-channel-list min-h-40 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
          {isLoading ? (
            <p className="px-2 py-3 text-sm text-white/50" role="status">Loading channels…</p>
          ) : errorMessage ? (
            <div className="space-y-2 px-2 py-2">
              <p className="text-sm text-destructive" role="alert">{errorMessage}</p>
              <Button onClick={() => setReloadToken((current) => current + 1)} size="sm" type="button" variant="outline">
                Retry
              </Button>
            </div>
          ) : (
            channelList.length === 0 ? (
              <p className="px-2 py-3 text-sm text-white/50">
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
                              className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                                isActive
                                  ? "bg-[#b8e3d1]/15 font-medium text-[#d5f3e6]"
                                  : "text-white/70 hover:bg-white/[0.07] hover:text-white"
                              }`}
                              href={href as Route}
                              onClick={() => {
                                notificationInbox.markResourceReadLocally({ type: "channel", id: channel.id });
                                setIsMobileSidebarOpen(false);
                              }}
                            >
                              <Hash aria-hidden="true" className="size-4 shrink-0 text-white/40" />
                              <span className="truncate">{channel.name}</span>
                              {notificationInbox.isUnread({ type: "channel", id: channel.id }) ? (
                                <>
                                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[#b8e3d1]" />
                                  <span className="sr-only">Unread channel activity</span>
                                </>
                              ) : null}
                            </Link>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  aria-label={`More options for #${channel.name}`}
                                  disabled={membershipActionId !== null}
                                  size="icon"
                                  type="button"
                                  className="text-white/50 hover:bg-white/10 hover:text-white"
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
                              <p className="truncate text-sm font-medium text-white"># {channel.name}</p>
                              <Button
                                className="h-8 rounded-lg border border-[#5a9180] bg-[#286b5c] px-3 text-white shadow-sm hover:border-[#78aa98] hover:bg-[#347e6c] hover:text-white active:bg-[#20594e]"
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
        <Button className="workspace-sidebar-browse" onClick={() => setScope((current) => current === "joined" ? "discoverable" : "joined")} type="button" variant="ghost">
          <Plus aria-hidden="true" className="size-4" />
          {scope === "joined" ? "Browse channels" : "Your channels"}
        </Button>
        <section aria-label="Workspace members" className="workspace-sidebar-members shrink-0 border-t border-white/10 px-3 py-3" id="workspace-members">
          <div className="flex items-center justify-between gap-2 px-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
              Members{!isLoadingMembers && !membersErrorMessage ? ` (${workspaceMembers.length})` : ""}
            </h3>
            <Button
              aria-label="Refresh workspace members"
              disabled={isLoadingMembers}
              onClick={() => setMembersReloadToken((current) => current + 1)}
              className="size-7 text-white/55 hover:bg-white/10 hover:text-white"
              size="icon"
              type="button"
              variant="ghost"
            >
              <span aria-hidden="true" className="text-lg leading-none">↻</span>
            </Button>
          </div>
          {isLoadingMembers ? (
            <p className="px-2 py-2 text-sm text-white/50" role="status">Loading members…</p>
          ) : membersErrorMessage ? (
            <div className="space-y-2 px-2 py-2">
              <p className="text-sm text-destructive" role="alert">{membersErrorMessage}</p>
              <Button onClick={() => setMembersReloadToken((current) => current + 1)} size="sm" type="button" variant="outline">
                Retry
              </Button>
            </div>
          ) : workspaceMembers.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">No workspace members found.</p>
          ) : workspaceMembers.length === 0 ? (
            <p className="px-2 py-2 text-sm text-white/50">No matching people.</p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto pt-2">
              {workspaceMembers.map((member) => (
                <li key={member.id} className="flex items-center gap-1 rounded-md px-2 py-1.5">
                  <Link
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-white/75 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={`/members/${encodeURIComponent(member.id)}` as Route}
                  >
                    <span
                      aria-label={realtime.onlineUserIds.includes(member.id) ? "Online" : "Offline"}
                      className={`size-2 shrink-0 rounded-full ${
                        realtime.onlineUserIds.includes(member.id) ? "bg-[#80d9aa]" : "bg-white/25"
                      }`}
                      title={realtime.onlineUserIds.includes(member.id) ? "Online" : "Offline"}
                    />
                    <UserAvatar className="size-8 shrink-0 rounded-full bg-white/10 text-xs font-semibold text-[#c8e8d8]" image={member.id === currentUser.id ? currentUser.image : member.image} name={member.name ?? "Workspace member"} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{member.name ?? "Workspace member"}</span>
                      {member.title ? <span className="block truncate text-xs text-white/45">{member.title}</span> : null}
                      {member.email ? <span className="block truncate text-xs text-white/45">{member.email}</span> : null}
                      {member.role === "admin" ? <span className="block text-xs text-white/45">Workspace admin</span> : null}
                    </span>
                  </Link>
                  {member.id !== currentUser.id ? (
                    <Button
                      aria-label={`Message ${member.name ?? "workspace member"}`}
                      disabled={openingDirectMessageFor !== null}
                      onClick={() => void openDirectMessage(member.id)}
                      size="icon"
                      type="button"
                      className="text-white/55 hover:bg-white/10 hover:text-white"
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
        <div className="workspace-sidebar-profile mt-auto border-t border-white/10 p-3">
          <Link aria-current={pathname === "/profile" ? "page" : undefined} className={`flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors ${pathname === "/profile" ? "bg-white/12" : "hover:bg-white/[0.07]"}`} href="/profile" onClick={() => setIsMobileSidebarOpen(false)}>
            <UserAvatar className="size-9 shrink-0 rounded-full bg-[#b8e3d1] text-sm font-semibold text-[#173b3a]" image={currentUser.image} name={currentUser.name || currentUser.email} />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-white">{currentUser.name || "Your profile"}</span><span className="block truncate text-xs text-white/50">{activeWorkspace.role === "admin" ? "Workspace admin" : "Workspace member"}</span></span>
            <UserRound aria-hidden="true" className="size-4 text-white/50" />
          </Link>
        </div>
      </aside>
      <div className="workspace-layout-content">
      <section aria-label="Channel content" className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">
        <header className="workspace-main-header">
          <Button aria-controls="workspace-channel-sidebar" aria-expanded={isMobileSidebarOpen} aria-label={isMobileSidebarOpen ? "Close navigation" : "Open navigation"} className="workspace-toggle-mobile" onClick={() => setIsMobileSidebarOpen((isOpen) => !isOpen)} size="icon" type="button" variant="ghost">
            <PanelLeftOpen aria-hidden="true" className="size-4" />
          </Button>
          <Button aria-controls="workspace-channel-sidebar" aria-expanded={isSidebarOpen} aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"} className="workspace-toggle-desktop" onClick={() => setIsSidebarOpen((isOpen) => !isOpen)} size="icon" type="button" variant="ghost">
            {isSidebarOpen ? <PanelLeftClose aria-hidden="true" className="size-4" /> : <PanelLeftOpen aria-hidden="true" className="size-4" />}
          </Button>
          <div className="workspace-main-header-copy">
            <h2 className="workspace-main-header-title">
              {activeChannel ? (
                pathname.endsWith("/about") ? (
                  <span className="truncate">About #{activeChannel.name}</span>
                ) : (
                  <button
                    aria-expanded={profileToggle.isOpen}
                    aria-label={`Open about #${activeChannel.name}`}
                    className="inline-flex min-w-0 items-center gap-2 rounded-md text-left transition-colors hover:text-[#507b68] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9bc3ad]"
                    onClick={() => {
                      if (window.matchMedia("(max-width: 1023px)").matches) {
                        profileToggle.setIsOpen(false);
                        router.push(`/channels/${encodeURIComponent(activeChannel.id)}/about` as Route);
                      } else {
                        profileToggle.toggle();
                      }
                    }}
                    type="button"
                  >
                    <Hash aria-hidden="true" className="size-4 shrink-0 text-[#74877e]" />
                    <span className="truncate">{activeChannel.name}</span>
                    <ChevronDown aria-hidden="true" className={`size-3.5 shrink-0 transition-transform duration-200 ${profileToggle.isOpen ? "rotate-180" : ""}`} />
                  </button>
                )
              ) : activeConversation?.otherParticipant.name ?? (pathname === "/profile" ? "Your profile" : "Workspace")}
            </h2>
            <p className="workspace-main-header-subtitle">{activeChannel?.description || (activeChannel ? activeChannel.name.toLocaleLowerCase() === "general" ? "The everyday, the big ideas, and everything in between." : `${activeChannel.visibility === "public" ? "Public" : "Private"} channel · Team conversation` : activeConversation ? "Direct message" : "Your team space")}</p>
          </div>
          {activeChannel ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <span aria-label={realtime.workspaceReady ? "Live updates connected" : "Connecting to live updates"} className="flex items-center gap-1.5 text-[11px] text-[#74817b]" role="status" title={realtime.errorMessage ?? (realtime.workspaceReady ? "Live updates connected" : "Connecting to live updates")}>
                <span aria-hidden="true" className={`size-2 rounded-full ${realtime.workspaceReady ? "bg-emerald-500" : "bg-amber-400"}`} />
                <span className="hidden sm:inline">{realtime.workspaceReady ? "Live" : "Connecting"}</span>
              </span>
              {!pathname.endsWith("/about") ? (
                <Button aria-label="Refresh messages" className="size-8 text-[#687a72] hover:bg-[#eef3ef]" onClick={refreshMessages} size="icon" type="button" variant="ghost">
                  <RefreshCw aria-hidden="true" className="size-4" />
                </Button>
              ) : null}
            </div>
          ) : null}
          <NotificationCenter
            activeWorkspaceId={activeWorkspace.id}
            channels={channelList}
            conversations={directConversations}
            error={notificationInbox.error}
            hasMore={notificationInbox.hasMore}
            isLoading={notificationInbox.isLoading}
            isLoadingMore={notificationInbox.isLoadingMore}
            notifications={notificationInbox.notifications}
            onLoadMore={notificationInbox.loadMore}
            onMarkRead={notificationInbox.markRead}
            onOpen={openNotification}
            onRefresh={notificationInbox.refresh}
            unreadCount={notificationInbox.unreadCount}
            workspaces={workspaces}
          />
          <Link aria-label="Open your profile" className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#d8ebe2] text-sm font-semibold text-[#244b43]" href="/profile" onClick={() => setIsMobileSidebarOpen(false)}><UserAvatar className="size-full rounded-full bg-[#d8ebe2] text-sm font-semibold text-[#244b43]" image={currentUser.image} name={currentUser.name || currentUser.email} /></Link>
        </header>
        <div className={`flex min-h-0 flex-1 flex-col ${pathname === "/profile" || pathname.startsWith("/members/") ? "overflow-y-auto p-4 sm:p-6" : "overflow-hidden"}`}>
          <ChannelLeaveProvider onRequestLeave={requestLeaveChannel}>{children}</ChannelLeaveProvider>
        </div>
      </section>
      </div>
      <WorkspaceSearchDialog
        apiBaseUrl={apiBaseUrl}
        channels={channelList}
        conversations={directConversations}
        members={workspaceMembers}
        onOpenChange={setIsSearchOpen}
        open={isSearchOpen}
        workspaceId={activeWorkspace.id}
      />
      <WorkspaceLeaveDialog onOpenChange={setIsLeaveWorkspaceOpen} open={isLeaveWorkspaceOpen} />
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
    <ChannelProfileToggleProvider>
      <ChannelMessageRefreshProvider>
        <ChannelRealtimeProvider apiBaseUrl={apiBaseUrl} workspaceId={activeWorkspace.id}>
          <ChannelWorkspaceContent apiBaseUrl={apiBaseUrl}>{children}</ChannelWorkspaceContent>
        </ChannelRealtimeProvider>
      </ChannelMessageRefreshProvider>
    </ChannelProfileToggleProvider>
  );
};
