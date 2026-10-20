"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import { RefreshCw, Send, ShieldCheck } from "lucide-react";
import { Button, Textarea } from "@workspace/ui";
import {
  channelMessageListResponseSchema,
  channelMessageResponseSchema,
  type ChannelMessageView
} from "../types";
import { useWorkspaceContext } from "@/features/workspace-foundation/public";
import { useChannelRealtime } from "./channel-realtime-provider";

const MESSAGE_PAGE_SIZE = 50;

type ChannelMessagesProps = Readonly<{
  apiBaseUrl: string;
  channelId: string;
  canSend: boolean;
}>;

const mergeMessages = (
  current: readonly ChannelMessageView[],
  incoming: readonly ChannelMessageView[]
): readonly ChannelMessageView[] => {
  const byId = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => byId.set(message.id, message));
  return [...byId.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  );
};

const formatMessageTime = (value: string): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

const getInitials = (name: string): string =>
  name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "?";

export const ChannelMessages = ({ apiBaseUrl, channelId, canSend }: ChannelMessagesProps): ReactElement => {
  const { activeWorkspace } = useWorkspaceContext();
  const realtime = useChannelRealtime();
  const [messages, setMessages] = useState<readonly ChannelMessageView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const hasReceivedChannelReadyRef = useRef(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<readonly string[]>([]);
  const bottomRef = useRef<HTMLLIElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingUsersTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const isTypingRef = useRef(false);
  const shouldScrollToBottom = useRef(true);
  const revokeAccess = useCallback((): void => {
    if (isTypingRef.current) {
      realtime.socket?.emit("channel:typing", { channelId, active: false });
      isTypingRef.current = false;
    }
    setAccessRevoked(true);
    setMessages([]);
    setNextCursor(null);
    setDraft("");
  }, [channelId, realtime.socket]);

  useEffect(() => {
    const controller = new AbortController();
    const loadMessages = async (): Promise<void> => {
      setIsLoading(true);
      setLoadError(null);
      setAccessRevoked(false);
      try {
        const url = new URL(`/channels/${encodeURIComponent(channelId)}/messages`, apiBaseUrl);
        url.searchParams.set("limit", String(MESSAGE_PAGE_SIZE));
        const response = await fetch(url, {
          credentials: "include",
          cache: "no-store",
          headers: { "X-Workspace-Id": activeWorkspace.id },
          signal: controller.signal
        });
        if (!response.ok) {
          if (response.status === 404 || response.status === 403) revokeAccess();
          setLoadError(response.status === 401
            ? "Your session expired. Sign in again to read this conversation."
            : response.status === 404 || response.status === 403
              ? "You no longer have access to this channel."
              : response.status === 503
                ? "Chat is not ready yet. Ask an administrator to initialize channel storage."
                : "Messages could not be loaded. Please try again.");
          return;
        }
        const parsed = channelMessageListResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          setLoadError("The server returned an invalid message history. Please try again.");
          return;
        }
        setMessages(parsed.data.messages);
        setNextCursor(parsed.data.nextCursor);
        shouldScrollToBottom.current = true;
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError("Messages could not be loaded. Check your connection and try again.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };
    void loadMessages();
    return () => controller.abort();
  }, [activeWorkspace.id, apiBaseUrl, channelId, reloadToken, revokeAccess]);

  useEffect(() => {
    hasReceivedChannelReadyRef.current = false;
  }, [activeWorkspace.id, channelId]);

  useEffect(() => {
    const socket = realtime.socket;
    if (!socket) return;
    const subscribe = (): void => { socket.emit("channel:subscribe", channelId); };
    const onChannelReady = (ready: Readonly<{ channelId: string }>): void => {
      if (ready.channelId !== channelId) return;
      if (hasReceivedChannelReadyRef.current) {
        setReloadToken((current) => current + 1);
      } else {
        hasReceivedChannelReadyRef.current = true;
      }
    };
    const onMessage = (message: ChannelMessageView): void => {
      if (message.channelId !== channelId) return;
      shouldScrollToBottom.current = true;
      setMessages((current) => mergeMessages(current, [message]));
    };
    const onAccessRevoked = (change: Readonly<{ workspaceId: string; channelId: string }>): void => {
      if (change.workspaceId !== activeWorkspace.id || change.channelId !== channelId) return;
      revokeAccess();
      setLoadError("You no longer have access to this channel.");
    };
    const onWorkspaceAccessRevoked = (change: Readonly<{ workspaceId: string }>): void => {
      if (change.workspaceId !== activeWorkspace.id) return;
      revokeAccess();
      setLoadError("Your access to this workspace was removed.");
    };
    const onTyping = (change: Readonly<{ channelId: string; userId: string; active: boolean }>): void => {
      if (change.channelId !== channelId) return;
      const existingTimeout = typingUsersTimeoutsRef.current.get(change.userId);
      if (existingTimeout) clearTimeout(existingTimeout);
      if (!change.active) {
        typingUsersTimeoutsRef.current.delete(change.userId);
        setTypingUsers((current) => current.filter((userId) => userId !== change.userId));
        return;
      }
      setTypingUsers((current) => current.includes(change.userId) ? current : [...current, change.userId]);
      const timeout = setTimeout(() => {
        typingUsersTimeoutsRef.current.delete(change.userId);
        setTypingUsers((current) => current.filter((userId) => userId !== change.userId));
      }, 2_500);
      typingUsersTimeoutsRef.current.set(change.userId, timeout);
    };
    socket.on("channel:ready", onChannelReady);
    socket.on("channel:message:new", onMessage);
    socket.on("channel:access:revoked", onAccessRevoked);
    socket.on("workspace:access:revoked", onWorkspaceAccessRevoked);
    socket.on("channel:typing", onTyping);
    if (socket.connected && realtime.workspaceReady) subscribe();
    return () => {
      socket.off("channel:ready", onChannelReady);
      socket.off("channel:message:new", onMessage);
      socket.off("channel:access:revoked", onAccessRevoked);
      socket.off("workspace:access:revoked", onWorkspaceAccessRevoked);
      socket.off("channel:typing", onTyping);
      if (socket.connected && realtime.workspaceReady) socket.emit("channel:unsubscribe", channelId);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingUsersTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      typingUsersTimeoutsRef.current.clear();
      setTypingUsers([]);
    };
  }, [activeWorkspace.id, channelId, realtime.socket, realtime.workspaceReady, revokeAccess]);

  useEffect(() => {
    if (shouldScrollToBottom.current) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    shouldScrollToBottom.current = false;
  }, [messages]);

  const loadOlderMessages = async (): Promise<void> => {
    if (!nextCursor || isLoadingOlder) return;
    setIsLoadingOlder(true);
    setOlderError(null);
    shouldScrollToBottom.current = false;
    try {
      const url = new URL(`/channels/${encodeURIComponent(channelId)}/messages`, apiBaseUrl);
      url.searchParams.set("limit", String(MESSAGE_PAGE_SIZE));
      url.searchParams.set("before", nextCursor);
      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        headers: { "X-Workspace-Id": activeWorkspace.id }
      });
      if (!response.ok) {
        if (response.status === 404 || response.status === 403) revokeAccess();
        setOlderError(response.status === 404 || response.status === 403
          ? "You no longer have access to this channel."
          : "Older messages could not be loaded. Please try again.");
        return;
      }
      const parsed = channelMessageListResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setOlderError("The server returned an invalid message page.");
        return;
      }
      setMessages((current) => mergeMessages(parsed.data.messages, current));
      setNextCursor(parsed.data.nextCursor);
    } catch {
      setOlderError("Older messages could not be loaded. Check your connection and try again.");
    } finally {
      setIsLoadingOlder(false);
    }
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const text = draft;
    if (!text.trim() || isSending || !canSend || accessRevoked) return;
    setIsSending(true);
    setSendError(null);
    try {
      const response = await fetch(new URL(`/channels/${encodeURIComponent(channelId)}/messages`, apiBaseUrl), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": activeWorkspace.id },
        body: JSON.stringify({ text })
      });
      if (!response.ok) {
        if (response.status === 404 || response.status === 403) revokeAccess();
        setSendError(response.status === 401
          ? "Your session expired. Sign in again to send a message."
          : response.status === 404 || response.status === 403
            ? "You no longer have access to this channel."
            : response.status === 400
              ? "Messages must contain text and stay within 4,000 characters."
              : "Your message could not be sent. Please try again.");
        return;
      }
      const parsed = channelMessageResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setSendError("The server returned an invalid message response. Your message may have been saved; refresh before retrying.");
        return;
      }
      shouldScrollToBottom.current = true;
      setMessages((current) => mergeMessages(current, [parsed.data]));
      setDraft("");
    } catch {
      setSendError("Your message could not be sent. Check your connection and try again.");
    } finally {
      setIsSending(false);
    }
  };

  const updateTyping = (text: string): void => {
    const socket = realtime.socket;
    if (!socket?.connected) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    const active = text.trim().length > 0;
    if (active !== isTypingRef.current) {
      isTypingRef.current = active;
      socket.emit("channel:typing", { channelId, active });
    }
    if (active) {
      typingTimeoutRef.current = setTimeout(() => {
        if (!isTypingRef.current) return;
        isTypingRef.current = false;
        socket.emit("channel:typing", { channelId, active: false });
      }, 1_500);
    }
  };

  const stopTyping = (): void => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = null;
    if (!isTypingRef.current) return;
    isTypingRef.current = false;
    realtime.socket?.emit("channel:typing", { channelId, active: false });
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <section aria-labelledby="channel-conversation-title" className="flex min-h-[28rem] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/20 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-lg font-semibold text-primary">#</div>
          <div>
            <h2 className="font-semibold text-foreground" id="channel-conversation-title">Conversation</h2>
            <p className="text-xs text-muted-foreground">Messages are visible to current channel members</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground" role="status">
          {realtime.workspaceReady
            ? "Live"
            : realtime.errorMessage ?? (realtime.status === "connected"
              ? "Connecting live chat…"
              : "Reconnecting to live chat…")}
        </p>
        <Button
          aria-label="Refresh messages"
          disabled={isLoading}
          onClick={() => setReloadToken((current) => current + 1)}
          size="sm"
          type="button"
          variant="outline"
        >
          <RefreshCw aria-hidden="true" className="mr-2 size-4" />
          Refresh
        </Button>
      </header>

      <div aria-live="polite" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-6">
        {isLoading ? (
          <p className="m-auto text-sm text-muted-foreground" role="status">Loading your conversation…</p>
        ) : loadError ? (
          <div className="m-auto max-w-sm space-y-3 text-center">
            <p className="text-sm text-destructive" role="alert">{loadError}</p>
            <Button onClick={() => setReloadToken((current) => current + 1)} type="button" variant="outline">Try again</Button>
          </div>
        ) : (
          <>
            {nextCursor ? (
              <div className="mb-4 text-center">
                {olderError ? <p className="mb-2 text-sm text-destructive" role="alert">{olderError}</p> : null}
                <Button disabled={isLoadingOlder} onClick={() => void loadOlderMessages()} size="sm" type="button" variant="ghost">
                  {isLoadingOlder ? "Loading…" : "Load older messages"}
                </Button>
              </div>
            ) : null}
            {messages.length === 0 ? (
              <div className="m-auto max-w-sm py-8 text-center">
                <div aria-hidden="true" className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-xl">✦</div>
                <p className="font-medium text-foreground">A fresh start</p>
                <p className="mt-1 text-sm text-muted-foreground">Send the first message to get the conversation going.</p>
              </div>
            ) : (
              <ol aria-label="Channel messages" className="mt-auto space-y-5">
                {messages.map((message) => (
                  <li className="flex items-start gap-3" key={message.id}>
                    <div aria-hidden="true" className="relative mt-0.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {message.sender.image
                        ? <Image alt="" className="object-cover" height={36} src={message.sender.image} unoptimized width={36} />
                        : getInitials(message.sender.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold text-foreground">{message.sender.name}</span>
                        <time className="text-xs text-muted-foreground" dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">{message.text}</p>
                    </div>
                  </li>
                ))}
                <li aria-hidden="true" className="h-px" ref={bottomRef} />
              </ol>
            )}
          </>
        )}
      </div>
      {typingUsers.length > 0 ? (
        <p className="px-6 pb-2 text-xs text-muted-foreground" role="status">
          {typingUsers.length === 1 ? "Someone is typing…" : "Several people are typing…"}
        </p>
      ) : null}

      <div className="border-t border-border bg-background/70 p-4 sm:px-6">
        {canSend && !accessRevoked ? (
          <form className="space-y-2" onSubmit={(event) => void sendMessage(event)}>
            <label className="sr-only" htmlFor="channel-message-draft">Write a message</label>
            <div className="flex items-end gap-2 rounded-2xl border border-input bg-background p-2 shadow-sm transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
              <Textarea
                className="max-h-36 min-h-12 resize-none border-0 shadow-none focus-visible:ring-0"
                disabled={isSending || isLoading || Boolean(loadError)}
                id="channel-message-draft"
                onChange={(event) => {
                  const value = Array.from(event.currentTarget.value);
                  const nextDraft = value.length <= 4_000 ? event.currentTarget.value : value.slice(0, 4_000).join("");
                  setDraft(nextDraft);
                  updateTyping(nextDraft);
                  setSendError(null);
                }}
                onBlur={stopTyping}
                onKeyDown={handleComposerKeyDown}
                placeholder="Message this channel…"
                rows={1}
                value={draft}
              />
              <Button aria-label="Send message" className="mb-0.5 size-10 shrink-0 rounded-xl" disabled={!draft.trim() || isSending || isLoading || Boolean(loadError)} size="icon" type="submit">
                <Send aria-hidden="true" className="size-4" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              {sendError
                ? <p className="text-xs text-destructive" role="alert">{sendError}</p>
                : <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck aria-hidden="true" className="size-3.5" />Only current channel members can read or send messages.</p>}
              <span className="ml-auto text-xs text-muted-foreground">{Array.from(draft).length}/{4_000} · Enter to send, Shift+Enter for a new line</span>
            </div>
          </form>
        ) : (
          <p className="text-center text-sm text-muted-foreground" role="status">
            {accessRevoked
              ? "You no longer have access to this channel."
              : "This channel is read-only. You can still view its history."}
          </p>
        )}
      </div>
    </section>
  );
};
