"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import { FileText, Paperclip, Send, X } from "lucide-react";
import type { MessageReactionEmoji, MessageReactionResponse, MessageReactionToggleResponse } from "@workspace/types";
import { Button, Textarea } from "@workspace/ui";
import { useWorkspaceContext } from "@/features/workspace-foundation/public";
import { useChannelRealtime } from "@/features/channels/public";
import {
  directConversationResponseSchema,
  directMessageListResponseSchema,
  directMessageResponseSchema,
  type DirectMessageView
} from "../types";
import { DirectMessageItem } from "./direct-message-item";
import { DirectMessageLoading } from "./direct-message-loading";
import {
  captureHistoryScrollAnchor,
  getMessageDeleteFailure,
  restoreHistoryScrollAnchor,
  findMatchingPendingMessageId,
  removePendingMessage,
  updatePendingMessage,
  type HistoryScrollAnchor,
  type MessageAttachment,
  type MessageDeleteScope,
  type MessageWithDelivery,
  optimisticallyToggleMessageReaction,
  requestMessageReaction
} from "@/features/conversation-history/public";
import { useMessageSearchJump } from "@/features/message-search/public";

const PAGE_SIZE = 50;
const DIRECT_MESSAGE_MAX_LENGTH = 4_000;
const MAX_ATTACHMENT_COUNT = 5;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const ATTACHMENT_ACCEPT = ".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.csv,.md";
type DirectTimelineMessage = MessageWithDelivery<DirectMessageView>;

const formatFileSize = (size: number): string => size < 1024 * 1024
  ? `${Math.max(1, Math.round(size / 1024))} KB`
  : `${(size / (1024 * 1024)).toFixed(1)} MB`;

const mergeMessages = (
  current: readonly DirectTimelineMessage[],
  incoming: readonly DirectTimelineMessage[]
): readonly DirectTimelineMessage[] => {
  const byId = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => byId.set(message.id, message));
  return [...byId.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  );
};

const mergeIncomingMessages = (
  current: readonly DirectTimelineMessage[],
  incoming: readonly DirectMessageView[]
): readonly DirectTimelineMessage[] => incoming.reduce((messages, message) => {
  const pendingId = findMatchingPendingMessageId(messages, message);
  return mergeMessages(pendingId ? removePendingMessage(messages, pendingId) : messages, [message]);
}, current);

type DirectMessagePageProps = Readonly<{ apiBaseUrl: string; conversationId: string }>;

