# Agent contract for message editing and live chat

This file is the working handoff for the next implementation wave. It defines what backend owns, what Codex owns, and how the message-edit feature must be wired without breaking the app architecture.

## 1. Core rule

Use this pattern for the whole chat system:

- API is the source of truth.
- Socket/WebSocket is for live fan-out only.
- Client reads initial state from API.
- Client receives live updates from socket after API confirms a mutation.
- If socket disconnects, the client rehydrates from API.

This applies to message create, edit, delete, reactions, typing, presence, notifications, and channel updates.

Do not make socket writes the primary app state. Socket is only the live layer after the real mutation already succeeded.

## 2. Ownership split

### Backend owner

Backend owns:

- route definitions
- controller logic
- service rules
- authorization checks
- storage updates and Mongo queries
- stale edit conflict logic
- validation and error mapping
- socket event broadcasting after successful API mutation
- persistence, migrations, and initializer consistency

Relevant backend files:

- [../servers/api/features/channels/routes/channel.route.ts](../servers/api/features/channels/routes/channel.route.ts)
- [../servers/api/features/direct-messages/routes/direct-message.route.ts](../servers/api/features/direct-messages/routes/direct-message.route.ts)
- [../servers/api/features/channels/controllers/channel-message.controller.ts](../servers/api/features/channels/controllers/channel-message.controller.ts)
- [../servers/api/features/direct-messages/controllers/direct-message.controller.ts](../servers/api/features/direct-messages/controllers/direct-message.controller.ts)
- [../servers/api/features/channels/services/channel-message.service.ts](../servers/api/features/channels/services/channel-message.service.ts)
- [../servers/api/features/direct-messages/services/direct-message.service.ts](../servers/api/features/direct-messages/services/direct-message.service.ts)
- [../servers/api/features/channels/integrations/mongo-channel-message.storage.ts](../servers/api/features/channels/integrations/mongo-channel-message.storage.ts)
- [../servers/api/features/direct-messages/integrations/mongo-direct-message.storage.ts](../servers/api/features/direct-messages/integrations/mongo-direct-message.storage.ts)
- [../servers/api/integrations/socket-io/socket-io.ts](../servers/api/integrations/socket-io/socket-io.ts)

### Frontend owner (Codex)

Codex owns:

- message action menus and edit button placement
- inline editor UI and save/cancel behavior
- error states, retry flows, and stale conflict prompts
- optimistic UI handling with safe rollback
- socket subscription for live updated message events
- render of `editedAt` and edited indicators
- page-level message list refresh behavior after API success

Relevant frontend files:

- [../apps/web/features/channels/components/channel-message-item.tsx](../apps/web/features/channels/components/channel-message-item.tsx)
- [../apps/web/features/channels/components/channel-messages.tsx](../apps/web/features/channels/components/channel-messages.tsx)
- [../apps/web/features/direct-messages/components/direct-message-item.tsx](../apps/web/features/direct-messages/components/direct-message-item.tsx)
- [../apps/web/features/direct-messages/components/direct-message-page.tsx](../apps/web/features/direct-messages/components/direct-message-page.tsx)
- [../apps/web/features/conversation-history/](../apps/web/features/conversation-history/)

## 3. Message edit contract

### Routes

Backend must expose these endpoints:

- `PATCH /channels/:channelId/messages/:messageId`
- `PATCH /direct-messages/:conversationId/messages/:messageId`

### Request payload

```json
{
  "text": "updated message text",
  "expectedEditedAt": "2026-10-28T15:00:00.000Z"
}
```

Rules:

- `text` is required.
- `text.trim()` must not be empty.
- `text` max length must be enforced by backend validation.
- `expectedEditedAt` is optional for first edit, but if provided it must match current message `editedAt` or last-known value to prevent stale writes.
- `expectedEditedAt` can be null for the first edit only.
- An omitted `expectedEditedAt` is treated as `null`; it cannot bypass version checks on an edited message.
- Attachment-only messages are not editable. Editing text on a message that also has attachments keeps those attachments.

### Success response

Return the updated message object with:

- same message id
- same senderId
- same createdAt
- same attachments
- same reactions
- `editedAt` set to new timestamp
- `text` replaced with latest saved text

### Error behavior

- `400 validation_error` for empty/blank text, too long text, invalid body
- `401` or `403` for unauthorized update
- `404` for not-found / hidden / privacy-safe not found
- `409 message_edit_conflict` when stale edit is attempted

