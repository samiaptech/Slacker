"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  MESSAGE_SEARCH_TARGET_EVENT,
  takeMessageSearchTarget,
  type MessageSearchTarget
} from "./search-target";

type SearchableMessage = Readonly<{ id: string }>;
type MessageSearchJumpOptions = Readonly<{
  type: MessageSearchTarget["type"];
  conversationId: string;
  messages: readonly SearchableMessage[];
  containerRef: RefObject<HTMLElement | null>;
  isLoading: boolean;
  isLoadingOlder: boolean;
  hasMore: boolean;
  olderError: string | null;
  loadOlder: () => Promise<void>;
  onOpenThread?: (rootMessageId: string, replyMessageId: string | null) => void;
}>;

export const useMessageSearchJump = ({
  type,
  conversationId,
  messages,
  containerRef,
  isLoading,
  isLoadingOlder,
  hasMore,
  olderError,
  loadOlder,
  onOpenThread
}: MessageSearchJumpOptions) => {
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const statusTimerRef = useRef<number | null>(null);
  const announceAfterEffect = useCallback((message: string, clearTarget = false): void => {
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
    statusTimerRef.current = window.setTimeout(() => {
      setAnnouncement(message);
      if (clearTarget) setTargetMessageId(null);
    }, 0);
  }, []);

  useEffect(() => () => {
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
  }, []);

  useEffect(() => {
    const receiveTarget = (): void => {
      const url = new URL(window.location.href);
      const routeConversationId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      if (routeConversationId !== conversationId) return;
      const storedTarget = takeMessageSearchTarget(type, conversationId);
      const urlMessageId = url.searchParams.get("message");
      const threadId = url.searchParams.get("thread");
      const targetRootId = storedTarget?.threadRootId ?? threadId;
      const messageId = storedTarget?.messageId ?? urlMessageId;
      if (targetRootId) onOpenThread?.(targetRootId, messageId);
      if (!messageId || targetRootId) return;
      setTargetMessageId(messageId);
      setAnnouncement("Finding the selected message in conversation history.");
    };
    receiveTarget();
    window.addEventListener(MESSAGE_SEARCH_TARGET_EVENT, receiveTarget);
    return () => window.removeEventListener(MESSAGE_SEARCH_TARGET_EVENT, receiveTarget);
  }, [conversationId, onOpenThread, type]);

  useEffect(() => {
    if (!targetMessageId || isLoading || isLoadingOlder) return;
    const messageExists = messages.some(({ id }) => id === targetMessageId);
    if (messageExists) {
      const target = Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? []
      ).find((message) => message.dataset.messageId === targetMessageId);
      if (!target) return;
      target.tabIndex = -1;
      target.classList.add("message-search-highlight");
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      clearMessageSearchQuery(conversationId);
      window.setTimeout(() => target.classList.remove("message-search-highlight"), 3_000);
      announceAfterEffect("Selected message found and highlighted.", true);
      return;
    }
    if (olderError) {
      announceAfterEffect("Couldn’t load enough history to find that message. Retry loading older messages to continue.");
      return;
    }
    if (hasMore) {
      announceAfterEffect("Loading older messages to find the selected result.");
      void loadOlder();
      return;
    }
    clearMessageSearchQuery(conversationId);
    announceAfterEffect("That message is no longer available in this conversation.", true);
  }, [announceAfterEffect, containerRef, conversationId, hasMore, isLoading, isLoadingOlder, loadOlder, messages, olderError, targetMessageId]);

  return Object.freeze({ isPending: targetMessageId !== null, announcement });
};

const clearMessageSearchQuery = (conversationId: string): void => {
  const url = new URL(window.location.href);
  const routeConversationId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
  if (routeConversationId !== conversationId || !url.searchParams.has("message")) return;
  url.searchParams.delete("message");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
};
