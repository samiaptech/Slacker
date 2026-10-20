"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import Link from "next/link";
import { Button, Textarea } from "@workspace/ui";
import { useWorkspaceContext } from "@/features/workspace-foundation/public";
import { useChannelRealtime } from "@/features/channels/public";
import {
  directConversationResponseSchema,
  directMessageListResponseSchema,
  directMessageResponseSchema,
  type DirectMessageView
} from "../types";

const PAGE_SIZE = 50;
const DIRECT_MESSAGE_MAX_LENGTH = 4_000;

const mergeMessages = (
  current: readonly DirectMessageView[],
  incoming: readonly DirectMessageView[]
): readonly DirectMessageView[] => {
  const byId = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => byId.set(message.id, message));
  return [...byId.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  );
};

type DirectMessagePageProps = Readonly<{ apiBaseUrl: string; conversationId: string }>;

export const DirectMessagePage = ({ apiBaseUrl, conversationId }: DirectMessagePageProps): ReactElement => {
  const { activeWorkspace, currentUser } = useWorkspaceContext();
  const realtime = useChannelRealtime();
  const [conversation, setConversation] = useState<ReturnType<typeof directConversationResponseSchema.parse>["conversation"] | null>(null);
  const [messages, setMessages] = useState<readonly DirectMessageView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [typing, setTyping] = useState(false);
  const alreadyReadyRef = useRef(false);
  const bottomRef = useRef<HTMLLIElement>(null);
  const shouldScrollRef = useRef(true);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingIndicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const loadMessages = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const url = new URL(`/direct-messages/${encodeURIComponent(conversationId)}/messages`, apiBaseUrl);
    url.searchParams.set("limit", String(PAGE_SIZE));
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      headers: { "X-Workspace-Id": activeWorkspace.id },
      ...(signal ? { signal } : {})
    });
    if (!response.ok) throw new Error(response.status === 503
      ? "Direct-message storage is not initialized. Ask an administrator to run the direct-message setup."
      : "This direct conversation is unavailable or you no longer have access.");
    const parsed = directMessageListResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("The server returned invalid direct-message history.");
    setMessages(parsed.data.messages);
    setNextCursor(parsed.data.nextCursor);
    shouldScrollRef.current = true;
  }, [activeWorkspace.id, apiBaseUrl, conversationId]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const response = await fetch(new URL(`/direct-messages/${encodeURIComponent(conversationId)}`, apiBaseUrl), {
          credentials: "include",
          cache: "no-store",
          headers: { "X-Workspace-Id": activeWorkspace.id },
          signal: controller.signal
        });
        if (!response.ok) throw new Error(response.status === 503
          ? "Direct-message storage is not initialized. Ask an administrator to run the direct-message setup."
          : "This direct conversation is unavailable or you do not have access.");
        const parsed = directConversationResponseSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("The server returned invalid direct-conversation details.");
        setConversation(parsed.data.conversation);
        await loadMessages(controller.signal);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setErrorMessage(error instanceof Error ? error.message : "The conversation could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [activeWorkspace.id, apiBaseUrl, conversationId, loadMessages, reloadToken]);

  useEffect(() => {
    alreadyReadyRef.current = false;
  }, [activeWorkspace.id, conversationId]);

  useEffect(() => {
    const socket = realtime.socket;
    if (!socket) return;
    const subscribe = (): void => {
      socket.emit("direct-message:subscribe", conversationId);
    };
    const onReady = (payload: Readonly<{ conversationId: string }>): void => {
      if (payload.conversationId !== conversationId) return;
      if (alreadyReadyRef.current) setReloadToken((current) => current + 1);
      else alreadyReadyRef.current = true;
    };
    const onMessage = (message: DirectMessageView): void => {
      if (message.conversationId !== conversationId) return;
      shouldScrollRef.current = true;
      setMessages((current) => mergeMessages(current, [message]));
    };
    const onTyping = (payload: Readonly<{ conversationId: string; userId: string; active: boolean }>): void => {
      if (payload.conversationId !== conversationId || payload.userId === currentUser.id) return;
      if (typingIndicatorTimeoutRef.current) clearTimeout(typingIndicatorTimeoutRef.current);
      setTyping(payload.active);
      if (payload.active) {
        typingIndicatorTimeoutRef.current = setTimeout(() => setTyping(false), 2_500);
      }
    };
    const onWorkspaceAccessRevoked = (payload: Readonly<{ workspaceId: string }>): void => {
      if (payload.workspaceId !== activeWorkspace.id) return;
      setConversation(null);
      setMessages([]);
      setNextCursor(null);
      setDraft("");
      setErrorMessage("Your access to this workspace was removed.");
    };
    socket.on("direct-message:ready", onReady);
    socket.on("direct-message:new", onMessage);
    socket.on("direct-message:typing", onTyping);
    socket.on("workspace:access:revoked", onWorkspaceAccessRevoked);
    if (socket.connected && realtime.workspaceReady) subscribe();
    return () => {
      socket.off("direct-message:ready", onReady);
      socket.off("direct-message:new", onMessage);
      socket.off("direct-message:typing", onTyping);
      socket.off("workspace:access:revoked", onWorkspaceAccessRevoked);
      if (socket.connected && realtime.workspaceReady) socket.emit("direct-message:unsubscribe", conversationId);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (typingIndicatorTimeoutRef.current) clearTimeout(typingIndicatorTimeoutRef.current);
      typingTimeoutRef.current = null;
      typingIndicatorTimeoutRef.current = null;
    };
  }, [activeWorkspace.id, conversationId, currentUser.id, realtime.socket, realtime.workspaceReady]);

  useEffect(() => {
    if (shouldScrollRef.current) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    shouldScrollRef.current = false;
  }, [messages]);

  const onDraftChange = (value: string): void => {
    setDraft(value);
    const active = value.trim().length > 0;
    if (active === isTypingRef.current) return;
    isTypingRef.current = active;
    realtime.socket?.emit("direct-message:typing", { conversationId, active });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (active) {
      typingTimeoutRef.current = setTimeout(() => {
        isTypingRef.current = false;
        realtime.socket?.emit("direct-message:typing", { conversationId, active: false });
      }, 1_500);
    }
  };

  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!draft.trim() || isSending) return;
    setIsSending(true);
    setSendError(null);
    try {
      const response = await fetch(new URL(`/direct-messages/${encodeURIComponent(conversationId)}/messages`, apiBaseUrl), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": activeWorkspace.id },
        body: JSON.stringify({ text: draft })
      });
      if (!response.ok) throw new Error(response.status === 503
        ? "Direct-message storage is unavailable. Please try again later."
        : "Your message could not be sent. Check your access and try again.");
      const parsed = directMessageResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("The server returned an invalid sent-message response.");
      setMessages((current) => mergeMessages(current, [parsed.data]));
      setDraft("");
      if (isTypingRef.current) {
        isTypingRef.current = false;
        realtime.socket?.emit("direct-message:typing", { conversationId, active: false });
      }
      shouldScrollRef.current = true;
    } catch (error: unknown) {
      setSendError(error instanceof Error ? error.message : "Your message could not be sent.");
    } finally {
      setIsSending(false);
    }
  };

  const loadOlder = async (): Promise<void> => {
    if (!nextCursor || isLoadingOlder) return;
    setIsLoadingOlder(true);
    setOlderError(null);
    try {
      const url = new URL(`/direct-messages/${encodeURIComponent(conversationId)}/messages`, apiBaseUrl);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("before", nextCursor);
      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        headers: { "X-Workspace-Id": activeWorkspace.id }
      });
      if (!response.ok) throw new Error("Older messages could not be loaded.");
      const parsed = directMessageListResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("The server returned an invalid message page.");
      shouldScrollRef.current = false;
      setMessages((current) => mergeMessages(parsed.data.messages, current));
      setNextCursor(parsed.data.nextCursor);
    } catch (error: unknown) {
      setOlderError(error instanceof Error ? error.message : "Older messages could not be loaded.");
    } finally {
      setIsLoadingOlder(false);
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div><Button asChild variant="outline"><Link href="/">Back to workspace</Link></Button></div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">Opening direct message…</p>
      ) : errorMessage ? (
        <section className="rounded-xl border border-border bg-card p-8">
          <h1 className="text-xl font-semibold text-foreground">Direct message unavailable</h1>
          <p className="mt-2 text-sm text-destructive" role="alert">{errorMessage}</p>
          <Button className="mt-4" onClick={() => setReloadToken((current) => current + 1)} type="button" variant="outline">
            Retry
          </Button>
        </section>
      ) : conversation ? (
        <>
          <section className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">Direct message</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {conversation.otherParticipant.name}
            </h1>
          </section>
          <section aria-label={`Conversation with ${conversation.otherParticipant.name}`} className="flex min-h-64 min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex-1 overflow-y-auto p-4">
              {nextCursor ? (
                <div className="mb-3 text-center">
                  <Button disabled={isLoadingOlder} onClick={() => void loadOlder()} type="button" variant="ghost">
                    {isLoadingOlder ? "Loading…" : "Load older messages"}
                  </Button>
                  {olderError ? <p className="text-sm text-destructive" role="alert">{olderError}</p> : null}
                </div>
              ) : null}
              {messages.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">Start your private conversation.</p>
              ) : (
                <ol aria-live="polite" className="space-y-4">
                  {messages.map((message) => (
                    <li className="flex gap-3" key={message.id}>
                      <span aria-hidden="true" className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {message.sender.name.trim().slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-sm font-semibold text-foreground">{message.sender.name}</span>
                          <time className="text-xs text-muted-foreground" dateTime={message.createdAt}>
                            {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(message.createdAt))}
                          </time>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{message.text}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {typing ? <p className="mt-3 text-xs text-muted-foreground" role="status">{conversation.otherParticipant.name} is typing…</p> : null}
              <ol aria-hidden="true"><li ref={bottomRef} /></ol>
            </div>
            <form className="border-t border-border p-3" onSubmit={(event) => void send(event)}>
              {sendError ? <p className="mb-2 text-sm text-destructive" role="alert">{sendError}</p> : null}
              {realtime.status !== "connected" ? (
                <p className="mb-2 text-xs text-muted-foreground" role="status">Live updates disconnected. Messages still send over the secure API.</p>
              ) : null}
              <div className="flex items-end gap-2">
                <Textarea
                  aria-label="Write a direct message"
                  maxLength={DIRECT_MESSAGE_MAX_LENGTH}
                  onChange={(event) => onDraftChange(event.currentTarget.value)}
                  onKeyDown={onComposerKeyDown}
                  placeholder={`Message ${conversation.otherParticipant.name}`}
                  rows={2}
                  value={draft}
                />
                <Button disabled={isSending || !draft.trim()} type="submit">{isSending ? "Sending…" : "Send"}</Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Enter to send · Shift+Enter for a new line</p>
            </form>
          </section>
        </>
      ) : null}
    </div>
  );
};