### Realtime event

After backend successfully updates the message, emit:

- `channel:message:updated`
- `direct-message:updated`

Frontend should update the in-memory message row from the socket event, not from a socket-only mutation.

## 4. Backend implementation requirements

### 4.1 Route and controller

Backend must do the following for both channel and DM flows:

1. Parse route params and request body.
2. Authenticate current user.
3. Validate workspace/channel/conversation membership.
4. Load the message by id.
5. Verify message belongs to the current workspace and is visible.
6. Confirm the current user is the author.
7. Validate `text` and stale-edit condition.
8. Perform update atomically.
9. Return updated message payload.
10. Emit realtime update event after successful write.

### 4.2 Authorization

Do not allow workspace admins to edit another member's message in MVP.

Only the author may edit their own message.

The message must still be protected by channel membership and DM participant validation.

### 4.3 Persistence semantics

The message record must keep:

- original `createdAt`
- updated `editedAt`
- latest `text`
- existing attachments and reactions untouched

Do not overwrite sender, id, createdAt, channelId/conversationId, or message scope.

### 4.4 Conflict handling

If another client already edited the same message, the second save must fail with `409` and frontend must show a conflict message and keep the user's draft intact.

The backend must compare against a stable version token or timestamp field, not just a fuzzy text compare.

### 4.5 Search and retrieval behavior

The latest edited text must be returned in channel/DM history and in message search, because the backend should persist the newest message content as the canonical source. Any search/index behavior must be verified against the actual storage and indexing rules already used by the app.

## 5. Frontend implementation requirements for Codex

### 5.1 Message menu

Add an `Edit message` action only when the sender ID matches the current user.

Do not add admin editing in the MVP.

### 5.2 Inline editor

When user taps edit:

- prefill textarea with current text
- show character count and max length
- allow multiline editing
- `Escape` cancels
- `Ctrl/Cmd+Enter` saves
- `Shift+Enter` adds newline
- block saving when unchanged or blank

### 5.3 Save flow

Frontend should:

- call the backend API
- handle validation errors
- handle conflict errors with an explicit stale edit message
- maintain local draft state and rollback to previous value on failure
- show a small `Edited` label if `editedAt` is present

### 5.4 Realtime update flow

After successful save, the backend emits an update event. Frontend listens for that event and updates the message row in the conversation list.

Frontend must not assume socket-only editing is valid. Socket is only for live synchronization after server confirmation.

## 6. Validation and tests required

Backend must add tests for:

- author can edit their own message
- author cannot edit another member's message
- empty text fails
- stale `expectedEditedAt` fails with 409
- valid edit succeeds and records `editedAt`
- DM edit works
- channel edit works
- realtime event fires after successful update

Frontend should also handle:

- saving state
- error toast or inline error
- rollback on failure
- `editedAt` rendering

## 7. Working guidance for this feature

When working on message edit:

- Backend first: implement API contract and storage update
- Then frontend wiring: show edit action, inline editor, save flow
- Then realtime event consumption and live UI sync
- Then targeted validation tests

Do not mix frontend UI logic into backend storage logic. Keep boundaries clean.

## 8. Current status

The backend edit flow is implemented for channels and one-to-one DMs:

- `PATCH /channels/:channelId/messages/:messageId`
- `PATCH /direct-messages/:conversationId/messages/:messageId`
- Only the author can edit; current channel membership or DM participation is checked at storage.
- Updates atomically compare `expectedEditedAt`, preserve creation time, attachments, and reactions, and set a monotonic `editedAt`.
- Attachment-only messages, blank text, and text over 4,000 Unicode code points are rejected.
- A stale version returns `409 message_edit_conflict`; invalid input returns `400 validation_error`, and non-author edits return `403 message_edit_forbidden`.
- Successful API responses contain the complete updated message and emit `channel:message:updated` or `direct-message:updated` to the authorized conversation room. Edits do not change notification/unread state or conversation ordering.
- Channel and DM initializers must be run after deploying because the strict message validators now accept `editedAt`.

The frontend edit flow is present in `apps/web/features/conversation-history/` and the channel/DM conversation components. API/storage authorization and frontend behavior still need verification against a populated isolated MongoDB deployment; current local validation is recorded in the root handoff.
