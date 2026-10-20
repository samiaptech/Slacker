# One-to-one direct messages

Direct messages let active members of the same workspace start and resume a
private one-to-one conversation. A member pair has one canonical conversation
per workspace; opening it again returns the existing conversation. Group DMs,
blocking, unread state, and participant removal are not part of this feature.

## API and persistence

All endpoints use the signed-in Better Auth identity, the `X-Workspace-Id`
selector, current workspace membership, and `Cache-Control: no-store`:

- `GET /direct-messages` lists the caller's latest 50 conversations.
- `POST /direct-messages` with `{ "recipientId": "..." }` opens or creates the
  canonical pair. The recipient must be another active member of that workspace.
- `GET /direct-messages/:conversationId` returns the other participant's safe
  profile summary.
- `GET /direct-messages/:conversationId/messages` loads a bounded chronological
  page; `before` is an opaque cursor.
- `POST /direct-messages/:conversationId/messages` persists a text message up
  to 4,000 Unicode code points.

The API returns the same not-found response for missing conversations and
conversations the caller cannot access. HTTP workspace access and the service
check that the caller and recipient are current workspace members before
opening a DM. The storage boundary filters every conversation and message
read/write by workspace and participant identity. Conversation pair identity
is a workspace-scoped unique MongoDB index; opening a conversation and
persisting messages use Mongo transactions. Message text is not logged.

Initialize new collections and indexes before enabling the feature:

```text
pnpm --filter @workspace/api direct-messages:initialize
```

The initializer requires MongoDB collection/index privileges. Runtime writes
require read/write privileges and a replica set or sharded cluster that
supports transactions. The collections use strict document validators; the API
returns `direct_message_storage_unavailable` if validators or indexes are
missing or incompatible.

## Live delivery

Socket.IO authenticates with the same session as channel chat. A client must
first join an authorized workspace room, then prove current conversation
participation before joining a workspace-scoped direct-message room. New
messages are broadcast only after MongoDB persistence succeeds. Typing updates
are rate-limited, use the authenticated socket identity, and require an
authorized subscription.

The web sidebar can open a DM from any other current workspace member, lists
recent conversations, and provides message history, pagination, typing state,
and live delivery. On reconnect, the client reauthorizes and reloads persisted
history. Workspace removal clears the active message view and disconnects the
removed member's sockets. Presence and Socket.IO rooms are process-local; use
one API instance until shared Socket.IO/presence infrastructure is configured.

The focused API tests are part of:

```text
pnpm --filter @workspace/api test
```
