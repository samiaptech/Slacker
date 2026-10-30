"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NotificationResource, RealtimeServerEvents } from "@workspace/types";
import type { ChannelRealtimeSocket } from "@/features/channels/public";
import { shouldApplyNotificationLoad } from "./notification-load-state";
import {
  notificationEventSchema,
  notificationListResponseSchema,
  notificationUnreadCountSchema,
  type NotificationView
} from "./types/notification-response";

const NOTIFICATION_PAGE_SIZE = 50;

type UseNotificationsResult = Readonly<{
  notifications: readonly NotificationView[];
  unreadCount: number;
  unreadResourceKey: (resource: NotificationResource) => string;
  isUnread: (resource: NotificationResource) => boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  refresh: () => void;
  loadMore: () => Promise<void>;
  markRead: (notificationId: string) => Promise<boolean>;
  markResourceReadLocally: (resource: NotificationResource) => void;
}>;

const unreadCountFrom = (value: unknown): number | null => {
  const parsed = notificationUnreadCountSchema.safeParse(value);
  return parsed.success ? parsed.data.unreadCount : null;
};

export const useNotifications = (
  apiBaseUrl: string,
  socket: ChannelRealtimeSocket | null
): UseNotificationsResult => {
  const [notifications, setNotifications] = useState<readonly NotificationView[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const hasConnectedRef = useRef(false);
  const notificationRevisionRef = useRef(0);
  const loadRequestIdRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const requestId = ++loadRequestIdRef.current;
    const requestRevision = notificationRevisionRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const listUrl = new URL("/notifications", apiBaseUrl);
      listUrl.searchParams.set("limit", String(NOTIFICATION_PAGE_SIZE));
      const requestInit: RequestInit = {
        credentials: "include",
        cache: "no-store",
        ...(signal ? { signal } : {})
      };
      const [listResponse, countResponse] = await Promise.all([
        fetch(listUrl, requestInit),
        fetch(new URL("/notifications/unread-count", apiBaseUrl), requestInit)
      ]);
      if (!listResponse.ok || !countResponse.ok) {
        throw new Error(listResponse.status === 503 || countResponse.status === 503
          ? "Notifications are not initialized. Ask an administrator to run `pnpm --filter @workspace/api notifications:initialize`."
          : "Notifications could not be loaded. Please retry.");
      }
      const [listBody, countBody]: [unknown, unknown] = await Promise.all([
        listResponse.json(),
        countResponse.json()
      ]);
      const page = notificationListResponseSchema.safeParse(listBody);
      const count = unreadCountFrom(countBody);
      if (!page.success || count === null) {
        throw new Error("The server returned an invalid notification response.");
      }
      if (!shouldApplyNotificationLoad(
        requestId,
        loadRequestIdRef.current,
        requestRevision,
        notificationRevisionRef.current
      )) return;
      setNotifications(page.data.notifications);
      setNextCursor(page.data.nextCursor);
      setUnreadCount(count);
    } catch (failure: unknown) {
      if (failure instanceof DOMException && failure.name === "AbortError") return;
      if (!shouldApplyNotificationLoad(
        requestId,
        loadRequestIdRef.current,
        requestRevision,
        notificationRevisionRef.current
      )) return;
      setError(failure instanceof Error ? failure.message : "Notifications could not be loaded.");
    } finally {
      if (!signal?.aborted && requestId === loadRequestIdRef.current) setIsLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(controller.signal); }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, reloadToken]);

  useEffect(() => {
    if (!socket) return;
    const onNotification = (payload: Parameters<RealtimeServerEvents["notification:new"]>[0]): void => {
      const parsed = notificationEventSchema.safeParse(payload);
      if (!parsed.success) return;
      const { recipientId, ...notification } = parsed.data.notification;
      if (!recipientId) return;
      notificationRevisionRef.current += 1;
      setNotifications((current) => {
        if (current.some((item) => item.id === notification.id)) return current;
        return [notification, ...current].slice(0, NOTIFICATION_PAGE_SIZE);
      });
      setUnreadCount((current) => current + 1);
    };
    const onUnreadCount = (payload: Parameters<RealtimeServerEvents["notification:unread-count"]>[0]): void => {
      const count = unreadCountFrom(payload);
      if (count !== null) {
        notificationRevisionRef.current += 1;
        setUnreadCount(count);
      }
    };
    const onConnect = (): void => {
      if (hasConnectedRef.current) void load();
      hasConnectedRef.current = true;
    };
    socket.on("notification:new", onNotification);
    socket.on("notification:unread-count", onUnreadCount);
    socket.on("connect", onConnect);
    return () => {
      socket.off("notification:new", onNotification);
      socket.off("notification:unread-count", onUnreadCount);
      socket.off("connect", onConnect);
    };
  }, [load, socket]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setError(null);
    try {
      const url = new URL("/notifications", apiBaseUrl);
      url.searchParams.set("limit", String(NOTIFICATION_PAGE_SIZE));
      url.searchParams.set("before", nextCursor);
      const response = await fetch(url, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("More notifications could not be loaded. Please retry.");
      const parsed = notificationListResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("The server returned an invalid notification page.");
      setNotifications((current) => {
        const ids = new Set(current.map((notification) => notification.id));
        return [...current, ...parsed.data.notifications.filter((notification) => !ids.has(notification.id))];
      });
      setNextCursor(parsed.data.nextCursor);
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : "More notifications could not be loaded.");
    } finally {
      setIsLoadingMore(false);
    }
  }, [apiBaseUrl, isLoadingMore, nextCursor]);

  const markRead = useCallback(async (notificationId: string): Promise<boolean> => {
    try {
      const response = await fetch(new URL(`/notifications/${encodeURIComponent(notificationId)}/read`, apiBaseUrl), {
        method: "PATCH",
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) {
        setError(response.status === 503
          ? "Notifications are temporarily unavailable. Try again later."
          : "This notification could not be marked as read.");
        return false;
      }
      notificationRevisionRef.current += 1;
      setNotifications((current) => current.map((notification) =>
        notification.id === notificationId && notification.readAt === null
          ? { ...notification, readAt: new Date().toISOString() }
          : notification
      ));
      setUnreadCount((current) => Math.max(0, current - 1));
      return true;
    } catch {
      setError("This notification could not be marked as read. Check your connection and retry.");
      return false;
    }
  }, [apiBaseUrl]);

  const markResourceReadLocally = useCallback((resource: NotificationResource): void => {
    notificationRevisionRef.current += 1;
    setNotifications((current) => current.map((notification) =>
      notification.resource.type === resource.type
        && notification.resource.id === resource.id
        && notification.readAt === null
        ? { ...notification, readAt: new Date().toISOString() }
        : notification
    ));
  }, []);

  const unreadResources = useMemo(() => new Set(
    notifications
      .filter((notification) => notification.readAt === null)
      .map(({ resource }) => `${resource.type}:${resource.id}`)
  ), [notifications]);
  const unreadResourceKey = useCallback((resource: NotificationResource): string =>
    `${resource.type}:${resource.id}`, []);

  return {
    notifications,
    unreadCount,
    unreadResourceKey,
    isUnread: (resource) => unreadResources.has(unreadResourceKey(resource)),
    isLoading,
    isLoadingMore,
    error,
    hasMore: nextCursor !== null,
    refresh: () => setReloadToken((current) => current + 1),
    loadMore,
    markRead,
    markResourceReadLocally
  };
};
