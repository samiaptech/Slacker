import type { MessageSearchPage } from "../domain/index.js";

export type MessageSearchStorage = Readonly<{
  searchForMember: (
    workspaceId: string,
    userId: string,
    query: string,
    page: number
  ) => Promise<MessageSearchPage>;
}>;

export type MessageSearchRepository = Readonly<{
  searchForMember: MessageSearchStorage["searchForMember"];
}>;

export const createMessageSearchRepository = (
  storage: MessageSearchStorage
): MessageSearchRepository => Object.freeze({
  searchForMember: async (workspaceId, userId, query, page) => {
    const result = await storage.searchForMember(workspaceId, userId, query, page);
    return Object.freeze({
      ...result,
      candidates: Object.freeze([...result.candidates])
    });
  }
});