export const DirectMessagePage = ({ apiBaseUrl, conversationId }: DirectMessagePageProps): ReactElement => {
  const { activeWorkspace, currentUser } = useWorkspaceContext();
  const realtime = useChannelRealtime();
  const [conversation, setConversation] = useState<ReturnType<typeof directConversationResponseSchema.parse>["conversation"] | null>(null);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly DirectTimelineMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<readonly File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentActionError, setAttachmentActionError] = useState<string | null>(null);
  const [messageActionError, setMessageActionError] = useState<string | null>(null);
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<string | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [pendingReactionMessageIds, setPendingReactionMessageIds] = useState<ReadonlySet<string>>(new Set());
  const reactionRequestsRef = useRef(new Set<string>());
  const realtimeReactionUpdatesRef = useRef(new Map<string, readonly MessageReactionResponse[]>());
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [olderError, setOlderError] = useState<string | null>(null);
  const messageTimeline = useMemo(() => messages.map((message, index) => {
    const previousMessage = messages[index - 1];
    return {
      message,
      startsNewDay: !previousMessage || new Date(previousMessage.createdAt).toDateString() !== new Date(message.createdAt).toDateString()
    };
  }), [messages]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [typing, setTyping] = useState(false);
  const alreadyReadyRef = useRef(false);
  const bottomRef = useRef<HTMLLIElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const historyAnchorRef = useRef<HistoryScrollAnchor | null>(null);
  const shouldScrollRef = useRef(true);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingIndicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      historyAnchorRef.current = null;
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const requestOptions: RequestInit = {
          credentials: "include",
          cache: "no-store",
          headers: { "X-Workspace-Id": activeWorkspace.id },
          signal: controller.signal
        };
        const conversationUrl = new URL(`/direct-messages/${encodeURIComponent(conversationId)}`, apiBaseUrl);
        const messagesUrl = new URL(`/direct-messages/${encodeURIComponent(conversationId)}/messages`, apiBaseUrl);
        messagesUrl.searchParams.set("limit", String(PAGE_SIZE));
        const [conversationResponse, messagesResponse] = await Promise.all([
          fetch(conversationUrl, requestOptions),
          fetch(messagesUrl, requestOptions)
        ]);
        const failedResponse = !conversationResponse.ok
          ? conversationResponse
          : !messagesResponse.ok ? messagesResponse : null;
        if (failedResponse) throw new Error(failedResponse.status === 503
          ? "Direct-message storage is not initialized. Ask an administrator to run the direct-message setup."
          : "This direct conversation is unavailable or you do not have access.");
        const [conversationBody, messagesBody] = await Promise.all([
          conversationResponse.json(),
          messagesResponse.json()
        ]);
        const parsedConversation = directConversationResponseSchema.safeParse(conversationBody);
        if (!parsedConversation.success) throw new Error("The server returned invalid direct-conversation details.");
        const parsedMessages = directMessageListResponseSchema.safeParse(messagesBody);
        if (!parsedMessages.success) throw new Error("The server returned invalid direct-message history.");
        setConversation(parsedConversation.data.conversation);
        setMessages((current) => mergeIncomingMessages(
          current.filter((message) => message.deliveryState && message.conversationId === conversationId),
          parsedMessages.data.messages
        ));
        setNextCursor(parsedMessages.data.nextCursor);
        setLoadedConversationId(conversationId);
        shouldScrollRef.current = true;
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setErrorMessage(error instanceof Error ? error.message : "The conversation could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [activeWorkspace.id, apiBaseUrl, conversationId, reloadToken]);

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
      setMessages((current) => mergeIncomingMessages(current, [message]));
    };
    const onMessageDeleted = (change: Readonly<{ conversationId: string; messageId: string }>): void => {
      if (change.conversationId !== conversationId) return;
      setMessages((current) => current.filter((message) => message.id !== change.messageId));
    };
    const onMessageReactions = (change: Readonly<{ conversationId: string } & MessageReactionToggleResponse>): void => {
      if (change.conversationId !== conversationId) return;
      if (reactionRequestsRef.current.has(change.messageId)) {
        realtimeReactionUpdatesRef.current.set(change.messageId, change.reactions);
      }
      setMessages((current) => current.map((message) =>
        message.id === change.messageId ? { ...message, reactions: change.reactions } : message
      ));
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
      historyAnchorRef.current = null;
      setConversation(null);
      setMessages([]);
      setNextCursor(null);
      setDraft("");
      setSelectedFiles([]);
      setErrorMessage("Your access to this workspace was removed.");
    };
    socket.on("direct-message:ready", onReady);
    socket.on("direct-message:new", onMessage);
    socket.on("direct-message:deleted", onMessageDeleted);
    socket.on("direct-message:reactions", onMessageReactions);
    socket.on("direct-message:typing", onTyping);
    socket.on("workspace:access:revoked", onWorkspaceAccessRevoked);
    if (socket.connected && realtime.workspaceReady) subscribe();
    return () => {
      socket.off("direct-message:ready", onReady);
      socket.off("direct-message:new", onMessage);
      socket.off("direct-message:deleted", onMessageDeleted);
      socket.off("direct-message:reactions", onMessageReactions);
      socket.off("direct-message:typing", onTyping);
      socket.off("workspace:access:revoked", onWorkspaceAccessRevoked);
      if (socket.connected && realtime.workspaceReady) socket.emit("direct-message:unsubscribe", conversationId);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (typingIndicatorTimeoutRef.current) clearTimeout(typingIndicatorTimeoutRef.current);
      typingTimeoutRef.current = null;
      typingIndicatorTimeoutRef.current = null;
    };
  }, [activeWorkspace.id, conversationId, currentUser.id, realtime.socket, realtime.workspaceReady]);

  useLayoutEffect(() => {
    const anchor = historyAnchorRef.current;
    const container = scrollContainerRef.current;
    if (anchor && container) {
      restoreHistoryScrollAnchor(container, anchor);
      historyAnchorRef.current = null;
      shouldScrollRef.current = false;
      return;
    }
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

  const submitMessage = async (pending: DirectTimelineMessage): Promise<void> => {
    setIsSending(true);
    setSendError(null);
    setMessages((current) => updatePendingMessage(current, pending.id, "sending"));
    try {
      const headers: Record<string, string> = { "X-Workspace-Id": activeWorkspace.id };
      let body: BodyInit;
      const files = pending.pendingFiles ?? [];
      if (files.length > 0) {
        const formData = new FormData();
        if (pending.text.trim()) formData.set("text", pending.text);
        files.forEach((file) => formData.append("files", file));
        body = formData;
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify({ text: pending.text });
      }
      const response = await fetch(new URL(`/direct-messages/${encodeURIComponent(conversationId)}/messages`, apiBaseUrl), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers,
        body
      });
      if (!response.ok) throw new Error(response.status === 503
        ? "Direct-message storage is unavailable. Please try again later."
        : "Your message could not be sent. Check your access and try again.");
      const parsed = directMessageResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("The server returned an invalid sent-message response.");
      setMessages((current) => mergeIncomingMessages(removePendingMessage(current, pending.id), [parsed.data]));
      setAttachmentError(null);
      shouldScrollRef.current = true;
    } catch (error: unknown) {
      setSendError(error instanceof Error ? error.message : "Your message could not be sent.");
      setMessages((current) => updatePendingMessage(current, pending.id, "failed"));
    } finally {
      setIsSending(false);
    }
  };

  const send = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = draft;
    const files = selectedFiles;
    if ((!text.trim() && files.length === 0) || isSending) return;
    const pending: DirectTimelineMessage = {
      id: `pending-${crypto.randomUUID()}`,
      conversationId,
      senderId: currentUser.id,
      text,
      createdAt: new Date().toISOString(),
      attachments: [],
      reactions: [],
      sender: { id: currentUser.id, name: currentUser.name, image: currentUser.image },
      deliveryState: "sending",
      pendingFiles: files
    };
    shouldScrollRef.current = true;
    setMessages((current) => mergeMessages(current, [pending]));
    setDraft("");
    setSelectedFiles([]);
    setSendError(null);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      realtime.socket?.emit("direct-message:typing", { conversationId, active: false });
    }
    void submitMessage(pending);
  };

  const retryMessage = (messageId: string): void => {
    const pending = messages.find((message) => message.id === messageId && message.deliveryState === "failed");
    if (pending && !isSending) void submitMessage(pending);
  };

  const addAttachments = (event: ChangeEvent<HTMLInputElement>): void => {
    const incoming = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (incoming.length === 0) return;
    if (selectedFiles.length + incoming.length > MAX_ATTACHMENT_COUNT) {
      setAttachmentError(`Choose up to ${MAX_ATTACHMENT_COUNT} files per message.`);
      return;
    }
    const invalidFile = incoming.find((file) => file.size > MAX_ATTACHMENT_SIZE || !ATTACHMENT_ACCEPT.split(",").some((extension) => file.name.toLocaleLowerCase().endsWith(extension)));
    if (invalidFile) {
      setAttachmentError(invalidFile.size > MAX_ATTACHMENT_SIZE
        ? `${invalidFile.name} is larger than 10 MB.`
        : `${invalidFile.name} is not a supported file type.`);
      return;
    }
    setAttachmentError(null);
    setSelectedFiles((current) => [...current, ...incoming]);
  };

  const downloadAttachment = useCallback(async (attachment: NonNullable<DirectMessageView["attachments"]>[number]): Promise<void> => {
    if (downloadingAttachmentId) return;
    setDownloadingAttachmentId(attachment.id);
    setAttachmentActionError(null);
    try {
      const downloadUrl = new URL(attachment.downloadUrl, apiBaseUrl);
      if (downloadUrl.origin !== new URL(apiBaseUrl).origin) throw new Error("This file has an invalid download location.");
      const response = await fetch(downloadUrl, {
        credentials: "include",
        cache: "no-store",
        headers: { "X-Workspace-Id": activeWorkspace.id }
      });
      if (!response.ok) throw new Error("This file is unavailable or you no longer have access to it.");
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = attachment.name;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (error: unknown) {
      setAttachmentActionError(error instanceof Error ? error.message : "The file could not be downloaded.");
    } finally {
      setDownloadingAttachmentId(null);
    }
  }, [activeWorkspace.id, apiBaseUrl, downloadingAttachmentId]);

  const loadImagePreview = useCallback(async (attachment: MessageAttachment, signal: AbortSignal): Promise<string> => {
    const previewUrl = new URL(attachment.downloadUrl, apiBaseUrl);
    if (previewUrl.origin !== new URL(apiBaseUrl).origin) throw new Error("This image has an invalid location.");
    const response = await fetch(previewUrl, {
      credentials: "include",
      cache: "no-store",
      headers: { "X-Workspace-Id": activeWorkspace.id },
      signal
    });
    if (!response.ok) throw new Error("This image is unavailable or you no longer have access to it.");
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("This attachment is not a supported image.");
    return URL.createObjectURL(blob);
  }, [activeWorkspace.id, apiBaseUrl]);

  const toggleReaction = async (messageId: string, emoji: MessageReactionEmoji): Promise<void> => {
    if (reactionRequestsRef.current.has(messageId)) return;
    const message = messages.find((entry) => entry.id === messageId);
    if (!message) return;
    const previousReactions = message.reactions;
    reactionRequestsRef.current.add(messageId);
    realtimeReactionUpdatesRef.current.delete(messageId);
    setPendingReactionMessageIds((current) => new Set(current).add(messageId));
    setMessageActionError(null);
    setMessages((current) => current.map((entry) =>
      entry.id === messageId
        ? {
          ...entry,
          reactions: optimisticallyToggleMessageReaction(entry.reactions, emoji, {
            id: currentUser.id,
            name: currentUser.name || currentUser.email,
            image: currentUser.image
          })
        }
        : entry
    ));
    try {
      const result = await requestMessageReaction({
        apiBaseUrl,
        workspaceId: activeWorkspace.id,
        target: { type: "direct-message", id: conversationId },
        messageId,
        emoji
      });
      setMessages((current) => current.map((message) =>
        message.id === result.messageId ? { ...message, reactions: result.reactions } : message
      ));
    } catch (error: unknown) {
      const latestServerReactions = realtimeReactionUpdatesRef.current.get(messageId) ?? previousReactions;
      setMessages((current) => current.map((entry) =>
        entry.id === messageId ? { ...entry, reactions: latestServerReactions } : entry
      ));
      setMessageActionError(error instanceof Error ? error.message : "The reaction could not be updated.");
    } finally {
      reactionRequestsRef.current.delete(messageId);
      realtimeReactionUpdatesRef.current.delete(messageId);
      setPendingReactionMessageIds((current) => {
        const next = new Set(current);
        next.delete(messageId);
        return next;
      });
    }
  };

  const deleteMessage = async (messageId: string, scope: MessageDeleteScope): Promise<void> => {
    if (deletingMessageId) return;
    setDeletingMessageId(messageId);
    setMessageActionError(null);
    try {
      const response = await fetch(new URL(
        `/direct-messages/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
        apiBaseUrl
      ), {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": activeWorkspace.id
        },
        body: JSON.stringify({ scope })
      });
      if (!response.ok) {
        const failure = await getMessageDeleteFailure(response);
        if (failure.deletionCommitted) {
          setMessages((current) => current.filter((message) => message.id !== messageId));
        }
        setMessageActionError(failure.message);
        return;
      }
      setMessages((current) => current.filter((message) => message.id !== messageId));
    } catch (error: unknown) {
      setMessageActionError(error instanceof Error ? error.message : "The message could not be deleted.");
    } finally {
      setDeletingMessageId(null);
    }
  };

  const loadOlder = useCallback(async (): Promise<void> => {
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
      const container = scrollContainerRef.current;
      historyAnchorRef.current = container ? captureHistoryScrollAnchor(container) : null;
      shouldScrollRef.current = false;
      setMessages((current) => mergeMessages(parsed.data.messages, current));
      setNextCursor(parsed.data.nextCursor);
    } catch (error: unknown) {
      setOlderError(error instanceof Error ? error.message : "Older messages could not be loaded.");
    } finally {
      setIsLoadingOlder(false);
    }
  }, [activeWorkspace.id, apiBaseUrl, conversationId, isLoadingOlder, nextCursor]);

  const searchJump = useMessageSearchJump({
    type: "direct",
    conversationId,
    messages,
    containerRef: scrollContainerRef,
    isLoading: isLoading || loadedConversationId !== conversationId,
    isLoadingOlder,
    hasMore: nextCursor !== null,
    olderError,
    loadOlder
  });

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {isLoading ? (
        <DirectMessageLoading />
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
          <p aria-live="polite" className="sr-only" role="status">{searchJump.announcement}</p>
          <section aria-label={`Conversation with ${conversation.otherParticipant.name}`} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#fbfaf8]">
            <header className="flex shrink-0 items-center justify-end gap-3 border-b border-[#e9e7e1] px-6 py-2 sm:px-8">
              <p className="flex items-center gap-2 text-xs text-[#74817b]" role="status">
                <span aria-hidden="true" className={`size-2 rounded-full ${realtime.status === "connected" ? "bg-emerald-500" : "bg-amber-400"}`} />
                {realtime.status === "connected" ? "Live updates" : "Reconnecting to live chat…"}
              </p>
            </header>
            {messageActionError ? <p className="shrink-0 px-6 pt-2 text-sm text-destructive" role="alert">{messageActionError}</p> : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-2 sm:px-8" ref={scrollContainerRef}>
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
                <ol aria-live="polite" className="space-y-3">
                  {messageTimeline.map(({ message, startsNewDay }) => (
                    <DirectMessageItem
                      key={message.id}
                      deliveryState={message.deliveryState}
                      pendingFiles={message.pendingFiles}
                      retryDisabled={isSending}
                      onRetry={() => retryMessage(message.id)}
                      downloadingAttachmentId={downloadingAttachmentId}
                      isDownloadBusy={downloadingAttachmentId !== null}
                      canDeleteForEveryone={message.senderId === currentUser.id || activeWorkspace.role === "admin"}
                      isDeleting={deletingMessageId !== null}
                      isReactionPending={pendingReactionMessageIds.has(message.id)}
                      currentUserId={currentUser.id}
                      currentUserName={currentUser.name || currentUser.email}
                      message={message}
                      onDownloadAttachment={downloadAttachment}
                      loadImagePreview={loadImagePreview}
                      onDelete={(scope) => { void deleteMessage(message.id, scope); }}
                      onToggleReaction={(emoji) => { void toggleReaction(message.id, emoji); }}
                      startsNewDay={startsNewDay}
                    />
                  ))}
                  <li aria-hidden="true" className="h-px" ref={bottomRef} />
                </ol>
              )}
              {typing ? <p className="mt-3 text-xs text-muted-foreground" role="status">{conversation.otherParticipant.name} is typing…</p> : null}
            </div>
            <form className="shrink-0 space-y-2 border-t border-[#e9e7e1] bg-white/75 px-6 py-4 sm:px-8" onSubmit={(event) => void send(event)}>
              {sendError ? <p className="mb-2 text-sm text-destructive" role="alert">{sendError}</p> : null}
              {attachmentActionError ? <p className="mb-2 text-sm text-destructive" role="alert">{attachmentActionError}</p> : null}
              {realtime.status !== "connected" ? (
                <p className="mb-2 text-xs text-muted-foreground" role="status">Live updates disconnected. Messages still send over the secure API.</p>
              ) : null}
              <label className="sr-only" htmlFor="direct-message-draft">Write a direct message</label>
              <input accept={ATTACHMENT_ACCEPT} className="hidden" multiple onChange={addAttachments} ref={attachmentInputRef} type="file" />
              {selectedFiles.length > 0 ? (
                <ul aria-label="Files to attach" className="flex flex-wrap gap-2 px-1">
                  {selectedFiles.map((file, index) => (
                    <li className="flex max-w-full items-center gap-2 rounded-lg border border-border bg-background px-2 py-1 text-xs" key={`${file.name}-${file.lastModified}-${index}`}>
                      <FileText aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
                      <span className="max-w-48 truncate">{file.name}</span><span className="text-muted-foreground">{formatFileSize(file.size)}</span>
                      <Button aria-label={`Remove ${file.name}`} className="size-6 shrink-0" onClick={() => setSelectedFiles((current) => current.filter((_, currentIndex) => currentIndex !== index))} size="icon" type="button" variant="ghost"><X aria-hidden="true" className="size-3" /></Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex items-end gap-2 rounded-2xl border border-input bg-background p-2 shadow-sm transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
                <Button aria-label="Attach files, up to 5 files and 10 MB each" className="mb-0.5 size-10 shrink-0 rounded-xl" disabled={isSending} onClick={() => attachmentInputRef.current?.click()} size="icon" title="Up to 5 files · 10 MB each" type="button" variant="ghost">
                  <Paperclip aria-hidden="true" className="size-4" />
                </Button>
                <Textarea
                  aria-label="Write a direct message"
                  className="max-h-36 min-h-12 resize-none border-0 shadow-none focus-visible:ring-0"
                  id="direct-message-draft"
                  maxLength={DIRECT_MESSAGE_MAX_LENGTH}
                  onChange={(event) => onDraftChange(Array.from(event.currentTarget.value).slice(0, DIRECT_MESSAGE_MAX_LENGTH).join(""))}
                  onKeyDown={onComposerKeyDown}
                  placeholder={`Message ${conversation.otherParticipant.name}…`}
                  rows={1}
                  value={draft}
                />
                <Button aria-label={isSending ? "Sending message" : "Send direct message"} className="mb-0.5 size-10 shrink-0 rounded-xl" disabled={isSending || (!draft.trim() && selectedFiles.length === 0)} size="icon" type="submit">
                  <Send aria-hidden="true" className="size-4" />
                </Button>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
                {attachmentError
                  ? <p className="min-w-0 truncate text-destructive" role="alert">{attachmentError}</p>
                  : <p className="min-w-0 truncate">Enter sends · Shift+Enter for a new line</p>}
                {draft.length > 0 ? <span className="shrink-0">{Array.from(draft).length}/{DIRECT_MESSAGE_MAX_LENGTH}</span> : null}
              </div>
            </form>
          </section>
        </>
      ) : null}
    </div>
  );
};
