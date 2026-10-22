import type { MessageSearchResponse, MessageSearchResult } from "@workspace/types";
import {
  compareMessageSearchCandidates,
  createMessageSnippet,
  MESSAGE_SEARCH_MAX_PAGE,
  MESSAGE_SEARCH_MAX_QUERY_LENGTH,
  MESSAGE_SEARCH_RATE_LIMIT,
  MESSAGE_SEARCH_RATE_WINDOW_MS,
  normalizeMessageSearchQuery
} from "../domain/index.js";
import type { MessageSearchRepository } from "../repositories/index.js";

type SearchProfile = Readonly<{ id: string; name: string; image: string | null }>;

export type MessageSearchService = ReturnType<typeof createMessageSearchService>;

type MessageSearchServiceDependencies = Readonly<{
  repository: MessageSearchRepository;
  findUsersByIds: (userIds: readonly string[]) => Promise<readonly SearchProfile[]>;
  now?: () => number;
}>;

const isSearchStorageUnavailable = (error: unknown): boolean =>
  typeof error === "object" && error !== null
  && "kind" in error && error.kind === "message-search-storage-unavailable";

export const createMessageSearchService = ({
  repository,
  findUsersByIds,
  now = Date.now
}: MessageSearchServiceDependencies) => {
  const requestsByUser = new Map<string, number[]>();
  let requestsSinceCleanup = 0;

  const cleanExpiredRequests = (currentTime: number): void => {
    requestsSinceCleanup += 1;
    if (requestsSinceCleanup < 250) return;
    requestsSinceCleanup = 0;
    for (const [userId, timestamps] of requestsByUser) {
      const active = timestamps.filter((timestamp) => currentTime - timestamp < MESSAGE_SEARCH_RATE_WINDOW_MS);
      if (active.length === 0) requestsByUser.delete(userId);
      else requestsByUser.set(userId, active);
    }
  };

  return Object.freeze({
    search: async (
      workspaceId: string,
      userId: string,
      rawQuery: string,
      page: number
    ): Promise<
      | Readonly<{ kind: "listed"; response: MessageSearchResponse }>
      | Readonly<{ kind: "invalid" }>
      | Readonly<{ kind: "rate-limited"; retryAfterSeconds: number }>
      | Readonly<{ kind: "unavailable" }>
    > => {
      if (Array.from(rawQuery).length > MESSAGE_SEARCH_MAX_QUERY_LENGTH || page < 1 || page > MESSAGE_SEARCH_MAX_PAGE) {
        return Object.freeze({ kind: "invalid" });
      }
      const query = normalizeMessageSearchQuery(rawQuery);
      if (!query) return Object.freeze({ kind: "invalid" });
      const currentTime = now();
      cleanExpiredRequests(currentTime);
      const activeRequests = (requestsByUser.get(userId) ?? [])
        .filter((timestamp) => currentTime - timestamp < MESSAGE_SEARCH_RATE_WINDOW_MS);
      if (activeRequests.length >= MESSAGE_SEARCH_RATE_LIMIT) {
        const retryAfterSeconds = Math.max(1, Math.ceil(
          (MESSAGE_SEARCH_RATE_WINDOW_MS - (currentTime - (activeRequests[0] ?? currentTime))) / 1_000
        ));
        return Object.freeze({ kind: "rate-limited", retryAfterSeconds });
      }
      requestsByUser.set(userId, [...activeRequests, currentTime]);

      try {
        const result = await repository.searchForMember(workspaceId, userId, query, page);
        const candidates = [...result.candidates].sort(compareMessageSearchCandidates);
        const profileIds = new Set<string>();
        for (const candidate of candidates) {
          profileIds.add(candidate.senderId);
          if (candidate.conversation.type === "direct") {
            profileIds.add(candidate.conversation.otherParticipantId);
          }
        }
        const profiles = await findUsersByIds([...profileIds]);
        const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
        const results: MessageSearchResult[] = candidates.map((candidate) => {
          const sender = profilesById.get(candidate.senderId);
          const conversation = candidate.conversation.type === "channel"
            ? Object.freeze({ type: "channel" as const, id: candidate.conversation.id, name: `#${candidate.conversation.name}` })
            : Object.freeze({
              type: "direct" as const,
              id: candidate.conversation.id,
              name: profilesById.get(candidate.conversation.otherParticipantId)?.name || "Former member"
            });
          return Object.freeze({
            id: candidate.id,
            snippet: createMessageSnippet(candidate.text, query),
            createdAt: candidate.createdAt.toISOString(),
            sender: Object.freeze({
              id: candidate.senderId,
              name: sender?.name || "Former member",
              image: sender?.image ?? null
            }),
            conversation
          });
        });
        return Object.freeze({
          kind: "listed",
          response: Object.freeze({
            query: rawQuery.trim(),
            page,
            results: Object.freeze(results),
            hasMore: result.hasMore,
            truncated: result.truncated
          })
        });
      } catch (error: unknown) {
        if (isSearchStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" });
        throw error;
      }
    }
  });
};
