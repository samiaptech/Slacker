export type MessageSearchResult = Readonly<{
  id: string;
  threadRootId?: string | null;
  snippet: string;
  createdAt: string;
  sender: Readonly<{ id: string; name: string; image: string | null }>;
  conversation: Readonly<{
    type: "channel" | "direct";
    id: string;
    name: string;
  }>;
}>;

export type MessageSearchResponse = Readonly<{
  query: string;
  page: number;
  results: readonly MessageSearchResult[];
  hasMore: boolean;
  truncated: boolean;
}>;
