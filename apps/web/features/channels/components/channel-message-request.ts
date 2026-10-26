export type ChannelMessageRequest = Readonly<{
  apiBaseUrl: string;
  workspaceId: string;
  userId: string;
  channelId: string;
  limit: number;
}>;

export type ChannelMessageRequestResult = Readonly<{
  status: number;
  body: unknown;
}>;

type ChannelMessageRequestFetcher = (
  request: ChannelMessageRequest
) => Promise<ChannelMessageRequestResult>;

export const createChannelMessageRequestCache = (fetchPage: ChannelMessageRequestFetcher) => {
  const pendingRequests = new Map<string, Promise<ChannelMessageRequestResult>>();

  return (request: ChannelMessageRequest): Promise<ChannelMessageRequestResult> => {
    const key = JSON.stringify(request);
    const pending = pendingRequests.get(key);
    if (pending) return pending;

    const current = fetchPage(request);
    pendingRequests.set(key, current);
    const removePending = (): void => {
      if (pendingRequests.get(key) === current) pendingRequests.delete(key);
    };
    void current.then(removePending, removePending);
    return current;
  };
};

export const requestChannelMessages = createChannelMessageRequestCache(async ({
  apiBaseUrl,
  workspaceId,
  channelId,
  limit
}) => {
  const url = new URL(`/channels/${encodeURIComponent(channelId)}/messages`, apiBaseUrl);
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: { "X-Workspace-Id": workspaceId }
  });
  return Object.freeze({
    status: response.status,
    body: response.ok ? await response.json() : null
  });
});
