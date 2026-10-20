# Channel realtime updates

Socket.IO provides live delivery for channel conversations, one-to-one direct
messages, and workspace membership/list updates. It is a delivery layer only: authenticated HTTP
routes and MongoDB remain the source of truth for messages and membership.

## Runtime and client flow

The API attaches Socket.IO to its existing HTTP server and uses the configured
`WEB_ORIGIN` for credentialed cross-origin connections. The web app connects to
the same API origin configured by `NEXT_PUBLIC_API_BASE_URL`; no separate
realtime service or port is required.

1. The socket handshake resolves the existing Better Auth session using the
   request cookies. Missing identities and unexpected browser origins are
   rejected.
2. The client requests a workspace subscription. The server checks current
   workspace access before joining its room, syncs online users, and sends
   `workspace:ready`.
3. The client requests a channel subscription. The server checks current
   channel membership before joining that workspace-scoped channel room and
   sends `channel:ready`.
4. A message is broadcast only after the HTTP message service successfully
   persists it. Clients merge incoming messages by ID, so a live event and the
   sender's HTTP response cannot create duplicates.
5. On reconnection, the client re-authorizes and rejoins its rooms, then
   reloads the latest persisted message page to recover updates missed while
   disconnected. Older history remains cursor-paginated over HTTP.

The socket protocol is typed in the shared API realtime contracts.

## Event surface

| Direction | Event | Purpose |
| --- | --- | --- |
| Client to server | `workspace:subscribe` | Request authorized workspace updates and presence |
| Client to server | `channel:subscribe` / `channel:unsubscribe` | Join or leave a member-checked channel room |
| Client to server | `channel:typing` | Send a short-lived typing state; identity comes from the socket |
| Server to client | `workspace:ready`, `channel:ready` | Confirm authorized subscriptions |
| Server to client | `channel:message:new` | Deliver a persisted message to channel members |
| Server to client | `channel:members:changed` | Refresh the current channel member list |
| Server to client | `workspace:channels:changed`, `workspace:members:changed` | Refresh workspace lists after successful changes |
| Server to client | `workspace:presence:sync`, `workspace:presence:changed` | Synchronize and update online indicators |
| Server to client | `channel:typing` | Show a member's transient typing state |
| Client to server | `direct-message:subscribe` / `direct-message:unsubscribe` | Join or leave a participant-checked one-to-one DM room |
| Client to server | `direct-message:typing` | Send a short-lived DM typing state |
| Server to client | `direct-message:ready`, `direct-message:new` | Confirm DM subscription and deliver persisted messages |
| Server to client | `direct-message:typing` | Show the other participant's transient typing state |
| Server to client | `workspace:direct-messages:changed` | Refresh the caller's recent DM list |
| Server to client | `channel:access:revoked`, `workspace:access:revoked` | Clear protected UI and remove access after membership changes |
| Server to client | `realtime:error` | Report a rejected subscription or failed realtime action |

Change events contain identifiers and refresh signals, not message text or
email addresses. The client reloads canonical lists over the existing HTTP
endpoints rather than treating socket payloads as authoritative data.

## Authorization and privacy

- Every socket is authenticated at connection time with the existing
  Better Auth identity; clients cannot select or impersonate a sender.
- Workspace subscriptions are authorized using the current workspace access
  service. Channel subscriptions are authorized using current channel
  membership and are scoped to both workspace and channel IDs.
- Typing updates require an existing channel subscription and re-check current
  channel membership. Typing events are rate-limited and never accept a
  client-supplied user ID.
- Direct-message subscriptions require a current workspace subscription and
  current participation in that exact conversation. DM typing rechecks
  participation, uses the authenticated socket identity, and is rate-limited.
- Successful channel or workspace membership changes publish refresh/revocation
  notifications. Channel removal evicts the target's active sockets from that
  channel room; workspace removal notifies and disconnects the target's active
  sockets.
- Message content is delivered only to the authorized channel room after the
  persisted HTTP operation succeeds. Realtime failures are logged without
  message content and surfaced to the client as a recoverable error.
- HTTP message reads and sends continue to enforce current membership and use
  `Cache-Control: no-store`; the socket is not a message-write API.

The Better Auth identity is validated at handshake, not polled continuously.
Membership changes made through the application trigger immediate room
revocation. Session expiration/revocation outside the application and
out-of-band database edits do not currently proactively disconnect sockets.

## Deployment limitations

Presence counts and Socket.IO room delivery currently use process memory. No
Redis adapter or shared presence store is configured, so the deployment
supports a single API instance for consistent presence and broadcasts. There
is no durable event replay; reconnect recovery uses the persisted message
history API. Multi-instance deployment requires shared Socket.IO delivery and
presence infrastructure before it can provide consistent realtime behavior.

## Validation

The API Socket.IO integration tests exercise authenticated handshakes,
workspace/channel/DM authorization, private-channel denial, live messages,
typing, presence, membership/list notifications, and access revocation:

```text
pnpm --filter @workspace/api exec tsx --test integrations/socket-io/tests/channel-realtime.test.ts
pnpm --filter @workspace/api exec tsx --test features/direct-messages/tests/direct-message-realtime.test.ts
```

Also run the API/web typechecks, linters, and workspace checks when changing
the shared event contract or client/server integration.
