"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import { FileText, Paperclip, Pin, RefreshCw, Send, ShieldCheck, X } from "lucide-react";
import { Button, Textarea } from "@workspace/ui";
import {
  channelMessageListResponseSchema,
  channelMessageResponseSchema,
  type ChannelMessageView
} from "../types";
import { useWorkspaceContext } from "@/features/workspace-foundation/public";
import { useChannelRealtime } from "./channel-realtime-provider";
import { ChannelMessageItem } from "./channel-message-item";
import {
  captureHistoryScrollAnchor,
  restoreHistoryScrollAnchor,
  type HistoryScrollAnchor
} from "@/features/conversation-history/public";
import { useMessageSearchJump } from "@/features/message-search/public";

const MESSAGE_PAGE_SIZE = 50;
const MAX_ATTACHMENT_COUNT = 5;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const ATTACHMENT_ACCEPT = ".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.csv,.md";

type ChannelMessagesProps = Readonly<{
  apiBaseUrl: string;
  channelId: string;
  channelName: string;
  channelDescription: string | null;
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

const formatFileSize = (size: number): string => size < 1024 * 1024
  ? `${Math.max(1, Math.round(size / 1024))} KB`
  : `${(size / (1024 * 1024)).toFixed(1)} MB`;

export const ChannelMessages = ({ apiBaseUrl, channelId, channelName, channelDescription, canSend }: ChannelMessagesProps): ReactElement => {
  const { activeWorkspace } = useWorkspaceContext();
  const realtime = useChannelRealtime();
  const [messages, setMessages] = useState<readonly ChannelMessageView[]>([]);
  const [loadedChannelId, setLoadedChannelId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<readonly File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentActionError, setAttachmentActionError] = useState<string | null>(null);
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const historyAnchorRef = useRef<HistoryScrollAnchor | null>(null);
  const messageTimeline = useMemo(() => messages.map((message, index) => {
    const previousMessage = messages[index - 1];
    return {
      message,
      startsNewDay: !previousMessage || new Date(previousMessage.createdAt).toDateString() !== new Date(message.createdAt).toDateString()
    };
  }), [messages]);
  const bottomRef = useRef<HTMLLIElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingUsersTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const isTypingRef = useRef(false);
  const shouldScrollToBottom = useRef(true);
  const revokeAccess = useCallback((): void => {
    historyAnchorRef.current = null;
    if (isTypingRef.current) {
      realtime.socket?.emit("channel:typing", { channelId, active: false });
      isTypingRef.current = false;
    }
    setAccessRevoked(true);
    setMessages([]);
    setNextCursor(null);
    setDraft("");
    setSelectedFiles([]);
  }, [channelId, realtime.socket]);

  useEffect(() => {
    const controller = new AbortController();
    const loadMessages = async (): Promise<void> => {
      historyAnchorRef.current = null;
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
        setLoadedChannelId(channelId);
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
    const typingUserTimeouts = typingUsersTimeoutsRef.current;
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
      const existingTimeout = typingUserTimeouts.get(change.userId);
      if (existingTimeout) clearTimeout(existingTimeout);
      if (!change.active) {
        typingUserTimeouts.delete(change.userId);
        setTypingUsers((current) => current.filter((userId) => userId !== change.userId));
        return;
      }
      setTypingUsers((current) => current.includes(change.userId) ? current : [...current, change.userId]);
      const timeout = setTimeout(() => {
        typingUserTimeouts.delete(change.userId);
        setTypingUsers((current) => current.filter((userId) => userId !== change.userId));
      }, 2_500);
      typingUserTimeouts.set(change.userId, timeout);
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
      typingUserTimeouts.forEach((timeout) => clearTimeout(timeout));
      typingUserTimeouts.clear();
      setTypingUsers([]);
    };
  }, [activeWorkspace.id, channelId, realtime.socket, realtime.workspaceReady, revokeAccess]);

  useLayoutEffect(() => {
    const anchor = historyAnchorRef.current;
    const container = scrollContainerRef.current;
    if (anchor && container) {
      restoreHistoryScrollAnchor(container, anchor);
      historyAnchorRef.current = null;
      shouldScrollToBottom.current = false;
      return;
    }
    if (shouldScrollToBottom.current) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    shouldScrollToBottom.current = false;
  }, [messages]);

  const loadOlderMessages = useCallback(async (): Promise<void> => {
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
      const container = scrollContainerRef.current;
      historyAnchorRef.current = container ? captureHistoryScrollAnchor(container) : null;
      setMessages((current) => mergeMessages(parsed.data.messages, current));
      setNextCursor(parsed.data.nextCursor);
    } catch {
      setOlderError("Older messages could not be loaded. Check your connection and try again.");
    } finally {
      setIsLoadingOlder(false);
    }
  }, [activeWorkspace.id, apiBaseUrl, channelId, isLoadingOlder, nextCursor, revokeAccess]);

  const sendMessage = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const text = draft;
    if ((!text.trim() && selectedFiles.length === 0) || isSending || !canSend || accessRevoked) return;
    setIsSending(true);
    setSendError(null);
    try {
      const headers: Record<string, string> = { "X-Workspace-Id": activeWorkspace.id };
      let body: BodyInit;
      if (selectedFiles.length > 0) {
        const formData = new FormData();
        if (text.trim()) formData.set("text", text);
        selectedFiles.forEach((file) => formData.append("files", file));
        body = formData;
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify({ text });
      }
      const response = await fetch(new URL(`/channels/${encodeURIComponent(channelId)}/messages`, apiBaseUrl), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers,
        body
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
      setSelectedFiles([]);
      setAttachmentError(null);
    } catch {
      setSendError("Your message could not be sent. Check your connection and try again.");
    } finally {
      setIsSending(false);
    }
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

  const downloadAttachment = useCallback(async (attachment: NonNullable<ChannelMessageView["attachments"]>[number]): Promise<void> => {
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

  const searchJump = useMessageSearchJump({
    type: "channel",
    conversationId: channelId,
    messages,
    containerRef: scrollContainerRef,
    isLoading: isLoading || loadedChannelId !== channelId,
    isLoadingOlder,
    hasMore: nextCursor !== null,
    olderError,
    loadOlder: loadOlderMessages
  });

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
    <section aria-label="Channel conversation" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#fbfaf8]">
      <p aria-live="polite" className="sr-only" role="status">{searchJump.announcement}</p>
      <header className="flex shrink-0 items-center gap-3 border-b border-[#e9e7e1] px-5 py-2.5 sm:px-6">
        <p className="ml-auto flex items-center gap-2 text-xs text-[#74817b]" role="status">
          <span aria-hidden="true" className={`size-2 rounded-full ${realtime.workspaceReady ? "bg-emerald-500" : "bg-amber-400"}`} />
          {realtime.workspaceReady
            ? channelName.toLocaleLowerCase() === "general" ? "Live" : "Live updates"
            : realtime.errorMessage ?? (realtime.status === "connected" ? "Connecting live chat…" : "Reconnecting to live chat…")}
        </p>
        <Button aria-label="Refresh messages" className="size-8 text-[#687a72] hover:bg-[#eef3ef]" disabled={isLoading} onClick={() => setReloadToken((current) => current + 1)} size="icon" type="button" variant="ghost">
          <RefreshCw aria-hidden="true" className="size-4" />
        </Button>
      </header>
      {channelName.toLocaleLowerCase() === "general" ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-[#e2e9e1] bg-[#f1f5ef] px-8 py-2">
          <Pin aria-hidden="true" className="size-4 shrink-0 text-[#507b68]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#29463e]">Team hub</p>
            <p className="truncate text-xs text-[#6a7b72]">{channelDescription || "Everything you need to feel at home here."}</p>
          </div>
        </div>
      ) : null}

      <div aria-live="polite" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-2 sm:px-8 sm:py-2" ref={scrollContainerRef}>
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
              <ol aria-label="Channel messages" className="space-y-3">
                {messageTimeline.map(({ message, startsNewDay }) => (
                  <ChannelMessageItem
                    key={message.id}
                    downloadingAttachmentId={downloadingAttachmentId}
                    isDownloadBusy={downloadingAttachmentId !== null}
                    message={message}
                    onDownloadAttachment={downloadAttachment}
                    startsNewDay={startsNewDay}
                  />
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

      <div className="shrink-0 border-t border-[#e9e7e1] bg-white/75 px-6 py-4 sm:px-8">
        {canSend && !accessRevoked ? (
          <form className="space-y-2" onSubmit={(event) => void sendMessage(event)}>
            <label className="sr-only" htmlFor="channel-message-draft">Write a message</label>
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
              <Button aria-label="Attach files" className="mb-0.5 size-10 shrink-0 rounded-xl" disabled={isSending || isLoading || Boolean(loadError)} onClick={() => attachmentInputRef.current?.click()} size="icon" type="button" variant="ghost">
                <Paperclip aria-hidden="true" className="size-4" />
              </Button>
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
                placeholder={`Message #${channelName}…`}
                rows={1}
                value={draft}
              />
              <Button aria-label="Send message" className="mb-0.5 size-10 shrink-0 rounded-xl" disabled={(!draft.trim() && selectedFiles.length === 0) || isSending || isLoading || Boolean(loadError)} size="icon" type="submit">
                <Send aria-hidden="true" className="size-4" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              {sendError || attachmentError || attachmentActionError
                ? <p className="text-xs text-destructive" role="alert">{sendError ?? attachmentError ?? attachmentActionError}</p>
                : <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck aria-hidden="true" className="size-3.5" />Only current channel members can read or send messages.</p>}
              <span className="ml-auto text-xs text-muted-foreground">{Array.from(draft).length}/{4_000} · Enter to send, Shift+Enter for a new line</span>
            </div>
            <p className="px-1 text-[10px] text-muted-foreground">Up to 5 files, 10 MB each · JPG, PNG, GIF, WebP, PDF, TXT, CSV, MD</p>
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
