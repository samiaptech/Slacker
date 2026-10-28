# One-to-one direct messages

Direct messages let active members of the same workspace start and resume a
private one-to-one conversation. A member pair has one canonical conversation
per workspace; opening it again returns the existing conversation. Group DMs,
blocking, and participant removal are not part of this feature.

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

The initializer also installs `direct_messages_text` for permission-aware
workspace message search. Run it after deployment before enabling search; the
search API fails explicitly while either channel or DM text index is missing.

`DELETE /direct-messages/:conversationId/messages/:messageId` accepts strict
JSON `{ "scope": "me" | "everyone" }` and returns `204 No Content`. Any current
participant can use `me`; the hide persists for that user and filters their
history, message-search results, and attachment downloads without affecting
other participants. `everyone` is allowed to the author or a workspace
administrator, but the requester must still be a participant in that
conversation. Global deletion removes the message and its private Cloudinary
assets and emits `direct-message:deleted` with
`{ "conversationId": "...", "messageId": "..." }` to that conversation room.
Attachment cleanup failure returns `message_delete_cleanup_failed` rather than
success; the error states that the database deletion has already committed, and
the global deletion event is still emitted. Personal hides do not emit a realtime
event; the requesting client removes the message locally and later history
loads remain filtered. Run `direct-messages:initialize` after deploying the
updated strict message validator.

`PATCH /direct-messages/:conversationId/messages/:messageId` accepts strict
JSON `{ "text": "...", "expectedEditedAt": null | "<ISO timestamp>" }` (the
version field may be omitted only for a first edit) and returns the complete
updated message. Only the authenticated author may edit, and the caller must
remain a participant in the selected workspace conversation; workspace admins
cannot edit another member's message. Blank text, text over 4,000 Unicode code
points, and attachment-only messages are rejected. The storage transaction
compares `expectedEditedAt` atomically and changes only `text` and `editedAt`,
preserving creation time, attachments, reactions, and conversation ordering.
Stale edits return `409 message_edit_conflict`, and non-author edits return
`403 message_edit_forbidden`. Successful persistence emits the complete message
as `direct-message:updated` to the authorized conversation room. History,
search, and reconnects use the stored edited text. Run
`direct-messages:initialize` after deployment to install the `editedAt`
validator field.

## Live delivery

Socket.IO authenticates with the same session as channel chat. A client must
first join an authorized workspace room, then prove current conversation
participation before joining a workspace-scoped direct-message room. New
messages and author-only edits are broadcast only after MongoDB persistence
succeeds (`direct-message:new` and `direct-message:updated`). Edits include the
complete canonical message and do not reorder the conversation. Typing updates
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

## Notifications and read state

An incoming message creates one durable `direct_message` notification for the
other participant; the sender is suppressed. Fetching
`GET /direct-messages/:conversationId/messages` marks the caller's notifications
for that conversation read after participant authorization succeeds. The inbox,
unread-count, read endpoints, and `notification:new` / `notification:unread-count`
realtime payloads are documented in the [API README](../../README.md#in-app-notifications).
