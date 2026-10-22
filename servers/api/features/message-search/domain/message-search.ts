export const MESSAGE_SEARCH_PAGE_SIZE = 20;
export const MESSAGE_SEARCH_MAX_PAGE = 20;
export const MESSAGE_SEARCH_MAX_QUERY_LENGTH = 100;
export const MESSAGE_SEARCH_TIMEOUT_MS = 2_000;
export const MESSAGE_SEARCH_RATE_LIMIT = 30;
export const MESSAGE_SEARCH_RATE_WINDOW_MS = 60_000;
export const MESSAGE_SEARCH_MAX_RESULT_COUNT = MESSAGE_SEARCH_PAGE_SIZE * MESSAGE_SEARCH_MAX_PAGE;

export type MessageSearchCandidate = Readonly<{
  id: string;
  senderId: string;
  text: string;
  createdAt: Date;
  score: number;
  conversation:
    | Readonly<{ type: "channel"; id: string; name: string }>
    | Readonly<{ type: "direct"; id: string; otherParticipantId: string }>;
}>;

export type MessageSearchPage = Readonly<{
  candidates: readonly MessageSearchCandidate[];
  hasMore: boolean;
  truncated: boolean;
}>;

export const normalizeMessageSearchQuery = (query: string): string => {
  const tokens = query.normalize("NFKC").match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  return tokens.join(" ").slice(0, MESSAGE_SEARCH_MAX_QUERY_LENGTH);
};

export const createMessageSnippet = (text: string, query: string): string => {
  const normalizedText = text.toLocaleLowerCase();
  const matchIndexes = normalizeMessageSearchQuery(query).split(" ")
    .map((token) => normalizedText.indexOf(token.toLocaleLowerCase()))
    .filter((index) => index >= 0);
  const matchIndex = matchIndexes.length > 0 ? Math.min(...matchIndexes) : -1;
  const start = matchIndex > 70 ? matchIndex - 70 : 0;
  const end = Math.min(text.length, start + 180);
  const snippet = text.slice(start, end);
  return `${start > 0 ? "…" : ""}${snippet}${end < text.length ? "…" : ""}`;
};

export const compareMessageSearchCandidates = (
  left: MessageSearchCandidate,
  right: MessageSearchCandidate
): number =>
  right.score - left.score
  || right.createdAt.getTime() - left.createdAt.getTime()
  || right.id.localeCompare(left.id)
  || left.conversation.type.localeCompare(right.conversation.type);
