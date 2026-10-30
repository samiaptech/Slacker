"use client";

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { ArrowDown, LoaderCircle, MessageCircle, X } from "lucide-react";
import { Button } from "@workspace/ui";
import type { ChannelMentionMemberResponse, RealtimeServerEvents } from "@workspace/types";
import type { MessageDeleteScope, MessageAttachment } from "@/features/conversation-history/public";
import type { MessageWithDelivery } from "@/features/conversation-history/public";
import {
  channelMessageResponseSchema,
  channelThreadReplyResponseSchema,
  type ChannelMessageView
} from "../types";
import type { ChannelRealtimeSocket } from "./channel-realtime-provider";
import { ChannelThreadMessage } from "./channel-thread-message";
import { ChannelThreadComposer } from "./channel-thread-composer";
import { useChannelThreadActions } from "./use-channel-thread-actions";
import { useChannelThreadData } from "./use-channel-thread-data";

type Props = Readonly<{
  apiBaseUrl: string;
  workspaceId: string;
  channelId: string;
  rootId: string;
  focusReplyId?: string | null;
  initialRoot?: ChannelMessageView;
  socket: ChannelRealtimeSocket | null;
  canSend: boolean;
  canDeleteForEveryone: boolean;
  user: Readonly<{ id: string; name: string; email: string; image: string | null }>;
  onRootDeleted: (scope: MessageDeleteScope) => void;
  onClose: () => void;
  onSummary: (rootId: string, summary: NonNullable<ChannelMessageView["thread"]>) => void;
}>;

