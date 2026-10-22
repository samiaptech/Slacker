# Message search

`POST /messages/search` accepts `{ "query": "..." }` with an optional one-based `page`.
Search text stays in the JSON body rather than the URL so the HTTP access logger does not
record it. Responses use `Cache-Control: no-store` and include a bounded snippet, author,
conversation context, and a stable relevance/recency ordering. The response omits message
bodies, email addresses, totals, and facets.

Search scope is derived only from the authenticated user and selected workspace:
channel messages are limited to channel memberships in that workspace, and direct messages
are limited to conversations where that user is a participant. Workspace access is checked
before search and workspace/channel/conversation access is rechecked before results return.
Public channel discovery does not grant message access.
Archived channels remain searchable to their members.

Plain terms are supported; query syntax is not. Queries are 2–100 Unicode code points and
are normalized to word tokens. Each page contains at most 20 results, at most 20 pages
(400 results) are returned, and Mongo text queries have a two-second execution limit.
Results sort by Mongo text relevance, then message timestamp and ID. The API limits each
authenticated user to 30 requests per rolling minute per API process. At the result cap the
response sets `truncated` so clients can prompt the user to refine the query.

Search uses native MongoDB text indexes on channel and direct message text. There is no
asynchronous index queue or index lag; persisted edits and deletions are reflected by
MongoDB's index maintenance. Run the existing `pnpm run initialize` persistence initializer
against the target database after deploying this change; it installs both text indexes.
Search fails with `message_search_unavailable` if either required index is missing or a
text query times out. It does not return silent partial results if one message collection
is unavailable.

The UI supports debounced searches, loading/error/timeout/retry states, and bounded
load-more. Selecting a result opens its authorized conversation. Jumping directly to an
older matching message and highlighting it in the timeline is not implemented yet.
