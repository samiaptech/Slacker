"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent, type RefObject, type SyntheticEvent } from "react";
import type { ChannelMentionMemberResponse } from "@workspace/types";
import { z } from "zod";
import { renderMentionTokens, retainUneditedMentionTokens, serializeMentionTokens } from "./channel-mention-text";

const memberListSchema = z.object({
  members: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), image: z.string().nullable() }).strict())
}).strict();

type MentionRange = Readonly<{ start: number; end: number; query: string }>;
type MentionStatus = "loading" | "ready" | "error";
type UseChannelMentionsOptions = Readonly<{
  apiBaseUrl: string;
  channelId: string;
  workspaceId: string;
  value: string;
  onValueChange: (value: string) => void;
  onTyping: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}>;

const getMentionRange = (value: string, caret: number): MentionRange | null => {
  const beforeCaret = value.slice(0, caret);
  const match = /(?:^|[\s([{])@([^\s@]{0,64})$/.exec(beforeCaret);
  if (!match) return null;
  const query = match[1] ?? "";
  return { start: caret - query.length - 1, end: caret, query };
};

export const useChannelMentions = ({
  apiBaseUrl, channelId, workspaceId, value, onValueChange, onTyping, textareaRef
}: UseChannelMentionsOptions) => {
  const [retry, setRetry] = useState(0);
  const scopeKey = `${workspaceId}:${channelId}:${retry}`;
  const [loadedMembers, setLoadedMembers] = useState<Readonly<{
    scopeKey: string;
    members: readonly ChannelMentionMemberResponse[];
    status: MentionStatus;
  }> | null>(null);
  const [range, setRange] = useState<MentionRange | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const members = useMemo(
    () => loadedMembers?.scopeKey === scopeKey ? loadedMembers.members : [],
    [loadedMembers, scopeKey]
  );
  const status = loadedMembers?.scopeKey === scopeKey ? loadedMembers.status : "loading";

  useEffect(() => {
    const controller = new AbortController();
    void fetch(new URL(`/channels/${encodeURIComponent(channelId)}/mention-members`, apiBaseUrl), {
      credentials: "include",
      cache: "no-store",
      headers: { "X-Workspace-Id": workspaceId },
      signal: controller.signal
    }).then(async (response) => {
      if (!response.ok) throw new Error("Mention members unavailable");
      const parsed = memberListSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Invalid mention member response");
      setLoadedMembers({ scopeKey, members: parsed.data.members, status: "ready" });
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLoadedMembers({ scopeKey, members: [], status: "error" });
    });
    return () => controller.abort();
  }, [apiBaseUrl, channelId, retry, scopeKey, workspaceId]);

  const memberNames = useMemo(() => new Map(members.map(({ id, name }) => [id, name])), [members]);
  const renderedDraft = useMemo(() => renderMentionTokens(value, memberNames), [memberNames, value]);
  const suggestions = useMemo(() => {
    if (!range) return [];
    const query = range.query.trim().toLocaleLowerCase();
    return members.filter(({ name }) => name.toLocaleLowerCase().includes(query)).slice(0, 8);
  }, [members, range]);

  const onChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>): void => {
    const nextDisplay = event.currentTarget.value;
    const tokens = retainUneditedMentionTokens(renderedDraft.text, nextDisplay, renderedDraft.tokens);
    const nextValue = serializeMentionTokens(nextDisplay, tokens);
    onValueChange(nextValue);
    onTyping(nextValue);
    setRange(getMentionRange(nextDisplay, event.currentTarget.selectionStart));
    setActiveIndex(0);
  }, [onTyping, onValueChange, renderedDraft]);

  const updateCaret = useCallback((event: SyntheticEvent<HTMLTextAreaElement>): void => {
    setRange(getMentionRange(renderedDraft.text, event.currentTarget.selectionStart));
  }, [renderedDraft.text]);

  const selectMember = useCallback((member: ChannelMentionMemberResponse): void => {
    const textarea = textareaRef.current;
    const currentRange = range;
    if (!textarea || !currentRange) return;
    const visibleMention = `@${member.name}`;
    const nextDisplay = `${renderedDraft.text.slice(0, currentRange.start)}${visibleMention} ${renderedDraft.text.slice(currentRange.end)}`;
    const retainedTokens = retainUneditedMentionTokens(renderedDraft.text, nextDisplay, renderedDraft.tokens);
    const selectedToken = { start: currentRange.start, end: currentRange.start + visibleMention.length, id: member.id };
    const nextValue = serializeMentionTokens(nextDisplay, [...retainedTokens, selectedToken].sort((left, right) => left.start - right.start));
    const caret = currentRange.start + visibleMention.length + 1;
    onValueChange(nextValue);
    onTyping(nextValue);
    setRange(null);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
  }, [onTyping, onValueChange, range, renderedDraft, textareaRef]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>, fallback: (event: KeyboardEvent<HTMLTextAreaElement>) => void): void => {
    if (range && status === "ready" && suggestions.length > 0 && !event.nativeEvent.isComposing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((index) => (index + direction + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        selectMember(suggestions[activeIndex] ?? suggestions[0]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setRange(null);
        return;
      }
    }
    fallback(event);
  }, [activeIndex, range, selectMember, status, suggestions]);

  const close = useCallback((): void => setRange(null), []);
  const reload = useCallback((): void => setRetry((current) => current + 1), []);

  return {
    activeIndex,
    close,
    memberNames,
    onChange,
    onKeyDown,
    range,
    reload,
    selectMember,
    status,
    suggestions,
    displayValue: renderedDraft.text,
    updateCaret
  } as const;
};
