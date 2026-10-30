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
import type { SharedRateLimiter } from "../../../integrations/mongodb/index.js";

type SearchProfile = Readonly<{ id: string; name: string; image: string | null }>;

export type MessageSearchService = ReturnType<typeof createMessageSearchService>;

type MessageSearchServiceDependencies = Readonly<{
  repository: MessageSearchRepository;
  rateLimiter: SharedRateLimiter;
  findUsersByIds: (userIds: readonly string[]) => Promise<readonly SearchProfile[]>;
}>;

const isSearchStorageUnavailable = (error: unknown): boolean =>
  typeof error === "object" && error !== null
  && "kind" in error && error.kind === "message-search-storage-unavailable";

export const createMessageSearchService = ({
  repository,
  rateLimiter,
  findUsersByIds
}: MessageSearchServiceDependencies) => {
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
      let decision;
      try {
        decision = await rateLimiter.consume(
          `message-search:${userId}`,
          MESSAGE_SEARCH_RATE_LIMIT,
          MESSAGE_SEARCH_RATE_WINDOW_MS
        );
      } catch {
        return Object.freeze({ kind: "unavailable" });
      }
      if (!decision.allowed) {
        return Object.freeze({
          kind: "rate-limited",
          retryAfterSeconds: decision.retryAfterSeconds
        });
      }

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
            ...(candidate.conversation.type === "channel"
              ? { threadRootId: candidate.threadRootId ?? null }
              : { threadRootId: null }),
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
