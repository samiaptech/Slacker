# Profile image upload

`POST /profile/image` lets any signed-in Better Auth user add or replace their own profile
picture. It is an account setting and does not require a workspace header or an administrator
role. Send one multipart file in the `file` field:

```http
POST /profile/image
Content-Type: multipart/form-data

file=<image>
```

The endpoint accepts JPEG (`.jpg`/`.jpeg`), PNG (`.png`), and WebP (`.webp`) files up to
5 MiB. The server checks the filename extension, declared MIME type, and file signature
before upload. It stores a public, HTTPS Cloudinary image URL in the signed-in Better Auth
user's `image` field and returns `200 { "image": "https://res.cloudinary.com/..." }`. The
URL contains no provider credentials and can be used by existing member-profile surfaces.
Cloudinary uploads use generated asset IDs and never use the supplied filename as a public
asset identifier.

Responses use `Cache-Control: no-store`. Stable failures are:

- `401 unauthenticated` when there is no valid Better Auth session.
- `400 validation_error` for a missing file, unexpected multipart field/count, unsupported
  image type, or invalid file signature; `error.details.reason` identifies the cause.
- `413 validation_error` with `error.details.reason: "file_too_large"` above 5 MiB.
- `503 profile_image_storage_unavailable` when Cloudinary is not configured or unavailable.
- `500 profile_image_update_failed` if Better Auth cannot persist the uploaded image; the
  new Cloudinary asset is cleaned up when possible.

No MongoDB migration or initializer is required: the endpoint updates the existing Better
Auth user `image` field. Configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
`CLOUDINARY_API_SECRET` for uploads. The web application's current Content Security Policy
allows `self`, data/blob images, and Google profile images but not Cloudinary; the frontend
must allow `https://res.cloudinary.com` in `img-src` before these URLs render in-browser.

# API request limits

Every request that proceeds past the existing CORS middleware—including `/health`,
authentication, and unknown routes—uses a shared MongoDB-backed limit of 120 requests per
client IP per rolling minute. CORS handles `OPTIONS` requests before limiting; no other
route is excluded. Rejections return HTTP 429 and `Retry-After`. If MongoDB cannot enforce
the limit, the API returns HTTP 503 rather than failing open.

On Vercel, client IPs are read only from the platform-provided
`x-vercel-forwarded-for` header while `VERCEL=1`; Vercel documents it as the platform's
client-IP value and notes that generic `x-forwarded-for` may be overwritten to prevent
spoofing. Other deployments use the direct socket address. The generic
`x-forwarded-for` header is never trusted.
Rate-limit storage keys are SHA-256 hashes, not raw IP addresses or message-search queries.

Message search has an additional 30-requests-per-authenticated-user rolling-minute limit.
It shares the same MongoDB storage and returns the existing search-specific 429 response.

# Persistent message reactions

Authenticated channel members and direct-message participants can toggle one of the shared
emoji allowlist entries:

```http
POST /channels/:channelId/messages/:messageId/reactions
X-Workspace-Id: workspace-id
Content-Type: application/json

{ "emoji": "👍" }
```

For direct messages, use
`POST /direct-messages/:conversationId/messages/:messageId/reactions`. A successful
toggle returns `200` with `Cache-Control: no-store`:

```json
{
  "messageId": "message-id",
  "reactions": [{
    "emoji": "👍",
    "count": 2,
    "users": [{ "id": "user-id", "name": "Member", "image": null }],
    "usersTruncated": false,
    "reactedByMe": true
  }]
}
```

Counts are exact; at most 10 user identities are returned per emoji, with
`usersTruncated` indicating that the identity list was capped. Message history and send
responses include the same reaction summaries. Unsupported emoji returns
`400 validation_error`; missing, hidden, or inaccessible messages return 404. Channel
storage rechecks active channel membership, and DM storage rechecks conversation
participation, inside the persistence transaction.

Each user can have at most one active emoji reaction on a given message. Selecting a
different emoji replaces that user's previous reaction; selecting the already-active emoji
removes it. Other users' reactions are unaffected. A partial unique index enforces this
invariant under concurrent requests. Initialization keeps the most recently updated active
reaction for each user/message pair and deactivates older duplicates before creating that
index.

