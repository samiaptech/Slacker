"use client";

import Link from "next/link";
import type { Route } from "next";
import { Button } from "@workspace/ui/primitives";
import type { MessageSearchResponseView } from "../types/message-search-response";

type SearchResult = MessageSearchResponseView["results"][number];

type SearchMessageResultsProps = Readonly<{
  results: MessageSearchResponseView["results"];
  error: string | null;
  isLoading: boolean;
  hasMore: boolean;
  truncated: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onSelect: (result: SearchResult) => void;
}>;

export const SearchMessageResults = ({
  results,
  error,
  isLoading,
  hasMore,
  truncated,
  onLoadMore,
  onRetry,
  onSelect
}: SearchMessageResultsProps) => (
  <section aria-label="Matching messages">
    <h3 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      Matching messages ({results.length})
    </h3>
    {error ? (
      <div className="flex items-center justify-between gap-3 px-2 py-2">
        <p className="text-sm text-destructive" role="alert">{error}</p>
        <Button onClick={onRetry} type="button" variant="outline">Retry</Button>
      </div>
    ) : null}
    {results.map((result) => {
      const path = result.conversation.type === "channel"
        ? `/channels/${encodeURIComponent(result.conversation.id)}`
        : `/messages/${encodeURIComponent(result.conversation.id)}`;
      return (
        <Link
          className="block rounded-lg px-3 py-2.5 text-sm hover:bg-accent"
          href={path as Route}
          key={`${result.conversation.type}:${result.conversation.id}:${result.id}`}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onSelect(result);
          }}
        >
          <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="truncate">{result.conversation.name} · {result.sender.name}</span>
            <time className="shrink-0" dateTime={result.createdAt}>
              {new Date(result.createdAt).toLocaleDateString()}
            </time>
          </span>
          <span className="mt-1 block line-clamp-2 text-foreground">{result.snippet}</span>
        </Link>
      );
    })}
    {isLoading && results.length === 0 ? (
      <p aria-live="polite" className="px-2 py-4 text-center text-sm text-muted-foreground">Searching messages…</p>
    ) : null}
    {isLoading && results.length > 0 ? (
      <p aria-live="polite" className="px-2 py-2 text-center text-xs text-muted-foreground">Loading more…</p>
    ) : null}
    {hasMore && results.length > 0 ? (
      <Button className="w-full" disabled={isLoading} onClick={onLoadMore} type="button" variant="outline">
        Show more matching messages
      </Button>
    ) : null}
    {truncated ? (
      <p className="px-2 text-xs text-muted-foreground">
        Showing up to 400 matches. Refine your search to find other messages.
      </p>
    ) : null}
  </section>
);
