"use client";

import { useState, type ReactElement } from "react";
import { Bell, LoaderCircle } from "lucide-react";
import { Button } from "@workspace/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/primitives";
import type { NotificationType, WorkspaceMembershipSummary } from "@workspace/types";
import type { NotificationView } from "./types/notification-response";
import type { ChannelListResponseView } from "@/features/channels/public";
import type { DirectConversationView } from "@/features/direct-messages/public";

type NotificationCenterProps = Readonly<{
  notifications: readonly NotificationView[];
  unreadCount: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  workspaces: readonly WorkspaceMembershipSummary[];
  activeWorkspaceId: string;
  channels: ChannelListResponseView["channels"];
  conversations: readonly DirectConversationView[];
  onLoadMore: () => Promise<void>;
  onRefresh: () => void;
  onMarkRead: (notificationId: string) => Promise<boolean>;
  onOpen: (notification: NotificationView) => boolean;
}>;

const notificationAction = (type: NotificationType): string => {
  switch (type) {
    case "channel_message": return "sent a message in";
    case "channel_thread_reply": return "replied in a thread in";
    case "direct_message": return "sent you a direct message";
    case "mention": return "mentioned you in";
    case "channel_member_joined": return "joined";
    case "channel_member_left": return "left";
    case "channel_updated": return "updated";
  }
};

const notificationResourceLabel = (
  notification: NotificationView,
  activeWorkspaceId: string,
  channels: ChannelListResponseView["channels"],
  conversations: readonly DirectConversationView[]
): string => {
  if (notification.workspaceId !== activeWorkspaceId) {
    return notification.resource.type === "channel" ? "a channel" : "a direct message";
  }
  if (notification.resource.type === "channel") {
    const channel = channels.find(({ id }) => id === notification.resource.id);
    return channel ? `#${channel.name}` : "a channel";
  }
  const conversation = conversations.find(({ id }) => id === notification.resource.id);
  return conversation
    ? `your direct message with ${conversation.otherParticipant.name}`
    : "a direct message";
};

const formatNotificationTime = (value: string): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

const notificationDescription = (notification: NotificationView, resourceLabel: string): string =>
  notification.type === "direct_message"
    ? notificationAction(notification.type)
    : `${notificationAction(notification.type)} ${resourceLabel}`;

export const NotificationCenter = ({
  notifications,
  unreadCount,
  isLoading,
  isLoadingMore,
  error,
  hasMore,
  workspaces,
  activeWorkspaceId,
  channels,
  conversations,
  onLoadMore,
  onRefresh,
  onMarkRead,
  onOpen
}: NotificationCenterProps): ReactElement => {
  const [open, setOpen] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);

  const openNotification = async (notification: NotificationView): Promise<void> => {
    setNavigationError(null);
    if (!workspaces.some(({ id }) => id === notification.workspaceId)) {
      setNavigationError("This notification belongs to a workspace you no longer have access to.");
      return;
    }
    if (notification.readAt === null && !await onMarkRead(notification.id)) return;
    if (!onOpen(notification)) {
      setNavigationError("This notification belongs to a workspace you no longer have access to.");
      return;
    }
    setOpen(false);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          className="relative size-9 shrink-0"
          size="icon"
          type="button"
          variant="ghost"
        >
          <Bell aria-hidden="true" className="size-4" />
          {unreadCount > 0 ? (
            <span aria-hidden="true" className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[#b84638] px-1 text-[10px] font-semibold leading-none text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-labelledby="notifications-title" className="flex max-h-[min(58dvh,28rem)] w-[min(20rem,calc(100vw-1rem))] flex-col gap-2 overflow-hidden p-0 shadow-xl" side="bottom" sideOffset={8}>
        <div className="border-b border-border px-4 py-3 pr-10">
          <h2 className="text-sm font-semibold leading-none" id="notifications-title">Notifications</h2>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {unreadCount === 0 ? "You’re all caught up." : `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`}
          </p>
        </div>
        {error || navigationError ? (
          <p className="mx-5 text-sm text-destructive" role="alert">{navigationError ?? error}</p>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-live="polite">
          {isLoading && notifications.length === 0 ? (
            <p className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground" role="status">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />Loading notifications…
            </p>
          ) : notifications.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">New messages and channel activity will appear here.</p>
          ) : (
            <ul className="space-y-1">
              {notifications.map((notification) => {
                const resourceLabel = notificationResourceLabel(notification, activeWorkspaceId, channels, conversations);
                const workspace = workspaces.find(({ id }) => id === notification.workspaceId);
                return (
                  <li key={notification.id}>
                    <button
                      aria-label={`${notification.actor.name} ${notificationDescription(notification, resourceLabel)}, ${notification.readAt ? "read" : "unread"}`}
                      className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${notification.readAt ? "" : "bg-[#edf5ef]"}`}
                      onClick={() => void openNotification(notification)}
                      type="button"
                    >
                      <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${notification.readAt ? "bg-transparent" : "bg-[#26735e]"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-5 text-foreground">
                          <span className="font-semibold">{notification.actor.name}</span>{" "}
                          {notification.type === "direct_message"
                            ? notificationDescription(notification, resourceLabel)
                            : <>
                              {notificationAction(notification.type)}{" "}
                              <span className="font-medium">{resourceLabel}</span>
                            </>}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                          <span>{workspace?.name ?? "Workspace"}</span>
                          <time dateTime={notification.createdAt}>{formatNotificationTime(notification.createdAt)}</time>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {hasMore ? (
            <Button className="mt-2 w-full" disabled={isLoadingMore} onClick={() => void onLoadMore()} type="button" variant="outline">
              {isLoadingMore ? "Loading…" : "Load older notifications"}
            </Button>
          ) : null}
          {!isLoading && error ? (
            <Button className="mt-2 w-full" onClick={onRefresh} type="button" variant="outline">Retry</Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};
