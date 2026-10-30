"use client";

import { useCallback, useState } from "react";
import type { MessageReactionEmoji } from "@workspace/types";
import type { MessageDeleteScope } from "@/features/conversation-history/public";
import { optimisticallyToggleMessageReaction, requestMessageReaction } from "@/features/conversation-history/public";
import { channelMessageResponseSchema, type ChannelMessageView } from "../types";

type Options = Readonly<{
  apiBaseUrl: string;
  workspaceId: string;
  channelId: string;
  rootId: string;
  user: Readonly<{ id: string; name: string; email: string; image: string | null }>;
  canDeleteForEveryone: boolean;
  getMessage: (id: string) => ChannelMessageView | undefined;
  updateMessage: (message: ChannelMessageView) => void;
  removeMessage: (id: string, scope: MessageDeleteScope) => void;
}>;

export const useChannelThreadActions = ({ apiBaseUrl, workspaceId, channelId, rootId, user, canDeleteForEveryone, getMessage, updateMessage, removeMessage }: Options) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingReactionId, setPendingReactionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const beginEdit = useCallback((message: ChannelMessageView): void => {
    setEditingId(message.id);
    setDraft(message.text);
    setError(null);
  }, []);
  const cancelEdit = useCallback((): void => {
    if (savingId) return;
    setEditingId(null);
    setDraft("");
  }, [savingId]);
  const saveEdit = useCallback(async (): Promise<void> => {
    if (!editingId || savingId) return;
    const message = getMessage(editingId);
    if (!message || !draft.trim() || draft === message.text || Array.from(draft).length > 4_000) return;
    setSavingId(editingId);
    setError(null);
    try {
      const response = await fetch(new URL(`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(editingId)}`, apiBaseUrl), {
        method: "PATCH", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId },
        body: JSON.stringify({ text: draft, expectedEditedAt: message.editedAt ?? null })
      });
      if (!response.ok) throw new Error(response.status === 409 ? "This reply changed elsewhere. Your draft is still here; copy it and reload the thread." : "The reply could not be edited. Your draft is still here.");
      const parsed = channelMessageResponseSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.id !== editingId || parsed.data.threadRootId !== (editingId === rootId ? null : rootId)) throw new Error("The server returned an invalid edited reply.");
      updateMessage(parsed.data);
      setEditingId(null);
      setDraft("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The reply could not be edited.");
    } finally {
      setSavingId(null);
    }
  }, [apiBaseUrl, channelId, draft, editingId, getMessage, rootId, savingId, updateMessage, workspaceId]);

  const deleteMessage = useCallback(async (id: string, scope: MessageDeleteScope): Promise<void> => {
    if (deletingId) return;
    setDeletingId(id);
    setError(null);
    try {
      const response = await fetch(new URL(`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(id)}`, apiBaseUrl), {
        method: "DELETE", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId },
        body: JSON.stringify({ scope })
      });
      if (!response.ok) throw new Error("The reply could not be deleted. Check access and try again.");
      removeMessage(id, scope);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The reply could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  }, [apiBaseUrl, channelId, deletingId, removeMessage, workspaceId]);

  const toggleReaction = useCallback(async (id: string, emoji: MessageReactionEmoji): Promise<void> => {
    if (pendingReactionId) return;
    const message = getMessage(id);
    if (!message) return;
    setPendingReactionId(id);
    setError(null);
    updateMessage({ ...message, reactions: optimisticallyToggleMessageReaction(message.reactions, emoji, { id: user.id, name: user.name || user.email, image: user.image }) });
    try {
      const result = await requestMessageReaction({ apiBaseUrl, workspaceId, target: { type: "channel", id: channelId }, messageId: id, emoji });
      const latest = getMessage(id);
      if (latest) updateMessage({ ...latest, reactions: result.reactions });
    } catch (failure) {
      updateMessage(message);
      setError(failure instanceof Error ? failure.message : "The reaction could not be updated.");
    } finally {
      setPendingReactionId(null);
    }
  }, [apiBaseUrl, channelId, getMessage, pendingReactionId, updateMessage, user.email, user.id, user.image, user.name, workspaceId]);

  return { editingId, draft, savingId, deletingId, pendingReactionId, error, setDraft, beginEdit, cancelEdit, saveEdit, deleteMessage, toggleReaction, canDeleteForEveryone } as const;
};