export const ChannelThreadPanel = ({ apiBaseUrl, workspaceId, channelId, rootId, focusReplyId, initialRoot, socket, canSend, canDeleteForEveryone, user, onRootDeleted, onClose, onSummary }: Props): ReactElement => {
  const [isSending, setIsSending] = useState(false);
  const [pendingReplies, setPendingReplies] = useState<readonly MessageWithDelivery<ChannelMessageView>[]>([]);
  const [mentionNames, setMentionNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<string | null>(null);
  const { root, replies, cursor, isLoading, isOlderLoading, error, setError, getMessage, updateMessage, addReply, removeMessage, loadOlder, endpoint } = useChannelThreadData({
    apiBaseUrl, workspaceId, channelId, rootId, ...(initialRoot ? { initialRoot } : {}), socket, onClose, onSummary, onRootDeleted
  });
  const actions = useChannelThreadActions({ apiBaseUrl, workspaceId, channelId, rootId, user, canDeleteForEveryone, getMessage, updateMessage, removeMessage });
  const visibleReplies = [...replies, ...pendingReplies].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const updateMentionMembers = useCallback((members: readonly ChannelMentionMemberResponse[]): void => {
    setMentionNames(new Map(members.map(({ id, name }) => [id, name])));
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onReply = (event: Parameters<RealtimeServerEvents["channel:thread:reply:new"]>[0]): void => {
      if (event.channelId !== channelId || event.rootMessageId !== rootId) return;
      const reply = channelMessageResponseSchema.safeParse(event.reply);
      if (!reply.success || reply.data.senderId !== user.id) return;
      setPendingReplies((current) => {
        const matched = current.find((pending) => pending.deliveryState === "sending"
          && pending.text === reply.data.text
          && (pending.pendingFiles ?? []).length === (reply.data.attachments ?? []).length
          && (pending.pendingFiles ?? []).every((file, index) => file.name === reply.data.attachments?.[index]?.name && file.size === reply.data.attachments?.[index]?.size));
        return matched ? current.filter(({ id }) => id !== matched.id) : current;
      });
    };
    socket.on("channel:thread:reply:new", onReply);
    return () => { socket.off("channel:thread:reply:new", onReply); };
  }, [channelId, rootId, socket, user.id]);

  const focusedReplyLoaded = useRef(false);
  useEffect(() => {
    if (!focusReplyId || focusedReplyLoaded.current || isLoading || isOlderLoading || error) return;
    const target = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(focusReplyId)}"]`);
    if (target) {
      focusedReplyLoaded.current = true;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [cursor, error, focusReplyId, isLoading, isOlderLoading, replies]);

  const olderReplySentinel = useRef<HTMLDivElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusReplyId || focusedReplyLoaded.current || !cursor || isLoading || isOlderLoading || error) return;
    const sentinel = olderReplySentinel.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      void loadOlder();
    }, { root: threadScrollRef.current });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cursor, error, focusReplyId, isLoading, isOlderLoading, loadOlder]);

  const persistReply = async (pending: MessageWithDelivery<ChannelMessageView>): Promise<void> => {
    setIsSending(true);
    try {
      const headers: Record<string, string> = { "X-Workspace-Id": workspaceId };
      let body: BodyInit;
      const files = pending.pendingFiles ?? [];
      if (files.length) {
        const form = new FormData();
        if (pending.text) form.set("text", pending.text);
        files.forEach((file) => form.append("files", file));
        body = form;
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify({ text: pending.text });
      }
      const response = await fetch(new URL(endpoint, apiBaseUrl), {
        method: "POST", credentials: "include", cache: "no-store",
        headers,
        body
      });
      if (!response.ok) throw new Error(response.status === 400 ? "Reply must be 1–4,000 characters." : "Your reply could not be sent. Try again.");
      const parsed = channelThreadReplyResponseSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.reply.channelId !== channelId || parsed.data.reply.threadRootId !== rootId) throw new Error("The server returned an invalid reply.");
      setPendingReplies((current) => current.filter((item) => item.id !== pending.id));
      addReply(parsed.data.reply);
      onSummary(rootId, parsed.data.thread);
    } catch (failure) {
      setPendingReplies((current) => current.map((item) => item.id === pending.id ? { ...item, deliveryState: "failed" } : item));
      setError(failure instanceof Error ? failure.message : "Your reply could not be sent.");
    } finally {
      setIsSending(false);
    }
  };

  const sendReply = async (text: string, files: readonly File[]): Promise<boolean> => {
    if ((!text && files.length === 0) || isSending || !canSend) return false;
    setError(null);
    const pending: MessageWithDelivery<ChannelMessageView> = {
      id: `pending-${crypto.randomUUID()}`,
      channelId,
      senderId: user.id,
      text,
      createdAt: new Date().toISOString(),
      attachments: [],
      reactions: [],
      threadRootId: rootId,
      thread: null,
      sender: { id: user.id, name: user.name || user.email, image: user.image },
      deliveryState: "sending",
      pendingFiles: files
    };
    setPendingReplies((current) => [...current, pending]);
    void persistReply(pending);
    return true;
  };

  const retryReply = (id: string): void => {
    const pending = pendingReplies.find((item) => item.id === id && item.deliveryState === "failed");
    if (!pending || isSending) return;
    setPendingReplies((current) => current.map((item) => item.id === id ? { ...item, deliveryState: "sending" } : item));
    setError(null);
    void persistReply(pending);
  };

  const downloadAttachment = async (attachment: MessageAttachment): Promise<void> => {
    if (downloadingAttachmentId) return;
    setDownloadingAttachmentId(attachment.id);
    setError(null);
    try {
      const url = new URL(attachment.downloadUrl, apiBaseUrl);
      if (url.origin !== new URL(apiBaseUrl).origin) throw new Error("This file has an invalid download location.");
      const response = await fetch(url, { credentials: "include", cache: "no-store", headers: { "X-Workspace-Id": workspaceId } });
      if (!response.ok) throw new Error("This file is unavailable or you no longer have access to it.");
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = attachment.name;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The file could not be downloaded.");
    } finally {
      setDownloadingAttachmentId(null);
    }
  };

  const loadImagePreview = async (attachment: MessageAttachment, signal: AbortSignal): Promise<string> => {
    const url = new URL(attachment.downloadUrl, apiBaseUrl);
    if (url.origin !== new URL(apiBaseUrl).origin) throw new Error("This image has an invalid location.");
    const response = await fetch(url, { credentials: "include", cache: "no-store", headers: { "X-Workspace-Id": workspaceId }, signal });
    if (!response.ok) throw new Error("This image is unavailable or you no longer have access to it.");
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("This attachment is not a supported image.");
    return URL.createObjectURL(blob);
  };

  const messageActions = (message: ChannelMessageView & Readonly<{ deliveryState?: "sending" | "failed"; pendingFiles?: readonly File[] }>) => ({
    ...(message.deliveryState ? { deliveryState: message.deliveryState } : {}),
    ...(message.pendingFiles ? { pendingFiles: message.pendingFiles } : {}),
    retryDisabled: isSending,
    onRetry: () => retryReply(message.id),
    currentUserId: user.id,
    currentUserName: user.name || user.email,
    canDeleteForEveryone: message.senderId === user.id || canDeleteForEveryone,
    isEditing: actions.editingId === message.id,
    isSaving: actions.savingId === message.id,
    isDeleting: actions.deletingId !== null,
    isReactionPending: actions.pendingReactionId === message.id,
    editDraft: actions.editingId === message.id ? actions.draft : message.text,
    onEdit: () => actions.beginEdit(message),
    onEditChange: actions.setDraft,
    onCancelEdit: actions.cancelEdit,
    onSaveEdit: () => { void actions.saveEdit(); },
    onDelete: (scope: MessageDeleteScope) => { void actions.deleteMessage(message.id, scope); },
    onToggleReaction: (emoji: import("@workspace/types").MessageReactionEmoji) => { void actions.toggleReaction(message.id, emoji); }
  });

  return (
    <aside aria-label="Thread replies" className="fixed inset-0 z-40 flex min-h-0 flex-col border-l border-[#e8e7e0] bg-[#fffefa] shadow-2xl md:relative md:inset-auto md:z-0 md:w-[min(29vw,23rem)] md:shrink-0 md:shadow-none">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#ecebe5] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2"><h2 className="text-sm font-semibold text-[#293a32]">Thread</h2><span className="rounded-full bg-[#eff4ee] px-2 py-0.5 text-[11px] text-[#668073]">{root?.thread?.replyCount ?? replies.length} replies</span></div>
        <Button aria-label="Close thread" onClick={onClose} size="icon" type="button" variant="ghost"><X aria-hidden="true" className="size-4" /></Button>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" ref={threadScrollRef}>
        {root ? <ChannelThreadMessage {...messageActions(root)} downloadingAttachmentId={downloadingAttachmentId} isDownloadBusy={downloadingAttachmentId !== null} loadImagePreview={loadImagePreview} memberNames={mentionNames} message={root} onDownload={downloadAttachment} isRoot /> : null}
        <div className="flex items-center gap-2 border-t border-[#ecebe5] pt-2 text-[11px] font-medium text-[#668073]"><MessageCircle aria-hidden="true" className="size-3.5" /> Replies stay in this channel</div>
        {cursor ? <><Button className="w-full" disabled={isOlderLoading} onClick={() => void loadOlder()} type="button" variant="ghost">{isOlderLoading ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowDown className="size-4" />}Load older replies</Button>{focusReplyId ? <div aria-hidden="true" className="h-px" ref={olderReplySentinel} /> : null}</> : null}
        {isLoading ? <p className="py-8 text-center text-sm text-muted-foreground" role="status">Loading replies…</p> : null}
        {error || actions.error ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error ?? actions.error}</p> : null}
        {!isLoading && replies.length === 0 ? <p className="py-5 text-center text-sm text-muted-foreground">No replies yet. Start the thread.</p> : null}
        {visibleReplies.map((reply) => <ChannelThreadMessage {...messageActions(reply)} downloadingAttachmentId={downloadingAttachmentId} isDownloadBusy={downloadingAttachmentId !== null} key={reply.id} loadImagePreview={loadImagePreview} memberNames={mentionNames} message={reply} onDownload={downloadAttachment} />)}
      </div>
      <ChannelThreadComposer apiBaseUrl={apiBaseUrl} canSend={canSend} channelId={channelId} error={actions.error} isLoading={isLoading} isSending={isSending} onMembersChange={updateMentionMembers} onSend={sendReply} workspaceId={workspaceId} />
    </aside>
  );
};
