"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChannelMessageResponse, RealtimeServerEvents } from "@workspace/types";
import { messageReactionToggleResponseSchema, type MessageDeleteScope } from "@/features/conversation-history/public";
import {
  channelMessageResponseSchema,
  channelThreadResponseSchema,
  channelThreadSummarySchema,
  type ChannelMessageView
} from "../types";
import type { ChannelRealtimeSocket } from "./channel-realtime-provider";

type Options = Readonly<{
  apiBaseUrl: string;
  workspaceId: string;
  channelId: string;
  rootId: string;
  initialRoot?: ChannelMessageView;
  socket: ChannelRealtimeSocket | null;
  onClose: () => void;
  onSummary: (rootId: string, summary: NonNullable<ChannelMessageView["thread"]>) => void;
  onRootDeleted: (scope: MessageDeleteScope) => void;
}>;

export const useChannelThreadData = ({ apiBaseUrl, workspaceId, channelId, rootId, initialRoot, socket, onClose, onSummary, onRootDeleted }: Options) => {
  const [root, setRoot] = useState<ChannelMessageView | null>(initialRoot ?? null);
  const [replies, setReplies] = useState<readonly ChannelMessageView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOlderLoading, setIsOlderLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = useMemo(() => `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(rootId)}/replies`, [channelId, rootId]);

  const getMessage = useCallback((id: string): ChannelMessageView | undefined => id === rootId ? root ?? undefined : replies.find((reply) => reply.id === id), [replies, root, rootId]);
  const updateMessage = useCallback((message: ChannelMessageView): void => {
    if (message.id === rootId) setRoot(message);
    else setReplies((current) => current.map((reply) => reply.id === message.id ? message : reply));
  }, [rootId]);
  const addReply = useCallback((message: ChannelMessageView): void => {
    setReplies((current) => current.some((item) => item.id === message.id)
      ? current
      : [...current, message].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
  }, []);
  const removeMessage = useCallback((id: string, scope: MessageDeleteScope): void => {
    if (id === rootId) { onRootDeleted(scope); onClose(); }
    else setReplies((current) => current.filter((reply) => reply.id !== id));
  }, [onClose, onRootDeleted, rootId]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const url = new URL(endpoint, apiBaseUrl);
        url.searchParams.set("limit", "50");
        const response = await fetch(url, { credentials: "include", cache: "no-store", headers: { "X-Workspace-Id": workspaceId }, signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 403 || response.status === 404 ? "This thread is unavailable or you no longer have access." : "Thread replies could not be loaded. Try again.");
        const parsed = channelThreadResponseSchema.safeParse(await response.json());
        if (!parsed.success || parsed.data.root.id !== rootId || parsed.data.root.channelId !== channelId || parsed.data.root.threadRootId) throw new Error("The server returned an invalid thread.");
        setRoot(parsed.data.root);
        setReplies((current) => [...new Map([...parsed.data.replies, ...current].map((reply) => [reply.id, reply])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
        setCursor(parsed.data.nextCursor);
        if (parsed.data.root.thread) onSummary(rootId, parsed.data.root.thread);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Thread replies could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [apiBaseUrl, channelId, endpoint, onSummary, rootId, workspaceId]);

  useEffect(() => {
    if (!socket) return;
    const onReply = (event: Parameters<RealtimeServerEvents["channel:thread:reply:new"]>[0]): void => {
      if (event.channelId !== channelId || event.rootMessageId !== rootId) return;
      const reply = channelMessageResponseSchema.safeParse(event.reply);
      const thread = channelThreadSummarySchema.safeParse(event.thread);
      if (!reply.success || reply.data.threadRootId !== rootId || !thread.success) return;
      setReplies((current) => current.some(({ id }) => id === reply.data.id)
        ? current.map((item) => item.id === reply.data.id ? reply.data : item)
        : [...current, reply.data].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
      onSummary(rootId, thread.data);
    };
    const onUpdated = (payload: ChannelMessageResponse): void => {
      const message = channelMessageResponseSchema.safeParse(payload);
      if (!message.success || message.data.channelId !== channelId) return;
      if (message.data.id === rootId) setRoot(message.data);
      if (message.data.threadRootId === rootId) setReplies((current) => current.map((item) => item.id === message.data.id ? message.data : item));
    };
    const onDeleted = (payload: Readonly<{ channelId: string; messageId: string }>): void => {
      if (payload.channelId !== channelId) return;
      if (payload.messageId === rootId) { onRootDeleted("everyone"); onClose(); }
      else setReplies((current) => current.filter((reply) => reply.id !== payload.messageId));
    };
    const onReactions = (payload: { channelId: string; messageId: string; reactions: ChannelMessageView["reactions"] }): void => {
      if (payload.channelId !== channelId) return;
      const change = messageReactionToggleResponseSchema.safeParse(payload);
      const current = change.success ? getMessage(change.data.messageId) : undefined;
      if (current && change.success) updateMessage({ ...current, reactions: change.data.reactions });
    };
    socket.on("channel:thread:reply:new", onReply);
    socket.on("channel:message:updated", onUpdated);
    socket.on("channel:message:deleted", onDeleted);
    socket.on("channel:message:reactions", onReactions);
    return () => {
      socket.off("channel:thread:reply:new", onReply);
      socket.off("channel:message:updated", onUpdated);
      socket.off("channel:message:deleted", onDeleted);
      socket.off("channel:message:reactions", onReactions);
    };
  }, [channelId, getMessage, onClose, onRootDeleted, onSummary, rootId, socket, updateMessage]);

  const loadOlder = useCallback(async (): Promise<void> => {
    if (!cursor || isOlderLoading) return;
    setIsOlderLoading(true);
    setError(null);
    try {
      const url = new URL(endpoint, apiBaseUrl);
      url.searchParams.set("limit", "50");
      url.searchParams.set("before", cursor);
      const response = await fetch(url, { credentials: "include", cache: "no-store", headers: { "X-Workspace-Id": workspaceId } });
      if (!response.ok) throw new Error("Older replies could not be loaded. Try again.");
      const parsed = channelThreadResponseSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.root.id !== rootId) throw new Error("The server returned an invalid reply page.");
      setReplies((current) => [...new Map([...parsed.data.replies, ...current].map((reply) => [reply.id, reply])).values()]);
      setCursor(parsed.data.nextCursor);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Older replies could not be loaded.");
    } finally {
      setIsOlderLoading(false);
    }
  }, [apiBaseUrl, cursor, endpoint, isOlderLoading, rootId, workspaceId]);

  return { root, replies, cursor, isLoading, isOlderLoading, error, setError, getMessage, updateMessage, addReply, removeMessage, loadOlder, endpoint } as const;
};