Successful toggles publish `channel:message:reactions` to the channel room or
`direct-message:reactions` to the DM room. Reactions are stored in the shared
`message_reactions` collection. “Delete for everyone” removes the associated reactions;
“Delete for me” only hides that message from the requesting user's history.

The existing `channels:initialize` and `direct-messages:initialize` commands both
initialize/update the shared reaction collection and its indexes, including the one-active-
reaction constraint. The root
`pnpm run initialize` runs them sequentially. API startup does not run schema migrations;
run the root initializer against the intended database before deployment.

# Realtime session lifecycle

Socket.IO validates the Better Auth session during the connection handshake and revalidates
it every 30 seconds. Expired or revoked sessions, changed user identities, and session-store
errors disconnect the socket. Workspace removal also revokes the user's realtime access.
Logout and session expiry are therefore enforced on established sockets within the next
revalidation interval, not synchronously at the moment the session changes. The handshake
requires an exact `Origin` match with `WEB_ORIGIN`; missing and untrusted origins are rejected.

Each API process limits each user to five concurrent sockets and each client IP to 20
concurrent sockets. It accepts at most 30 inbound Socket.IO events per user per second
(token bucket) and caps packets at 16 KiB. Exceeding a connection or event limit rejects
the connection or disconnects the client. Connection and event counters are process-local,
so they are per API instance, reset on restart, and not globally coordinated across Vercel
instances. Vercel client IPs use the platform-provided header only in Vercel runtime.
Chat message sends use HTTP, not Socket.IO; they remain subject to the API-wide per-IP
limit, not a separate per-user send quota.

# Browser security headers

API responses, including errors and CORS preflights, set a restrictive API-only Content
Security Policy, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, and
`Cross-Origin-Resource-Policy: same-origin`. The web app generates a per-request nonce
Content Security Policy and sets the matching headers in [proxy.ts](../../apps/web/proxy.ts).

Better Auth is configured to use secure cookies in production; its cookies are HttpOnly by
default. The app does not load third-party scripts, so Subresource Integrity has no
third-party script or stylesheet to protect. If one is added, pin it with an integrity
hash and `crossorigin` before release.

# In-app notifications

Notifications are durable and scoped to the authenticated user. They contain event
metadata only; message bodies are not copied into the inbox. The actor never receives a
notification for their own action. A single `(recipientId, eventId)` can be stored once.
The composer can load mention candidates with authenticated
`GET /channels/:channelId/mention-members`. The response is
`{ "members": [{ "id": "user-id", "name": "Member", "image": null }] }`;
it includes only current members of that channel and deliberately excludes email addresses.
The endpoint works for public and private channels, returns `Cache-Control: no-store`, and
conceals missing channels and non-member access. Clients can fetch once when opening the
composer and filter the channel-member list locally rather than making a request
for every keystroke.
When a channel message explicitly mentions a member, that member receives `mention`
instead of a second `channel_message` notification. Mentions use the stable-ID syntax
`@[user-id]`; only current channel members matching an ID are notified.
After a member is selected, the client stores the member ID in that token while rendering
the member's display name. The existing message-send endpoint persists the token as message
text, and the notification service extracts it after persistence. Unknown IDs, IDs from
another channel, duplicate tokens, and the actor do not create extra mention notifications.

Members can read and update their own per-channel notification setting through
`GET /channels/:channelId/notification-preference` and
`PATCH /channels/:channelId/notification-preference`. The PATCH body is
`{ "preference": "all" | "mentions_only" | "muted" }`; both endpoints return the selected
preference in the same shape. Access requires current workspace access and channel
membership, including for private channels. A missing or inaccessible channel returns 404,
invalid input returns 400, unauthenticated requests return 401, and storage readiness
failures return 503. Responses use `Cache-Control: no-store`.

`all` receives channel message, explicit mention, and channel activity notifications;
`mentions_only` receives only explicit `@[user-id]` mention notifications; `muted` receives
none of those notifications, including mentions. Direct-message notifications are unaffected.
Existing notifications are retained and are not reclassified when a preference changes;
the setting applies to notifications created after the change. Memberships without the
optional preference field (including legacy records) default to `all`.

Channel threads create `channel_thread_reply` notifications for current thread
participants and explicitly mentioned current channel members. Thread notifications carry
`threadRootId` alongside the channel resource so clients can deep-link to the thread. They
respect the same per-channel preference as messages; opening the channel history marks
channel-level notifications read, while opening a thread marks only that thread's reply
notifications read.

