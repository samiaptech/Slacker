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
When a channel message explicitly mentions a member, that member receives `mention`
instead of a second `channel_message` notification. Mentions use the stable-ID syntax
`@[user-id]`; only current channel members matching an ID are notified.

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
`pnpm --filter @workspace/api channels:initialize` for the typed channel-history validator
change. These are explicit migrations; API startup does not run them. No initializer was
run as part of this change. The root `pnpm run initialize` command now runs both migrations
as part of the complete workspace setup. Missing notification migration/storage returns HTTP 503
(`internal_error`); malformed page/read inputs return 400 (`validation_error`), unauthenticated
requests return 401, and inaccessible notification IDs return 404 (`route_not_found`).
