"use client";

import { useCallback, useRef, useState } from "react";
import { getMessageEditFailure } from "./message-edit-response";

type EditableMessage = Readonly<{
  id: string;
  text: string;
  editedAt?: string | null | undefined;
}>;

type UseMessageEditOptions<T extends EditableMessage> = Readonly<{
  apiBaseUrl: string;
  workspaceId: string;
  endpoint: (messageId: string) => string;
  getMessage: (messageId: string) => T | undefined;
  updateMessage: (message: T) => void;
  parseResponse: (payload: unknown) => T | null;
  reload: () => void;
}>;

export const useMessageEdit = <T extends EditableMessage>({
  apiBaseUrl,
  workspaceId,
  endpoint,
  getMessage,
  updateMessage,
  parseResponse,
  reload
}: UseMessageEditOptions<T>) => {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [savingMessageId, setSavingMessageId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const realtimeUpdates = useRef(new Map<string, T>());
  const activeEditMessageId = useRef<string | null>(null);

  const beginEdit = useCallback((message: T): void => {
    realtimeUpdates.current.clear();
    activeEditMessageId.current = message.id;
    setEditingMessageId(message.id);
    setDraft(message.text);
    setError(null);
  }, []);

  const cancelEdit = useCallback((): void => {
    if (savingMessageId) return;
    activeEditMessageId.current = null;
    realtimeUpdates.current.clear();
    setEditingMessageId(null);
    setDraft("");
    setError(null);
  }, [savingMessageId]);

  const receiveRealtimeUpdate = useCallback((message: T): void => {
    if (activeEditMessageId.current === message.id) realtimeUpdates.current.set(message.id, message);
    updateMessage(message);
  }, [updateMessage]);

  const saveEdit = useCallback(async (messageId: string): Promise<void> => {
    if (savingMessageId) return;
    const message = getMessage(messageId);
    const nextText = draft;
    if (!message || !nextText.trim() || nextText === message.text || Array.from(nextText).length > 4_000) return;

    const restore = (messageError: string, conflict: boolean): void => {
      updateMessage(realtimeUpdates.current.get(messageId) ?? message);
      setDraft(nextText);
      setEditingMessageId(messageId);
      setError(messageError);
      if (conflict) reload();
    };

    realtimeUpdates.current.delete(messageId);
    activeEditMessageId.current = messageId;
    setSavingMessageId(messageId);
    setError(null);
    updateMessage({ ...message, text: nextText, editedAt: new Date().toISOString() });
    try {
      const response = await fetch(new URL(endpoint(messageId), apiBaseUrl), {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId },
        body: JSON.stringify({ text: nextText, expectedEditedAt: message.editedAt ?? null })
      });
      if (!response.ok) {
        const failure = await getMessageEditFailure(response);
        restore(failure.message, failure.conflict);
        return;
      }
      const updated = parseResponse(await response.json());
      if (!updated || updated.id !== messageId) {
        restore("The server returned an invalid edited message. Your draft is safe; retry saving.", false);
        return;
      }
      updateMessage(updated);
      realtimeUpdates.current.delete(messageId);
      activeEditMessageId.current = null;
      setEditingMessageId(null);
      setDraft("");
    } catch {
      restore("The message could not be edited. Your draft is safe; check your connection and retry.", false);
    } finally {
      setSavingMessageId(null);
    }
  }, [apiBaseUrl, draft, endpoint, getMessage, parseResponse, reload, savingMessageId, updateMessage, workspaceId]);

  return {
    editingMessageId,
    savingMessageId,
    draft,
    error,
    beginEdit,
    cancelEdit,
    saveEdit,
    setDraft,
    setError,
    receiveRealtimeUpdate
  } as const;
};