`GET /notifications?limit=30&before=<cursor>` returns the caller's newest notifications,
across workspaces, with a maximum page size of 100:

```json
{
  "notifications": [{
    "id": "message-id:user-id",
    "eventId": "message-id",
    "type": "channel_message",
    "workspaceId": "workspace-id",
    "resource": { "type": "channel", "id": "channel-id" },
    "actor": { "id": "actor-id", "name": "Actor" },
    "createdAt": "2026-10-26T09:00:00.000Z",
    "readAt": null
  }],
  "nextCursor": null
}
```

Types are `channel_message`, `direct_message`, `mention`, `channel_member_joined`,
`channel_member_left`, and `channel_updated`. `GET /notifications/unread-count` returns
`{ "unreadCount": 3 }`. `PATCH /notifications/:notificationId/read` marks one notification
read and returns `{ "markedRead": true }`; a missing or another user's ID returns 404.
`PATCH /notifications/read` accepts
`{ "type": "channel" | "direct_message", "id": "resource-id" }` and marks that
resource's notifications read. All responses use `Cache-Control: no-store`.

Opening a channel or DM is defined as the authenticated
`GET /channels/:channelId/messages` or
`GET /direct-messages/:conversationId/messages` history request. After the existing
membership/participant checks pass, the API marks all notifications for that resource
read and emits the updated count. Merely listing channels or conversations does not mark
their notifications read.

Authenticated Socket.IO connections are placed in a private per-user room. The API emits
`notification:new` only to the recipient's room:

```json
{
  "notification": {
    "id": "message-id:user-id",
    "eventId": "message-id",
    "recipientId": "user-id",
    "type": "mention",
    "workspaceId": "workspace-id",
    "resource": { "type": "channel", "id": "channel-id" },
    "actor": { "id": "actor-id", "name": "Actor" },
    "createdAt": "2026-10-26T09:00:00.000Z",
    "readAt": null
  }
}
```

`notification:unread-count` carries `{ "unreadCount": 3 }` to that same user room after
creation or read changes. Notification events use the configured MongoDB Socket.IO
adapter, so cross-instance delivery follows the existing realtime deployment model.

Channel membership joins, invites, self-leaves, and admin removals create activity
notifications for members who retain access after the change. Channel metadata changes
use `PATCH /channels/:channelId` with a strict JSON body containing `name`, `description`
(string or null), and `visibility` (`public` or `private`); only channel admins can update
it. Successful updates notify other current channel members as `channel_updated`.

A successful self-leave atomically deletes the membership and appends a typed system entry
to `channel_messages`; it is not a user-authored message and has no `senderId` or `sender`:

```json
{
  "id": "departure-id",
  "channelId": "channel-id",
  "type": "system",
  "systemEvent": "member_left",
  "actor": { "id": "user-id", "name": "Member" },
  "text": "",
  "createdAt": "2026-10-26T09:00:00.000Z"
}
```

History includes this entry in chronological order, and the API sends it to the remaining
channel room members as `channel:system:new`. Regular channel history responses now include
`"type": "message"`; clients should branch on `type` rather than assume every entry has a
sender. The message validator update is installed by the existing channel initializer.

Before deployment, run `pnpm --filter @workspace/api notifications:initialize` against the
intended MongoDB to create/update `user_notifications` and its validator/indexes. Also run
`pnpm --filter @workspace/api channels:initialize` to install channel membership and
typed channel-history validators, including the optional notification preference field.
These are explicit migrations; API startup does not run them. No initializer was run as
part of this change. The root `pnpm run initialize` command runs both migrations as part of
the complete workspace setup. Missing notification migration/storage returns HTTP 503
(`internal_error`); malformed page/read inputs return 400 (`validation_error`), unauthenticated
requests return 401, and inaccessible notification IDs return 404 (`route_not_found`).

# API tests

Run the API suite with `pnpm --dir servers/api test`. Jest runs the TypeScript test files
serially; a compatibility adapter preserves the existing `node:test` declarations and
strict deep-equality assertions across Jest's VM realms. The two MongoDB replica-set
integration tests run only when `MONGODB_TEST_URI` targets an isolated database named
`nutshyll_test_<name>`. Legacy nested subtests execute sequentially within their parent Jest
test, so their assertions still fail the suite but are reported under the parent test.
