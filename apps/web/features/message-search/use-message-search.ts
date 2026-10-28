"use client";

import { useEffect, useState } from "react";
import { messageSearchResponseSchema, type MessageSearchResponseView } from "./types/message-search-response";

const MESSAGE_SEARCH_DEBOUNCE_MS = 300;

type UseMessageSearchOptions = Readonly<{
  apiBaseUrl: string;
  workspaceId: string;
  open: boolean;
  query: string;
}>;

export const useMessageSearch = ({ apiBaseUrl, workspaceId, open, query }: UseMessageSearchOptions) => {
  const [response, setResponse] = useState<MessageSearchResponseView | null>(null);
  const [results, setResults] = useState<MessageSearchResponseView["results"]>([]);
  const [page, setPage] = useState(1);
  const [retryCount, setRetryCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const searchQuery = query.trim();
    if (!open || Array.from(searchQuery).length < 2) return;
    const controller = new AbortController();
    let timedOut = false;
    let requestTimeout: number | undefined;
    const debounce = window.setTimeout(() => {
      const search = async (): Promise<void> => {
        setIsLoading(true);
        setError(null);
        if (page === 1) setResults([]);
        requestTimeout = window.setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, 10_000);
        try {
          const response = await fetch(new URL("/messages/search", apiBaseUrl), {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId },
            body: JSON.stringify({ query: searchQuery, page }),
            signal: controller.signal
          });
          if (controller.signal.aborted) return;
          if (!response.ok) {
            setError(response.status === 429
              ? "You’re searching too quickly. Wait a moment and try again."
              : response.status === 503
                ? "Message search is unavailable. Check that the API search indexes have been initialized."
                : "Messages couldn’t be searched. Please try again.");
            return;
          }
          const payload: unknown = await response.json();
          if (controller.signal.aborted) return;
          const parsed = messageSearchResponseSchema.safeParse(payload);
          if (!parsed.success) {
            setError("The server returned invalid search results.");
            return;
          }
          setResponse(parsed.data);
          setResults((current) => {
            const merged = page === 1 ? parsed.data.results : [...current, ...parsed.data.results];
            return [...new Map(merged.map((item) => [
              `${item.conversation.type}:${item.conversation.id}:${item.id}`,
              item
            ])).values()];
          });
        } catch {
          if (controller.signal.aborted && !timedOut) return;
          setError(timedOut
            ? "Message search timed out. Retry or narrow your query."
            : "Messages couldn’t be searched. Check your connection and retry.");
        } finally {
          if (requestTimeout !== undefined) window.clearTimeout(requestTimeout);
          if (!controller.signal.aborted || timedOut) setIsLoading(false);
        }
      };
      void search();
    }, MESSAGE_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(debounce);
      if (requestTimeout !== undefined) window.clearTimeout(requestTimeout);
      controller.abort();
    };
  }, [apiBaseUrl, open, page, query, retryCount, workspaceId]);

  return Object.freeze({
    response,
    results,
    error,
    isLoading,
    reset: () => {
      setResponse(null);
      setResults([]);
      setPage(1);
      setRetryCount(0);
      setError(null);
      setIsLoading(false);
    },
    loadMore: () => {
      if (!isLoading && response?.hasMore) setPage((current) => current + 1);
    },
    retry: () => setRetryCount((current) => current + 1)
  });
};
