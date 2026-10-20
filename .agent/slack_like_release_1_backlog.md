# Slack-Like Collaboration Platform --- Release 1 Backlog

## Agent-ready specification for Codex

**Status:** Proposed baseline for Release 1\
**Product scope:** Channels and conversations, direct messaging,
messaging tools, search and message history\
**Quality bar:** Production-minded implementation, not a UI-only
prototype\
**Audience:** Product owner, engineering team, and Codex coding agent

------------------------------------------------------------------------

# 0. Instructions for Codex

Treat this document as the source of truth for the first release unless
the repository contains a documented, approved architectural decision
that conflicts with it. Before changing code:

1.  Inspect the repository, package manager, framework, existing
    conventions, architecture rules, test commands, environment
    configuration, and CI pipeline.
2.  Produce a short implementation plan mapped to the epics and stories
    below. Identify existing capabilities that can be reused and gaps
    that must be implemented.
3.  Do not replace established architecture or introduce a second
    implementation of an existing capability.
4.  Keep domain logic out of UI components and transport handlers. Use
    the repository's established module/bounded-context conventions.
5.  Implement in dependency order. Do not mark a story complete merely
    because the happy path works.
6.  Add and run tests for each acceptance criterion. Include
    authorization, failure, duplicate request, concurrency, and boundary
    cases where applicable.
7.  Do not claim a check passed unless it was actually run and its
    result was observed. Report commands, outcomes, and unresolved
    blockers.
8.  Do not silently weaken an acceptance criterion, skip a test, invent
    environment secrets, or substitute mock-only behavior for required
    production behavior.
9.  Keep migrations, configuration, API contracts, and user-facing
    behavior aligned. Update docs when behavior or operational
    requirements change.
10. Prefer small, reviewable changes. After each story, report files
    changed, design decisions, tests run, results, and remaining risks.

## Product principles

-   A workspace is the tenant/security boundary. Every read and write
    must be scoped to a workspace and authenticated principal.
-   Channel visibility, conversation membership, and message visibility
    must be enforced server-side, not merely hidden in the UI.
-   Persist a message before reporting it as successfully sent.
    Real-time delivery is a delivery mechanism, not the system of
    record.
-   Retried commands and reconnects must not create duplicate messages
    or duplicate side effects when an idempotency key is supplied.
-   Search must never reveal content the requesting user is not
    authorized to read.
-   Use cursor-based pagination for message timelines and search results
    where possible; avoid loading entire histories into memory.
-   Keep message creation, editing, deletion, reactions, membership
    changes, and search indexing consistent and observable.
-   Use UTC for persisted timestamps and render them in the user's
    locale/time zone.
-   Do not log passwords, access tokens, session cookies, private
    message bodies, or attachment contents.
-   Support keyboard navigation, accessible names, visible focus, and
    responsive layouts.
-   No secret, provider credential, storage credential, or production
    endpoint should be hard-coded or committed.
-   Prefer simple, well-defined abstractions over speculative
    microservices. Keep bounded contexts modular even if the first
    deployment is a monolith.

## Scope boundaries

### Included in Release 1

-   Public and private channels
-   Channel membership, descriptions/topics, joining/leaving, and member
    management
-   One-to-one DMs and group DMs
-   Real-time message delivery and reconnect/retry behavior
-   Plain-text and safely rendered rich-text/Markdown subset (choose one
    supported format and document it)
-   Message edit/delete, replies/threads, emoji reactions, @mentions,
    pinned messages, and unread state
-   File attachments with safe upload/download authorization
-   Search across accessible messages, with filters and pagination
-   Conversation/message history, loading older messages, and unread
    navigation
-   Notifications needed for mentions/new messages, at least in-app
-   Security, automated tests, observability, performance checks,
    deployment configuration, and operational documentation

### Explicitly out of scope unless separately approved

-   Voice/video calls and screen sharing
-   AI summaries or AI chat
-   Workflow automation builder
-   External app integrations
-   Public guest access or federation between organizations
-   End-to-end encryption (do not claim it; transport and at-rest
    controls are not E2EE)
-   Enterprise compliance features beyond basic audit/security events
-   Full mobile native applications
-   Advanced message scheduling, polls, canvases, or project task
    management

------------------------------------------------------------------------

# 1. Release Definition and Dependency Order

## Release 1 outcome

A signed-in workspace member can create or join a permitted channel,
communicate in channels and direct conversations, use core message
tools, return to previous conversations, and search content they are
allowed to access. The system remains correct across refreshes,
concurrent actions, reconnects, and unauthorized requests.

## Suggested implementation order

1.  **Foundation prerequisites:** authentication/principal resolution,
    workspace context, membership/authorization policy, persistence
    conventions, API error contract, real-time transport, test fixtures.
2.  **Epic A --- Channels & Conversations**
3.  **Epic B --- Direct Messaging**
4.  **Epic C --- Messaging Tools** (basic message persistence/delivery
    is needed first; threads/reactions/mentions/attachments follow)
5.  **Epic D --- Search & Message History**
6.  **Release hardening:** cross-epic integration tests,
    load/performance checks, security review, dashboards/alerts,
    deployment and rollback rehearsal.

If a prerequisite already exists, verify it with tests rather than
rebuilding it. If a prerequisite is absent, create a tracked enabling
task before dependent stories.

------------------------------------------------------------------------

# 2. Shared Domain and Architecture Contracts

## 2.1 Core concepts

-   **Workspace:** Tenant boundary. A user can belong to multiple
    workspaces.
-   **WorkspaceMember:** A user's membership and role in a workspace. Do
    not infer workspace authorization solely from a user ID.
-   **Channel:** A workspace conversation container. Has a visibility
    mode: public or private.
-   **ChannelMembership:** Relationship between a user and a channel,
    including membership state and relevant timestamps.
-   **Conversation:** A direct conversation. It has a type: direct (two
    participants) or group direct message (three or more participants).
    Channel messages are not DMs.
-   **ConversationParticipant:** Membership of a user in a direct
    conversation.
-   **Message:** Persisted content authored by a principal in a channel
    or direct conversation. A message must have exactly one valid parent
    target.
-   **MessageRevision/Audit record:** Optional or required according to
    the chosen retention policy; at minimum record edited/deleted
    metadata and enforce ownership/permissions.
-   **Thread:** A root message and its replies. A reply references a
    root/parent message in the same conversation target.
-   **Reaction:** A user's reaction to a message, uniquely constrained
    by message + user + emoji.
-   **Attachment:** Metadata for an uploaded object. Binary data lives
    in object storage, not in the primary message row/document.
-   **Mention:** A parsed reference to a user or supported group;
    mention notifications must be authorized and deduplicated.
-   **Search document/index:** A derived representation of persisted
    content. It is never the authorization source of truth.
-   **Read state:** Per-user, per-conversation last-read position or
    equivalent cursor, plus unread indicators.

Use the repository's domain language and naming conventions if
equivalent concepts already exist.

## 2.2 Invariants

1.  Every channel and direct conversation belongs to exactly one
    workspace.
2.  A channel message must reference exactly one channel and no direct
    conversation; a DM must reference exactly one direct conversation
    and no channel.
3.  The author must be an active workspace member and must be allowed to
    post to the target conversation at command time.
4.  Private channel content is visible only to current authorized
    channel members and appropriately authorized administrators under
    the documented policy.
5.  DM content is visible only to participants and explicitly authorized
    operational/admin access under a documented policy; do not create
    hidden backdoors.
6.  A user cannot add themselves to a private channel without an
    invitation or permitted administrative action.
7.  A user cannot read a message, attachment, thread, reaction list, or
    search result merely by guessing its ID.
8.  A deleted message cannot be returned as ordinary active content; if
    a tombstone is shown, it must follow a consistent policy.
9.  Message order must be deterministic, using a stable
    cursor/tie-breaker when timestamps match.
10. A reaction from the same user with the same emoji on the same
    message is unique.
11. Search indexing is asynchronous/derived if needed, but results must
    be permission-filtered and stale/deleted content must not leak.
12. Notifications and event consumers must be idempotent.
13. All persistence access must follow the repository's approved
    gateway/repository/data-access boundaries.
14. User-facing errors must not disclose whether a private channel, DM,
    or inaccessible message exists when that disclosure would leak
    information.
15. Server-side authorization is required on every API and real-time
    event path.

## 2.3 API and real-time contract expectations

Adapt route naming to repository conventions; document the final API
contract (OpenAPI or equivalent).

Every mutation should: - Authenticate the request and resolve the
principal. - Resolve workspace context from a trusted source and verify
workspace membership. - Validate input shape, lengths, enums,
identifiers, and target membership. - Authorize the action against
current server-side state. - Apply persistence constraints/transaction
rules. - Emit a durable domain event or outbox record where the
architecture requires reliable downstream effects. - Return a stable
response/error shape. - Emit structured telemetry without private
message bodies or secrets.

Real-time transport must: - Authenticate the socket/connection. -
Authorize room/channel/conversation subscription server-side. -
Revalidate membership when permissions change, and remove revoked users
from rooms. - Deliver persisted events with stable IDs. - Support
reconnect and resynchronization from a cursor/last-seen event ID. -
Avoid treating a socket acknowledgement as proof that data was durably
stored unless persistence succeeded. - Apply payload validation, size
limits, rate limits, and backpressure.

## 2.4 Error contract

Use consistent, documented error categories, for example: -
`UNAUTHENTICATED` - `FORBIDDEN` (or a privacy-preserving `NOT_FOUND`
where appropriate) - `VALIDATION_ERROR` - `CONFLICT` - `RATE_LIMITED` -
`NOT_FOUND` - `PROVIDER_UNAVAILABLE` (where relevant) - `INTERNAL_ERROR`

Never return stack traces or database details to end users. Log a
correlation/request ID for troubleshooting.

------------------------------------------------------------------------

# 3. Epic A --- Channels & Conversations

## Epic goal

Workspace members can discover and use public channels, participate in
private channels when authorized, and manage channel membership and
metadata without crossing workspace or privacy boundaries.

## Epic-level definition of done

-   Channel CRUD and membership policies are enforced server-side.
-   Public/private visibility behavior is consistent in lists, search,
    message history, APIs, and real-time subscriptions.
-   All acceptance criteria below have automated coverage.
-   Concurrency, duplicate requests, invalid identifiers, and
    cross-workspace access are tested.
-   Channel and membership events are observable and do not leak
    content.
-   User interface includes loading, empty, error, success, and
    permission-denied states.
-   API and domain documentation are updated.

------------------------------------------------------------------------

## Story A1 --- Create a channel

**User story:** As an authorized workspace member, I want to create a
channel with a name and visibility so that my team can organize
conversations around a topic.

### Acceptance criteria

-   AC1: An authenticated active workspace member can create a channel
    with a valid name and visibility.
-   AC2: Channel names are normalized consistently (document case and
    allowed characters), validated for length, and unique according to
    the chosen workspace naming policy.
-   AC3: Required fields and invalid values return a validation error;
    no partial channel is created.
-   AC4: Creator membership/ownership behavior is explicit and atomic:
    if the creator should become a member/admin, channel and membership
    are committed together.
-   AC5: The creator can see and open the new channel immediately after
    success.
-   AC6: A non-member/non-workspace user cannot create a channel in that
    workspace.
-   AC7: Duplicate/retried create requests do not create duplicate
    channels when an idempotency key is used.
-   AC8: Concurrent attempts to create the same normalized name resolve
    deterministically; only the allowed unique result succeeds.
-   AC9: Public/private visibility is persisted and returned
    consistently.
-   AC10: Creation emits a safe structured audit/domain event with
    actor, workspace, channel ID, and outcome, not private message
    content.

### Tasks and subtasks

**A1-T1 --- Define channel domain contract** - A1-T1-S1: Define channel
fields, visibility enum, lifecycle state, and normalization rules. -
A1-T1-S2: Define creator membership/role behavior and whether a channel
can be archived rather than deleted. - A1-T1-S3: Define name uniqueness
scope and database constraint. - A1-T1-S4: Define create-channel
command, result, and domain errors.

**A1-T2 --- Implement persistence and constraints** - A1-T2-S1:
Add/update channel schema/table and indexes. - A1-T2-S2: Add workspace
foreign key/reference and appropriate integrity constraints. - A1-T2-S3:
Add unique constraint/index for normalized name within workspace,
respecting the naming policy. - A1-T2-S4: Implement repository/gateway
methods; do not expose raw persistence access to UI/domain consumers. -
A1-T2-S5: Add migration and migration rollback/recovery notes where
supported.

**A1-T3 --- Implement create use case and API** - A1-T3-S1: Validate
principal and workspace membership. - A1-T3-S2: Validate and normalize
request data. - A1-T3-S3: Persist channel and initial membership
atomically. - A1-T3-S4: Implement idempotency/concurrency behavior. -
A1-T3-S5: Return the documented response and stable error codes. -
A1-T3-S6: Document endpoint and authorization requirements.

**A1-T4 --- Build channel creation UI** - A1-T4-S1: Add create-channel
entry point and accessible dialog/form. - A1-T4-S2: Add name,
visibility, and optional description fields. - A1-T4-S3: Display
field-level validation and server errors. - A1-T4-S4: Prevent accidental
double submission and show progress. - A1-T4-S5: Navigate to the channel
after successful creation.

**A1-T5 --- Verify A1** - A1-T5-S1: Unit-test name normalization,
validation, and domain rules. - A1-T5-S2: Integration-test successful
create and creator membership. - A1-T5-S3: Test duplicate name,
concurrent create, retry, and rollback behavior. - A1-T5-S4: Test
unauthenticated, non-member, and cross-workspace requests. - A1-T5-S5:
Test UI success, validation, loading, and error states.

**Status: COMPLETE (2026-10-13).** Verification: `pnpm --filter @workspace/api test`
(39 passed); `pnpm --filter @workspace/web test` (12 passed); API and web
typechecks; API and web lint; and `pnpm run check`. Concurrency and rollback
cases use deterministic repository tests; no live concurrent writes were run
against MongoDB.

------------------------------------------------------------------------

## Story A2 --- Browse and discover channels

**User story:** As a workspace member, I want to browse channels I can
access and discover public channels so that I can join relevant
conversations.

### Acceptance criteria

-   AC1: Channel list is scoped to the active workspace.
-   AC2: Public channels are discoverable to active workspace members
    according to the product policy.
-   AC3: Private channels appear only to authorized members/invitees and
    are not disclosed by search, counts, or error messages to
    unauthorized users.
-   AC4: List supports stable pagination or bounded loading; it does not
    load every channel for large workspaces.
-   AC5: List can be sorted predictably (for example, recent activity or
    name) and documents its default.
-   AC6: Archived/deleted channels are handled according to the
    lifecycle policy.
-   AC7: Loading, empty, error, and retry states are present.
-   AC8: Direct API requests cannot retrieve unauthorized channel
    details.

### Tasks and subtasks

**A2-T1 --- Define channel query model** - A2-T1-S1: Define list
filters, sort order, cursor, and page size limits. - A2-T1-S2: Define
public/private visibility predicates in a reusable authorization
policy. - A2-T1-S3: Define channel list response fields; avoid exposing
unnecessary member data.

**A2-T2 --- Implement channel queries** - A2-T2-S1: Implement
workspace-scoped list query through repository/gateway. - A2-T2-S2:
Apply visibility and membership filtering server-side. - A2-T2-S3: Add
indexes for workspace, visibility, membership, and supported sort. -
A2-T2-S4: Implement stable cursor pagination and invalid-cursor
handling. - A2-T2-S5: Exclude archived/deleted records according to
policy.

**A2-T3 --- Build channel browser UI** - A2-T3-S1: Add channel
list/navigation section. - A2-T3-S2: Separate joined channels from
discoverable public channels if that matches UX. - A2-T3-S3: Add
search/filter within the channel directory if needed, without confusing
it with message search. - A2-T3-S4: Add loading, empty, error, retry,
and pagination states. - A2-T3-S5: Ensure keyboard and screen-reader
accessibility.

**A2-T4 --- Verify A2** - A2-T4-S1: Test workspace isolation and
private-channel non-disclosure. - A2-T4-S2: Test cursor ordering, page
boundaries, and duplicate/missing records across pages. - A2-T4-S3: Test
archived/deleted channel behavior. - A2-T4-S4: Test UI empty, loading,
retry, and accessibility basics.

**Status: IN PROGRESS (2026-10-13).** Implemented the joined/discoverable
query model, scope-bound name cursor (25 default, 50 maximum), workspace
and visibility filters, pagination metadata, public-channel browse UI,
and channel browsing migration index. API tests cover cursor validation,
private-channel exclusion, pagination, and authorization. Remaining:
live MongoDB replica-set tests now cover browse pagination, workspace
isolation, and archived/private channel exclusion. Validation:
`pnpm --filter @workspace/api test` with `MONGODB_TEST_URI` set to a
`nutshyll_test_*` replica-set database (92 passed); API typecheck and lint;
and `pnpm run check` (no issues). Component-level tests for
browse/loading/empty/retry interactions remain before marking A2 complete.

------------------------------------------------------------------------

## Story A3 --- Join and leave public channels

**User story:** As a workspace member, I want to join or leave public
channels so that I control which team discussions appear in my channel
list.

### Acceptance criteria

-   AC1: An active workspace member can join an eligible public channel.
-   AC2: Joining a private channel through the public join endpoint is
    rejected.
-   AC3: Joining an already-joined channel is idempotent and does not
    create duplicate membership.
-   AC4: A user, including the last channel administrator, can leave a
    channel they belong to; the channel and remaining memberships persist.
-   AC5: Leaving does not delete channel messages or remove other
    members.
-   AC6: Membership changes update the user's channel list and real-time
    subscription authorization.
-   AC7: Non-members cannot access channel history simply by guessing
    the channel ID unless public-read policy explicitly permits it; the
    policy must be consistent and documented.
-   AC8: Concurrent join/leave requests preserve one valid membership
    state.
-   AC9: Membership changes emit auditable events.

### Tasks and subtasks

**A3-T1 --- Define membership lifecycle** - A3-T1-S1: Define membership
states and whether leave is hard removal or inactive membership. -
A3-T1-S2: Define the no-admin-after-leave policy and channel
deletion/archive behavior. - A3-T1-S3: Define whether public channel
history is readable before joining; apply the same rule across API,
search, and sockets.

**A3-T2 --- Implement join/leave use cases** - A3-T2-S1: Implement join
with workspace and public-channel authorization. - A3-T2-S2: Implement
leave with membership checks, allowing the channel to have no admins. - A3-T2-S3: Enforce unique
channel/user membership. - A3-T2-S4: Make repeated commands
idempotent. - A3-T2-S5: Emit membership events and update subscription
permissions.

**A3-T3 --- Build join/leave UX** - A3-T3-S1: Add Join button for
eligible public channels. - A3-T3-S2: Add Leave action with confirmation
if losing access/history is consequential. - A3-T3-S3: Update navigation
and channel state after success. - A3-T3-S4: Show actionable errors for
private channels, archived channels, and unavailable requests.

**A3-T4 --- Verify A3** - A3-T4-S1: Test join/leave success, repeat
calls, and concurrent requests. - A3-T4-S2: Test private-channel
rejection and workspace-member enforcement. - A3-T4-S3: Test last-admin
departure, retention of remaining members, and historical message retention. - A3-T4-S4: Test that sockets
and history access are revoked/updated correctly after leaving.

**Status: IN PROGRESS (2026-10-13).** Implemented transactional public-channel
join and membership removal, idempotent repeats, last-admin departure with
channel data and remaining membership preserved,
auditable membership events, authenticated API endpoints, and sidebar join/leave
actions with confirmation and state refresh. Authenticated Socket.IO updates
now refresh workspace channel lists and revoke access to a channel room when
membership is removed. Membership removal preserves the channel and remaining
members, including when its last admin leaves; channel details remain
member-only, including for discoverable public channels.
Validation: `pnpm --filter @workspace/api test` with `MONGODB_TEST_URI` set
to a `nutshyll_test_*` replica-set database (92 passed), including live
MongoDB membership, concurrent-join, leave, and message-retention checks;
API typecheck and lint; and `pnpm run check` (no issues). Remaining: test UI
interaction states and run final validation of the realtime implementation.

------------------------------------------------------------------------

## Story A4 --- Invite members to private channels and manage channel membership

**User story:** As a permitted channel manager, I want to invite and
remove members from a private channel so that sensitive conversations
remain limited to the right people.

### Acceptance criteria

-   AC1: Only an authorized channel manager/admin can invite or remove
    members under the documented role policy.
-   AC2: Only active workspace members can be added unless a separate
    guest feature is explicitly implemented.
-   AC3: Private channel details and history are not exposed to invitees
    until membership is committed.
-   AC4: Duplicate invitations/adds do not create duplicate memberships
    or duplicate notifications.
-   AC5: Removing a member revokes HTTP/API access promptly and removes
    that member's active sockets from the private-channel room.
-   AC6: Removing a member does not delete prior messages or alter their
    authorship.
-   AC7: An admin cannot be removed by another member; an admin may
    voluntarily leave even if they are the last admin, preserving the
    channel and remaining memberships (per product decision).
-   AC8: Every membership change records actor, target, channel,
    timestamp, and outcome without logging message content.
-   AC9: Unauthorized attempts return a consistent privacy-safe error.

### Tasks and subtasks

**A4-T1 --- Define channel roles and policy** - A4-T1-S1: Define
workspace role versus channel-level role and precedence. - A4-T1-S2:
Define who can invite, remove, rename, archive, and pin. - A4-T1-S3:
Define admin removal and last-admin voluntary departure.

**A4-T2 --- Implement member management** - A4-T2-S1: Implement member
list scoped to authorized viewers. - A4-T2-S2: Implement invite/add
member command. - A4-T2-S3: Implement remove member command. - A4-T2-S4:
Enforce active workspace membership and duplicate constraints. -
A4-T2-S5: Revoke channel rooms and re-check membership on subscription and
typing events. - A4-T2-S6: Emit audit/domain events and
deduplicated notifications when notifications exist.

**A4-T3 --- Build membership management UI** - A4-T3-S1: Add channel
member list. - A4-T3-S2: Add invite-member flow with validation. -
A4-T3-S3: Add remove-member confirmation and permission-aware
controls. - A4-T3-S4: Handle stale membership state and server-side
authorization failures.

**A4-T4 --- Verify A4** - A4-T4-S1: Test roles and permission matrix. -
A4-T4-S2: Test invite duplicates, inactive users, and cross-workspace
users. - A4-T4-S3: Test immediate revocation for HTTP and realtime access.
- A4-T4-S4: Test admin-removal protection and audit
event contents.

**Policy decision:** Channel admins may invite existing accounts only
when the target already belongs to the same workspace. People who are not
workspace members join through a reusable workspace invite link.
Admins may remove regular members but not other admins; self-leave remains
available, including to the last admin, and leaves the channel plus remaining
members intact without promoting anyone. If all admins leave, remaining members
can still access the channel but cannot manage membership. Pending email
invitations, guest accounts, admin promotion/transfer, and notifications
are not implemented.

**Status: IN PROGRESS (2026-10-14).** Implemented member listing scoped to
current private-channel members, admin-only invite/removal, existing-account
and workspace-membership checks, idempotent invites, admin-removal protection,
privacy-safe errors, and audit events containing actor, target, channel,
timestamp, and outcome. Added member-management UI with invite validation,
loading/error states, member removal confirmation, and refresh after changes.
Validation: `node codebase/cli/repo.mjs test --affected --concurrency 2`
(API 66, web 13, UI 1, and logging 2 passed);
`node codebase/cli/repo.mjs run typecheck --affected --concurrency 2`,
`node codebase/cli/repo.mjs run lint --affected --concurrency 2`, and
`node codebase/cli/repo.mjs build --affected --concurrency 2` passed.
Repository architecture checks report no issues. A live MongoDB replica-set
integration test now checks invites against persisted Better Auth user
profiles and workspace membership records, including ObjectId-to-string
identity mapping and rejection of a user from another workspace. It also
covers duplicate invites, removal, access revocation, retained message
documents, and privacy-safe audit fields. The API suite passes 92 tests with
`MONGODB_TEST_URI` set to a `nutshyll_test_*` replica-set database; API
typecheck and lint pass, and `pnpm run check` reports no issues. Remaining:
add focused component interaction tests when a suitable UI test harness is
available. Socket.IO now re-checks workspace/channel membership on
subscription and typing, publishes only after successful persistence, and
revokes channel/workspace access when membership is removed. A focused
Socket.IO integration test covers authenticated access, private-channel
denial, presence, typing, message delivery, membership/list changes, and
revocation. Remaining: focused component interaction tests and final
validation of realtime changes.

------------------------------------------------------------------------

## Story A5 --- Update channel details and lifecycle

**User story:** As an authorized channel manager, I want to update a
channel's description/topic and archive it when it is no longer active.

### Acceptance criteria

-   AC1: Authorized managers can update supported channel metadata.
-   AC2: Input length, allowed formatting, and normalization are
    validated server-side.
-   AC3: Unauthorized users cannot update metadata.
-   AC4: Archive is a controlled lifecycle transition, not an accidental
    permanent delete.
-   AC5: Archived channels are read-only or behave according to a
    clearly documented policy; new posts and joins follow that policy.
-   AC6: Restore/unarchive is available only to authorized users if
    supported.
-   AC7: Existing messages remain available according to retention and
    permission policy.
-   AC8: Changes are auditable and visible to subscribed clients.
-   AC9: Stale concurrent edits return a conflict or follow a documented
    last-write policy.

### Tasks and subtasks

**A5-T1 --- Define metadata and lifecycle** - A5-T1-S1: Define
description/topic length limits and formatting rules. - A5-T1-S2: Define
active/archived/deleted states and allowed transitions. - A5-T1-S3:
Define behavior for archived channel history, search, membership, and
notifications.

**A5-T2 --- Implement metadata/lifecycle commands** - A5-T2-S1:
Implement authorized metadata update. - A5-T2-S2: Implement archive and
optional restore. - A5-T2-S3: Add optimistic concurrency/version check
if required. - A5-T2-S4: Emit auditable events and refresh derived
lists/indexes.

**A5-T3 --- Build channel settings UI** - A5-T3-S1: Add channel
details/settings view. - A5-T3-S2: Add editable topic/description with
validation. - A5-T3-S3: Add archive confirmation and archived-state
treatment. - A5-T3-S4: Hide/disable actions based on policy while still
enforcing policy on server.

**A5-T4 --- Verify A5** - A5-T4-S1: Test role enforcement, invalid
metadata, and concurrent edits. - A5-T4-S2: Test archive transitions and
post/join behavior. - A5-T4-S3: Test history/search visibility after
archive. - A5-T4-S4: Test audit events and UI state refresh.

------------------------------------------------------------------------

## Story A6 --- Open a channel conversation and receive messages in real time

**User story:** As a channel member, I want to open a channel and
receive new messages in real time so that I can follow the discussion
without refreshing the page.

### Acceptance criteria

-   AC1: Authorized members can open a channel and load its recent
    messages.
-   AC2: The server validates channel access before returning history or
    accepting a real-time subscription.
-   AC3: A message event is broadcast only to currently authorized
    channel subscribers.
-   AC4: Refreshing or reconnecting recovers persisted messages and
    missed events without duplicates in the rendered timeline.
-   AC5: Message order is stable and deterministic.
-   AC6: A revoked/removed member loses subscription and history access
    according to policy.
-   AC7: A socket failure does not destroy persisted messages or prevent
    later HTTP/history recovery.
-   AC8: Loading, empty, reconnecting, and failed states are visible to
    the user.
-   AC9: Real-time event payloads are validated and size-limited.
-   AC10: Tests prove one workspace/channel cannot receive another
    workspace's events.

### Tasks and subtasks

**A6-T1 --- Define real-time event contract** - A6-T1-S1: Define event
names, payload schemas, stable event IDs, and versioning policy. -
A6-T1-S2: Define subscribe/unsubscribe authorization behavior. -
A6-T1-S3: Define reconnect cursor and resynchronization protocol. -
A6-T1-S4: Define deduplication and ordering behavior on the client.

**A6-T2 --- Implement authorized real-time transport** - A6-T2-S1:
Authenticate socket connections using the existing session/principal
mechanism. - A6-T2-S2: Authorize room subscription using current
workspace/channel membership. - A6-T2-S3: Implement join/leave room
handling and membership revocation. - A6-T2-S4: Validate event payloads,
rate-limit commands, and handle disconnects. - A6-T2-S5: Publish only
after persistence succeeds; use an outbox if reliable event publication
is part of the architecture.

**A6-T3 --- Build channel timeline** - A6-T3-S1: Build channel header
and message timeline. - A6-T3-S2: Load initial history through the
approved API/query boundary. - A6-T3-S3: Subscribe to real-time events
and merge them by stable ID. - A6-T3-S4: Handle reconnect, backoff,
stale events, and resynchronization. - A6-T3-S5: Show loading, empty,
offline/reconnecting, and error states.

**A6-T4 --- Verify A6** - A6-T4-S1: Integration-test history plus live
event delivery. - A6-T4-S2: Test reconnect and no-duplicate rendering. -
A6-T4-S3: Test cross-workspace/channel event isolation. - A6-T4-S4: Test
membership revocation during an active connection. - A6-T4-S5: Test
transport failure while persisted history remains available.

------------------------------------------------------------------------

# 4. Epic B --- Direct Messaging

## Epic goal

Users can start and resume one-to-one and group direct conversations.
Conversation identity, membership, history, and live delivery remain
private to participants.

## Epic-level definition of done

-   Direct conversations have deterministic identity and participant
    membership.
-   Only active participants can read, send, search, react, or
    subscribe.
-   Duplicate creation and retry behavior is defined.
-   Leaving/removing participants follows explicit group-DM rules.
-   DMs integrate with shared message, attachment, mention,
    notification, and search models without bypassing authorization.
-   Tests cover private access, workspace boundaries, participant
    changes, reconnects, and concurrency.

------------------------------------------------------------------------

## Story B1 --- Start or open a one-to-one DM

**Status: IN PROGRESS.** Canonical one-to-one conversations, workspace
membership checks, participant-scoped persistence, HTTP and realtime flows,
and the web DM experience are implemented. Focused unit tests cover the
service behavior. Live MongoDB transaction/concurrent-create integration
coverage remains outstanding.

**User story:** As a workspace member, I want to start a direct
conversation with another member so that we can communicate privately.

### Acceptance criteria

-   AC1: A member can start a DM with another eligible active member in
    the same workspace.
-   AC2: A user cannot start a DM with themselves.
-   AC3: Repeated attempts to open the same pair return the existing
    canonical conversation rather than creating duplicates.
-   AC4: Pair identity is deterministic and protected by a unique
    constraint or equivalent concurrency-safe mechanism.
-   AC5: Inactive, removed, or cross-workspace targets are rejected
    according to product policy without disclosing sensitive account
    details.
-   AC6: Only the two participants can access the conversation and its
    messages.
-   AC7: Opening an existing DM does not create a duplicate membership
    or reset read state unexpectedly.
-   AC8: The conversation appears in both participants' conversation
    lists according to the defined list policy.
-   AC9: Creation/opening is safe under simultaneous requests from both
    participants.

### Tasks and subtasks

**B1-T1 --- Define DM identity** - B1-T1-S1: Define direct-conversation
type and participant model. - B1-T1-S2: Define canonical
participant-pair key scoped to workspace. - B1-T1-S3: Define lifecycle
behavior when one participant is deactivated or removed. - B1-T1-S4:
Define whether a DM can be blocked/hidden (blocking is out of scope
unless explicitly added).

**B1-T2 --- Implement create-or-get use case** - B1-T2-S1: Validate
principal, workspace membership, and target eligibility. - B1-T2-S2:
Implement canonical pair lookup. - B1-T2-S3: Implement race-safe
create-or-get with database uniqueness. - B1-T2-S4: Create both
participant records atomically. - B1-T2-S5: Return stable conversation
identity and safe participant summary.

**B1-T3 --- Build one-to-one DM UX** - B1-T3-S1: Add member
picker/search to start a DM. - B1-T3-S2: Add existing DM navigation and
conversation header. - B1-T3-S3: Prevent self-selection and handle
unavailable targets. - B1-T3-S4: Navigate to the canonical conversation
after create/open.

**B1-T4 --- Verify B1** - B1-T4-S1: Test existing/new DM behavior. -
B1-T4-S2: Test concurrent create-or-get and unique constraints. -
B1-T4-S3: Test self-DM, inactive user, cross-workspace target, and
unauthorized reads. - B1-T4-S4: Test both participants' conversation
lists.

------------------------------------------------------------------------

## Story B2 --- Start and manage a group DM

**User story:** As a workspace member, I want to create a group DM with
selected coworkers so that I can coordinate without creating a channel.

### Acceptance criteria

-   AC1: A user can create a group DM with a valid set of eligible
    participants, including the creator.
-   AC2: The participant count has a documented configurable maximum.
-   AC3: Duplicate participant IDs are normalized and do not create
    duplicate participant records.
-   AC4: The creator cannot create a group with only themselves; the
    minimum valid participant count is enforced.
-   AC5: All participants belong to the same workspace and are eligible
    to communicate.
-   AC6: The group conversation and initial participant set are created
    atomically.
-   AC7: A retry with the same idempotency key does not create a
    duplicate group.
-   AC8: The group has a useful display title (custom title or derived
    participant names), with safe behavior when names change.
-   AC9: Only current participants can access history and subscribe to
    live events.

### Tasks and subtasks

**B2-T1 --- Define group DM rules** - B2-T1-S1: Set minimum/maximum
participant count. - B2-T1-S2: Define custom group title behavior and
fallback title. - B2-T1-S3: Define whether groups with identical
participant sets are reused or always new; document product decision. -
B2-T1-S4: Define participant add/remove and leave behavior.

**B2-T2 --- Implement group creation** - B2-T2-S1: Validate unique
participant set and workspace membership. - B2-T2-S2: Create
conversation and participant records atomically. - B2-T2-S3: Implement
idempotency and concurrency controls. - B2-T2-S4: Persist
creator/initiator metadata and timestamps. - B2-T2-S5: Emit
participant/conversation events.

**B2-T3 --- Build group DM UX** - B2-T3-S1: Build multi-select member
picker. - B2-T3-S2: Display selected participants and validation. -
B2-T3-S3: Create and open the group conversation. - B2-T3-S4: Render
group header/title and participant list.

**B2-T4 --- Verify B2** - B2-T4-S1: Test valid/invalid participant
counts. - B2-T4-S2: Test duplicate IDs, cross-workspace IDs, inactive
users, and creator inclusion. - B2-T4-S3: Test concurrent submissions
and idempotency. - B2-T4-S4: Test group access restrictions.

------------------------------------------------------------------------

## Story B3 --- List, open, and resume direct conversations

**User story:** As a user, I want to see my recent direct conversations
and reopen them so that I can continue previous discussions.

### Acceptance criteria

-   AC1: The list contains only conversations in which the current
    principal is an active participant.
-   AC2: Conversations are ordered by a documented activity timestamp
    and stable tie-breaker.
-   AC3: A new message updates ordering without duplicating the
    conversation row.
-   AC4: Pagination is bounded and stable as activity changes.
-   AC5: Empty, loading, error, and retry states are provided.
-   AC6: Opening a conversation loads the correct participants and
    authorized message history.
-   AC7: Hidden/archived conversations follow the chosen visibility
    policy.
-   AC8: A non-participant cannot access a conversation by guessing its
    ID.

### Tasks and subtasks

**B3-T1 --- Implement conversation query** - B3-T1-S1: Define
recent-conversation sorting and pagination. - B3-T1-S2: Query only
conversations for which the principal is a participant. - B3-T1-S3:
Return last-message preview only if authorized and policy permits it. -
B3-T1-S4: Add indexes for participant lookup and activity ordering. -
B3-T1-S5: Ensure updates to activity timestamps are race-safe.

**B3-T2 --- Build DM navigation** - B3-T2-S1: Add recent DMs list. -
B3-T2-S2: Show participant/group identity, last activity, and unread
indicator. - B3-T2-S3: Add pagination or bounded infinite scroll. -
B3-T2-S4: Update the list on new message and participant changes. -
B3-T2-S5: Implement empty and error states.

**B3-T3 --- Verify B3** - B3-T3-S1: Test participant-only listing and
direct access. - B3-T3-S2: Test sorting under equal timestamps and
new-message activity. - B3-T3-S3: Test pagination while new messages
arrive. - B3-T3-S4: Test UI state transitions.

------------------------------------------------------------------------

## Story B4 --- Manage group DM participants and leave a group

**User story:** As an authorized group participant, I want to see
participants and leave or manage membership under clear rules so that
group conversations remain manageable.

### Acceptance criteria

-   AC1: Current participants can view the participant list.
-   AC2: Add/remove permissions are explicitly defined (for example, any
    participant can add, or creator/admin only) and enforced
    server-side.
-   AC3: New participants can access history according to a documented
    policy; do not assume full historical access without a product
    decision.
-   AC4: Removed participants lose future access promptly; retained
    historical access, if any, is explicitly specified.
-   AC5: Leaving updates membership and read state without deleting
    messages.
-   AC6: Minimum participant count and empty-group lifecycle are
    handled.
-   AC7: Membership changes produce deduplicated notifications/events.
-   AC8: Non-participants cannot inspect membership or history.

### Tasks and subtasks

**B4-T1 --- Finalize group membership policy** - B4-T1-S1: Decide who
can add/remove participants. - B4-T1-S2: Decide history visibility for
added/removed/left participants. - B4-T1-S3: Decide whether groups can
be renamed and who can rename them. - B4-T1-S4: Define lifecycle when
only one participant remains.

**B4-T2 --- Implement participant management** - B4-T2-S1: Implement
participant list query. - B4-T2-S2: Implement add/remove/leave commands
under the policy. - B4-T2-S3: Enforce unique membership and safe
concurrent changes. - B4-T2-S4: Revoke real-time subscriptions and
authorization on removal. - B4-T2-S5: Emit audit and notification
events.

**B4-T3 --- Build participant management UX** - B4-T3-S1: Add
participant panel. - B4-T3-S2: Add member picker and remove/leave
actions. - B4-T3-S3: Explain irreversible/access-changing actions. -
B4-T3-S4: Handle stale membership and authorization errors.

**B4-T4 --- Verify B4** - B4-T4-S1: Test participant permission matrix
and history policy. - B4-T4-S2: Test concurrent add/remove/leave
operations. - B4-T4-S3: Test active socket revocation. - B4-T4-S4: Test
last-participant and group lifecycle rules.

------------------------------------------------------------------------

# 5. Epic C --- Messaging Tools

## Epic goal

Users can send and manage messages, organize replies, react, mention
people, and share safe attachments in channels and DMs. All tools use
the same authorization, persistence, event, and history rules.

## Epic-level definition of done

-   Message commands work for both channel and DM targets through a
    shared domain contract without weakening target-specific
    authorization.
-   Persistence is authoritative; real-time delivery follows successful
    persistence.
-   Message ordering, retries, duplicate prevention, edit/delete
    behavior, and concurrency are documented.
-   Attachments are authorized, validated, and stored outside the
    primary database.
-   Threads, reactions, mentions, pins, unread state, and notifications
    are covered by tests.
-   Accessible and responsive message composer/timeline states exist.
-   Abuse limits, payload limits, security checks, and telemetry are in
    place.

------------------------------------------------------------------------

## Story C1 --- Send and receive a message

**User story:** As an authorized conversation participant, I want to
send a message and see it delivered so that I can communicate with my
team.

### Acceptance criteria

-   AC1: An authenticated authorized participant can send a non-empty
    valid message to a channel or DM.
-   AC2: Server-side validation enforces supported content format,
    maximum length, and payload limits.
-   AC3: Target is exactly one authorized channel or direct
    conversation.
-   AC4: Message is durably persisted before success is acknowledged or
    a message-created event is published.
-   AC5: Retried sends with the same idempotency key return the same
    logical message rather than duplicating it.
-   AC6: Message has stable ID, author, target, created timestamp, and
    edit/delete state.
-   AC7: Messages render in deterministic order even when timestamps
    match.
-   AC8: A sender sees a clear sending/sent/failed state; failed sends
    can be retried without accidental duplicates.
-   AC9: HTML/script input is safely handled; rendering never executes
    user content.
-   AC10: Rate limits prevent message flooding while permitting normal
    use.
-   AC11: Unauthorized, archived/read-only, removed-member, and
    cross-workspace sends are rejected.
-   AC12: A persistence failure produces a failure response and no false
    success event.
-   AC13: Message body and secrets are not written to ordinary logs.

### Tasks and subtasks

**C1-T1 --- Define message contract** - C1-T1-S1: Define message fields
and target invariant. - C1-T1-S2: Define supported text format and
rendering/escaping rules. - C1-T1-S3: Define length limits,
empty/whitespace handling, and payload limits. - C1-T1-S4: Define stable
ID, idempotency key, timestamp, and ordering strategy. - C1-T1-S5:
Define edit/delete/tombstone metadata.

**C1-T2 --- Implement persistence** - C1-T2-S1: Add message schema/table
and required indexes. - C1-T2-S2: Add target/author references and
integrity constraints. - C1-T2-S3: Implement message
repository/gateway. - C1-T2-S4: Add unique idempotency constraint scoped
to the sender/target as appropriate. - C1-T2-S5: Implement atomic
persistence plus outbox/event record where required. - C1-T2-S6: Add
migration and operational notes.

**C1-T3 --- Implement send/read API** - C1-T3-S1: Resolve authenticated
principal and trusted workspace. - C1-T3-S2: Authorize channel
membership or DM participation. - C1-T3-S3: Validate target state, body,
and idempotency key. - C1-T3-S4: Persist message and durable event. -
C1-T3-S5: Return canonical message response and stable errors. -
C1-T3-S6: Add rate limiting and request correlation.

**C1-T4 --- Implement real-time publication** - C1-T4-S1: Publish
created-message event after durable commit. - C1-T4-S2: Authorize
recipients by channel membership or DM participation. - C1-T4-S3:
Include stable event/message IDs for deduplication. - C1-T4-S4:
Implement reconnect resynchronization and retry-safe consumer
behavior. - C1-T4-S5: Avoid duplicate publication where outbox retries
occur.

**C1-T5 --- Build message composer and renderer** - C1-T5-S1: Build
accessible composer and send control. - C1-T5-S2: Support
Enter/Shift+Enter behavior and document it. - C1-T5-S3: Render author,
timestamp, body, and pending/failure state. - C1-T5-S4: Merge HTTP
acknowledgement and socket event without duplicate messages. - C1-T5-S5:
Handle offline/reconnect and retry states. - C1-T5-S6: Ensure user
content is safely rendered.

**C1-T6 --- Verify C1** - C1-T6-S1: Unit-test validation, normalization,
target invariants, and rendering helpers. - C1-T6-S2: Integration-test
channel and DM send/read. - C1-T6-S3: Test duplicate retries and
concurrent sends. - C1-T6-S4: Test unauthorized target, removed member,
archived channel, and cross-workspace access. - C1-T6-S5: Test
persistence failure, event publication failure, and outbox retry. -
C1-T6-S6: Test rate limiting, payload size, and safe rendering.

------------------------------------------------------------------------

## Story C2 --- Edit and delete own messages

**User story:** As a message author, I want to edit or delete my message
so that I can correct mistakes or remove content I no longer want
displayed.

### Acceptance criteria

-   AC1: A user can edit only a message they authored, unless an
    explicitly documented moderator policy grants additional rights.
-   AC2: A user can delete only a message they authored, subject to the
    same policy.
-   AC3: Edit/delete requires current authorization to access the target
    conversation.
-   AC4: Edit requests validate content and preserve original creation
    timestamp and author.
-   AC5: Concurrent edits are detected with a version/revision check or
    documented conflict policy; stale updates do not silently overwrite
    newer content.
-   AC6: Deletion behavior is consistent: hard delete or tombstone, with
    retention/search/export implications documented.
-   AC7: Deleted content is excluded from ordinary history and search;
    caches/indexes are invalidated or safely filtered.
-   AC8: Connected clients receive an authorized update event and
    converge on the persisted state.
-   AC9: Repeated delete requests are idempotent where appropriate.
-   AC10: Edit timestamps and deletion metadata are available to
    authorized views.
-   AC11: Message contents are not copied into operational logs.

### Tasks and subtasks

**C2-T1 --- Define edit/delete policy** - C2-T1-S1: Define author-only
versus moderator permissions. - C2-T1-S2: Define tombstone/hard-delete
and retention behavior. - C2-T1-S3: Define edit versioning and conflict
behavior. - C2-T1-S4: Define how attachments, reactions, replies,
search, and notifications respond to deletion.

**C2-T2 --- Implement edit/delete commands** - C2-T2-S1: Add
version/revision metadata if required. - C2-T2-S2: Implement authorized
edit with validation and optimistic concurrency. - C2-T2-S3: Implement
authorized delete/tombstone. - C2-T2-S4: Update indexes/read models and
invalidate caches. - C2-T2-S5: Emit edit/delete events after
persistence. - C2-T2-S6: Make retries safe.

**C2-T3 --- Build edit/delete UX** - C2-T3-S1: Add message action menu
with permission-aware options. - C2-T3-S2: Add inline edit mode and
save/cancel controls. - C2-T3-S3: Add delete confirmation where
appropriate. - C2-T3-S4: Show edited marker and consistent
deleted-message placeholder. - C2-T3-S5: Handle stale edit conflicts and
server errors.

**C2-T4 --- Verify C2** - C2-T4-S1: Test author versus non-author
access. - C2-T4-S2: Test concurrent edit and delete races. - C2-T4-S3:
Test deleted content in history, search, thread replies, caches, and
notifications. - C2-T4-S4: Test client synchronization and idempotent
retries.

------------------------------------------------------------------------

## Story C3 --- Reply in threads

**User story:** As a conversation participant, I want to reply to a
specific message in a thread so that detailed discussions stay
organized.

### Acceptance criteria

-   AC1: An authorized participant can open a root message's thread and
    read its replies.
-   AC2: Replies belong to the same channel/DM target as the root
    message.
-   AC3: A user cannot reply to a message they cannot access.
-   AC4: Thread replies have stable order and cursor pagination.
-   AC5: Reply count and latest reply activity remain consistent with
    persisted replies.
-   AC6: Thread replies appear in the thread and follow the chosen
    main-timeline policy (for example, root only in main timeline).
-   AC7: Deleted root/reply behavior is documented and consistent.
-   AC8: Real-time replies are delivered only to authorized
    participants.
-   AC9: Reconnect and pagination do not duplicate replies.

### Tasks and subtasks

**C3-T1 --- Define thread model** - C3-T1-S1: Define root/parent ID
rules and whether nested threads are prohibited. - C3-T1-S2: Define root
deletion and reply deletion behavior. - C3-T1-S3: Define reply
count/latest activity updates. - C3-T1-S4: Define timeline placement of
thread replies.

**C3-T2 --- Implement thread queries and commands** - C3-T2-S1: Add
root/parent references and indexes. - C3-T2-S2: Implement authorized
thread history query. - C3-T2-S3: Reuse the shared send-message command
with parent validation. - C3-T2-S4: Maintain reply count/activity
consistently. - C3-T2-S5: Emit thread reply events and invalidate
relevant views.

**C3-T3 --- Build thread UI** - C3-T3-S1: Add Reply in thread action. -
C3-T3-S2: Build thread panel/drawer and reply composer. - C3-T3-S3: Show
reply count and latest reply preview. - C3-T3-S4: Support loading older
replies, empty state, and close/reopen. - C3-T3-S5: Handle deleted
root/reply states.

**C3-T4 --- Verify C3** - C3-T4-S1: Test root/reply target invariants. -
C3-T4-S2: Test cross-conversation and unauthorized reply attempts. -
C3-T4-S3: Test counts, ordering, pagination, and deletion. - C3-T4-S4:
Test real-time delivery and reconnect deduplication.

------------------------------------------------------------------------

## Story C4 --- React to messages with emoji

**User story:** As a conversation participant, I want to add or remove
emoji reactions so that I can acknowledge messages without sending
another message.

### Acceptance criteria

-   AC1: Authorized users can add a supported emoji reaction to an
    accessible message.
-   AC2: A user can have at most one reaction of a given emoji per
    message, unless product policy explicitly allows multiple identical
    reactions.
-   AC3: Repeating the same add request is idempotent.
-   AC4: A user can remove their own reaction but cannot remove another
    user's reaction unless authorized moderation is explicitly defined.
-   AC5: Reaction totals and participant indicators are consistent
    across clients.
-   AC6: Reactions to deleted/inaccessible messages are rejected or
    handled according to the deletion policy.
-   AC7: Reaction events are sent only to authorized conversation
    participants.
-   AC8: Emoji input is validated against the supported representation
    and size limit.

### Tasks and subtasks

**C4-T1 --- Define reaction contract** - C4-T1-S1: Define canonical
emoji representation and supported set. - C4-T1-S2: Define uniqueness
and removal rules. - C4-T1-S3: Define reaction count and participant
data returned to clients.

**C4-T2 --- Implement reaction persistence and APIs** - C4-T2-S1: Add
reaction schema/table and unique message/user/emoji constraint. -
C4-T2-S2: Implement authorized add/remove commands. - C4-T2-S3:
Implement efficient reaction summary query. - C4-T2-S4: Emit reaction
events and make consumers idempotent.

**C4-T3 --- Build reaction UI** - C4-T3-S1: Add accessible emoji
picker. - C4-T3-S2: Render reaction chips and counts. - C4-T3-S3:
Indicate whether the current user reacted. - C4-T3-S4: Update
optimistically only with rollback/error handling, or wait for server
acknowledgement.

**C4-T4 --- Verify C4** - C4-T4-S1: Test uniqueness and duplicate
requests. - C4-T4-S2: Test removal permissions. - C4-T4-S3: Test counts
under concurrent adds/removes. - C4-T4-S4: Test deleted-message and
cross-workspace authorization.

------------------------------------------------------------------------

## Story C5 --- Mention people in messages

**User story:** As a user, I want to mention a workspace member in a
message so that I can direct their attention to a relevant discussion.

### Acceptance criteria

-   AC1: The composer offers accessible member suggestions when the user
    types the supported mention trigger (for example, `@`).
-   AC2: Mention parsing uses structured IDs/references rather than
    trusting display text alone.
-   AC3: Only eligible workspace members are suggested for the target
    conversation; private membership visibility is respected.
-   AC4: Server-side validation rejects invalid, inaccessible, or
    cross-workspace mention targets.
-   AC5: Mentioned users receive an in-app notification according to
    notification preferences and mute rules.
-   AC6: Mention notification creation is deduplicated across retries
    and event replay.
-   AC7: Editing/deleting a message updates mention notification
    behavior according to a documented policy.
-   AC8: User-generated text cannot forge a mention merely by typing
    another person's name.
-   AC9: Mentioned names render safely and remain meaningful if the
    display name changes.

### Tasks and subtasks

**C5-T1 --- Define mention model** - C5-T1-S1: Define mention syntax and
structured representation. - C5-T1-S2: Define eligible suggestion set
for channels and DMs. - C5-T1-S3: Define notification and edit/delete
policy. - C5-T1-S4: Define group mentions as out of scope unless
separately approved.

**C5-T2 --- Implement mention parsing and validation** - C5-T2-S1: Add
composer suggestion query scoped to authorized members. - C5-T2-S2:
Serialize selected mention IDs in message content or structured
metadata. - C5-T2-S3: Validate mention targets server-side on
create/edit. - C5-T2-S4: Render mentions using safe structured data.

**C5-T3 --- Implement mention notifications** - C5-T3-S1: Create
notification event after message commit. - C5-T3-S2: Deduplicate by
event/message/recipient. - C5-T3-S3: Respect mute/notification
preferences where available. - C5-T3-S4: Avoid notifying the author
unless policy requires it. - C5-T3-S5: Track notification outcomes
without logging message bodies.

**C5-T4 --- Build and verify mention UX** - C5-T4-S1: Implement
keyboard-accessible suggestion menu. - C5-T4-S2: Support selecting,
removing, and navigating mentions. - C5-T4-S3: Test valid, invalid,
cross-workspace, and inaccessible mentions. - C5-T4-S4: Test duplicate
notification prevention and message edit/delete behavior.

------------------------------------------------------------------------

## Story C6 --- Upload and share message attachments

**User story:** As a conversation participant, I want to attach a file
to a message so that I can share work materials in context.

### Acceptance criteria

-   AC1: Only authorized participants can initiate uploads and associate
    attachments with a conversation message.
-   AC2: Allowed file types, maximum file size, and maximum attachment
    count are configurable and documented.
-   AC3: The server validates file metadata and does not trust
    client-provided MIME type or filename.
-   AC4: Binary files are stored in approved object storage; the
    database stores metadata and storage references only.
-   AC5: Upload URLs, download URLs, or file proxy access are
    short-lived or otherwise authorization-checked.
-   AC6: A user cannot download an attachment by guessing its ID or
    storage key.
-   AC7: Upload cancellation, failure, retry, and orphan cleanup are
    handled.
-   AC8: Dangerous file types are blocked or treated according to a
    documented safe policy; filenames are sanitized.
-   AC9: Attachment access follows message/conversation permissions
    after a member is removed.
-   AC10: Deleted messages/attachments follow retention and cleanup
    policy.
-   AC11: Secrets and file contents are not written to logs.
-   AC12: Production storage configuration is externalized; local
    development may use a documented local adapter.

### Tasks and subtasks

**C6-T1 --- Define attachment security and storage contract** -
C6-T1-S1: Define storage provider abstraction and production/local
implementations. - C6-T1-S2: Define allowed types, size limits, count
limits, and filename normalization. - C6-T1-S3: Define upload
initiation/completion protocol. - C6-T1-S4: Define malware
scanning/quarantine decision; if scanning is unavailable in Release 1,
document residual risk and restrict dangerous types. - C6-T1-S5: Define
retention, orphan cleanup, and delete behavior.

**C6-T2 --- Implement upload/download backend** - C6-T2-S1: Add
attachment metadata model and indexes. - C6-T2-S2: Implement authorized
upload initiation. - C6-T2-S3: Validate completion, object size,
metadata, and target authorization. - C6-T2-S4: Implement authorized
download or short-lived signed URL generation. - C6-T2-S5: Sanitize
filenames and set safe content disposition/content type. - C6-T2-S6: Add
orphaned upload cleanup and failure recovery. - C6-T2-S7: Add rate
limits and audit events.

**C6-T3 --- Integrate attachments with messages** - C6-T3-S1: Associate
completed attachments with a persisted message. - C6-T3-S2: Ensure
incomplete uploads cannot appear as valid shared files. - C6-T3-S3:
Enforce attachment access on every read path. - C6-T3-S4: Invalidate
search/index references after deletion according to policy.

**C6-T4 --- Build attachment UI** - C6-T4-S1: Add file picker and
drag/drop if supported. - C6-T4-S2: Display progress, cancellation,
retry, and failure states. - C6-T4-S3: Render safe attachment
cards/previews. - C6-T4-S4: Provide accessible file names and download
controls. - C6-T4-S5: Prevent duplicate submission when retrying an
upload.

**C6-T5 --- Verify C6** - C6-T5-S1: Test size/type validation and
spoofed MIME metadata. - C6-T5-S2: Test unauthorized upload/download and
cross-workspace IDs. - C6-T5-S3: Test expired signed URL or
authorization recheck. - C6-T5-S4: Test interrupted uploads, orphan
cleanup, and deleted message behavior. - C6-T5-S5: Test production
configuration and local storage adapter.

------------------------------------------------------------------------

## Story C7 --- Pin important messages

**User story:** As an authorized conversation member, I want to pin an
important message so that participants can find key information quickly.

### Acceptance criteria

-   AC1: Pin/unpin permissions are defined separately for channels and
    DMs, then enforced server-side.
-   AC2: A message can be pinned only if it belongs to the target
    conversation and is not deleted.
-   AC3: Duplicate pin requests are idempotent.
-   AC4: Pinned message list is permission-filtered and ordered
    predictably.
-   AC5: Unpinning does not delete the message.
-   AC6: Deleted messages are removed from the pinned list or
    represented according to the deletion policy.
-   AC7: Pin/unpin changes propagate to authorized clients and are
    auditable.
-   AC8: A user cannot pin a message from another workspace or
    conversation.

### Tasks and subtasks

**C7-T1 --- Define pin policy** - C7-T1-S1: Define who can pin/unpin in
channels and DMs. - C7-T1-S2: Define maximum pins per conversation if
needed. - C7-T1-S3: Define pin ordering and deleted-message behavior.

**C7-T2 --- Implement pin persistence and API** - C7-T2-S1: Add pin
model/relationship and uniqueness constraint. - C7-T2-S2: Implement
authorized pin/unpin commands. - C7-T2-S3: Implement pinned-message
query with conversation authorization. - C7-T2-S4: Emit audit and
real-time events.

**C7-T3 --- Build pin UX and tests** - C7-T3-S1: Add pin/unpin action to
message menu. - C7-T3-S2: Add pinned messages view. - C7-T3-S3: Test
role policy, duplicates, deletion, and cross-conversation IDs. -
C7-T3-S4: Test real-time consistency and accessibility.

------------------------------------------------------------------------

## Story C8 --- Track unread messages and read position

**User story:** As a user, I want unread indicators and a way to return
to where I last read so that I can keep up with active conversations.

### Acceptance criteria

-   AC1: Read state is stored per user and conversation, not globally
    for all users.
-   AC2: Opening a conversation and/or reaching the latest message
    updates read position according to a documented policy.
-   AC3: Reading one conversation does not clear unread state for
    another.
-   AC4: New messages update unread counts/indicators for eligible
    participants.
-   AC5: The user's own messages do not create misleading unread state
    for themselves.
-   AC6: Mentions can be highlighted separately from ordinary unread
    messages if supported.
-   AC7: Concurrent messages and multiple open devices do not move the
    read cursor backward.
-   AC8: Read-state updates are authorized and rate-limited.
-   AC9: Reconnect and refresh recover the same read position.
-   AC10: Muted/archived conversation unread behavior is documented and
    consistent.

### Tasks and subtasks

**C8-T1 --- Define read-state semantics** - C8-T1-S1: Choose last-read
message ID, monotonic sequence, or another stable cursor. - C8-T1-S2:
Define when opening/scrolling marks messages read. - C8-T1-S3: Define
unread count rules for own messages, muted conversations, and archived
channels. - C8-T1-S4: Define cross-device synchronization.

**C8-T2 --- Implement read-state persistence** - C8-T2-S1: Add
per-user/per-conversation read-state model and unique constraint. -
C8-T2-S2: Implement monotonic read cursor update. - C8-T2-S3: Implement
unread query/count efficiently. - C8-T2-S4: Update read state on
authorized commands and events. - C8-T2-S5: Add indexes and prevent
expensive full-history count scans.

**C8-T3 --- Build unread UX** - C8-T3-S1: Show unread badges in channel
and DM lists. - C8-T3-S2: Show unread divider/return-to-latest behavior
in timeline. - C8-T3-S3: Mark read based on the documented visibility
policy. - C8-T3-S4: Synchronize across tabs/devices and handle offline
state.

**C8-T4 --- Verify C8** - C8-T4-S1: Test per-user/per-conversation
isolation. - C8-T4-S2: Test monotonic cursor under
concurrent/out-of-order updates. - C8-T4-S3: Test own messages,
mute/archive rules, and reconnect. - C8-T4-S4: Test unread queries at
representative history sizes.

------------------------------------------------------------------------

# 6. Epic D --- Search & Message History

## Epic goal

Users can reliably return to old conversations and find messages/files
they are authorized to access. Search results are relevant, bounded,
stable, and never bypass the underlying access policy.

## Epic-level definition of done

-   History supports bounded, stable pagination and consistent ordering.
-   Search filters and query semantics are documented.
-   Every search request is permission-aware; inaccessible private
    content cannot leak through results, snippets, counts, facets,
    autocomplete, or error behavior.
-   Edited/deleted content and attachments are treated consistently.
-   Search indexing/reconciliation is observable if asynchronous.
-   Performance and correctness tests cover large histories and access
    changes.

------------------------------------------------------------------------

## Story D1 --- Load message history and older messages

**User story:** As a conversation participant, I want to load recent and
older messages so that I can review previous discussions.

### Acceptance criteria

-   AC1: Only authorized conversation participants/members can retrieve
    history under the product's public-channel history policy.
-   AC2: Initial load returns a bounded page of recent messages.
-   AC3: Older messages load with cursor-based pagination and
    deterministic ordering.
-   AC4: Equal timestamps do not cause messages to be skipped or
    duplicated between pages.
-   AC5: Edited/deleted messages follow the shared display policy.
-   AC6: Thread replies are included or excluded from the main timeline
    according to the documented thread policy.
-   AC7: The timeline preserves scroll position when older messages are
    prepended.
-   AC8: Loading/error/retry/empty states are present.
-   AC9: Malformed or manipulated cursors cannot bypass authorization or
    cause unbounded queries.
-   AC10: History query has appropriate indexes and bounded execution
    behavior.

### Tasks and subtasks

**D1-T1 --- Define history query contract** - D1-T1-S1: Define page size
limits and cursor structure. - D1-T1-S2: Define stable ordering fields
and tie-breaker. - D1-T1-S3: Define tombstone, thread, attachment, and
edited-message representation. - D1-T1-S4: Define retention/archive
behavior.

**D1-T2 --- Implement history query** - D1-T2-S1: Implement
authorization before returning history. - D1-T2-S2: Implement
newest-page query and older cursor query. - D1-T2-S3: Add compound
indexes aligned with target and ordering. - D1-T2-S4: Validate cursors
and enforce page size caps. - D1-T2-S5: Avoid N+1 queries for authors,
reactions, attachments, and thread summaries. - D1-T2-S6: Return stable,
documented DTOs rather than raw database records.

**D1-T3 --- Build history timeline behavior** - D1-T3-S1: Load latest
page on open. - D1-T3-S2: Load older messages on scroll/explicit
action. - D1-T3-S3: Preserve scroll position while prepending history. -
D1-T3-S4: Merge live messages with paged history without duplicates. -
D1-T3-S5: Handle deletion/edit updates to already-loaded items.

**D1-T4 --- Verify D1** - D1-T4-S1: Test cursor ordering and page
boundaries with equal timestamps. - D1-T4-S2: Test unauthorized,
removed-member, private-channel, and cross-workspace access. - D1-T4-S3:
Test edits/deletes, threads, and attachment metadata. - D1-T4-S4: Test
scroll preservation and live-event/history merge. - D1-T4-S5: Test query
plan/performance at representative data volumes.

------------------------------------------------------------------------

## Story D2 --- Search messages across accessible conversations

**User story:** As a user, I want to search message content across
conversations I can access so that I can find decisions, answers, and
shared information.

### Acceptance criteria

-   AC1: Authenticated users can search messages only within
    workspaces/conversations they are authorized to access.
-   AC2: Search query length, syntax, and request rate are bounded and
    validated.
-   AC3: Results include enough context to identify the conversation,
    author, timestamp, and matching snippet without exposing
    unauthorized data.
-   AC4: Search results are ordered predictably by relevance and/or
    recency; ranking behavior is documented.
-   AC5: Deleted messages are excluded from normal results; edited
    messages use current searchable content.
-   AC6: Search can be paginated with stable cursors or another
    documented strategy.
-   AC7: Search handles no-results, malformed query, timeout, partial
    index outage, and retry states.
-   AC8: A non-member cannot infer private channel/DM existence from
    result count, snippet, facets, or autocomplete.
-   AC9: Search index lag is documented and bounded if indexing is
    asynchronous; a reconciliation process exists.
-   AC10: Authorization changes and membership revocation are reflected
    immediately at query time, even if index updates lag.
-   AC11: Search logs do not record raw private query/message content
    unless explicitly approved and privacy-reviewed.
-   AC12: Performance goals are defined and tested against a
    representative dataset before release.

### Tasks and subtasks

**D2-T1 --- Define search behavior** - D2-T1-S1: Define supported query
syntax (plain text initially; operators only if implemented). -
D2-T1-S2: Define default scope (current workspace and accessible
conversations). - D2-T1-S3: Define relevance/recency ranking and stable
tie-breaker. - D2-T1-S4: Define snippet highlighting and safe
rendering. - D2-T1-S5: Define index freshness target and behavior during
index outage. - D2-T1-S6: Define retention/deletion/index cleanup
policy.

**D2-T2 --- Choose and implement search backend** - D2-T2-S1: Inspect
existing database search capabilities and operational constraints before
choosing a separate search service. - D2-T2-S2: Implement a search
abstraction so query logic is not coupled to a vendor-specific UI
contract. - D2-T2-S3: Create/update search documents from persisted
message events. - D2-T2-S4: Make indexing consumers idempotent using
stable event/message IDs. - D2-T2-S5: Implement retry,
dead-letter/failure visibility, and reconciliation for missed updates. -
D2-T2-S6: Handle edit/delete and attachment metadata updates in the
index.

**D2-T3 --- Implement permission-aware search query** - D2-T3-S1:
Resolve principal and workspace context. - D2-T3-S2: Apply current
authorization constraints to candidate results before returning any
content. - D2-T3-S3: Ensure snippets, totals, facets, and pagination do
not leak inaccessible content. - D2-T3-S4: Apply validated filters and
stable pagination. - D2-T3-S5: Return only minimal authorized result
DTOs. - D2-T3-S6: Enforce query timeout, rate limits, and bounded
resource use.

**D2-T4 --- Build search UX** - D2-T4-S1: Add global/current-workspace
search entry point. - D2-T4-S2: Build query input and submit/keyboard
behavior. - D2-T4-S3: Render result snippets, author, time, and
conversation context. - D2-T4-S4: Add pagination or load-more
behavior. - D2-T4-S5: Open the original conversation and focus/highlight
the matching message. - D2-T4-S6: Add no-results, loading, error,
timeout, and retry states. - D2-T4-S7: Safely highlight query terms
without HTML injection.

**D2-T5 --- Verify D2** - D2-T5-S1: Test accessible results across
public channels, private channels, and DMs. - D2-T5-S2: Test private
content leakage through totals, snippets, filters, and pagination. -
D2-T5-S3: Test edit/delete propagation and stale index behavior. -
D2-T5-S4: Test query validation, injection-like input, rate limits, and
timeouts. - D2-T5-S5: Test index retries, duplicate events, and
reconciliation. - D2-T5-S6: Load-test search with representative message
volume and access patterns.

------------------------------------------------------------------------

## Story D3 --- Filter search by conversation, author, and date

**User story:** As a user, I want to filter search results by
conversation, author, and date range so that I can narrow down relevant
messages.

### Acceptance criteria

-   AC1: Supported filters are explicitly documented and validated.
-   AC2: A channel filter can select only conversations the user is
    allowed to discover/access.
-   AC3: Author filters resolve to eligible users without leaking
    cross-workspace/private membership information.
-   AC4: Date range semantics and timezone behavior are documented;
    storage/query boundaries use UTC consistently.
-   AC5: Invalid or contradictory filters return a clear validation
    error.
-   AC6: Filters compose correctly with text search and pagination.
-   AC7: Filter options, counts, and facets do not expose inaccessible
    content.
-   AC8: Clearing a filter restores the expected result set without
    stale state.

### Tasks and subtasks

**D3-T1 --- Define filter contract** - D3-T1-S1: Define supported
filters and exact query parameter types. - D3-T1-S2: Define date
inclusivity, timezone conversion, and maximum range if needed. -
D3-T1-S3: Define filter combinations and invalid combinations. -
D3-T1-S4: Define authorized option sources for channels and authors.

**D3-T2 --- Implement filtered search** - D3-T2-S1: Validate filter
inputs and normalize dates. - D3-T2-S2: Apply filters in the search
backend without bypassing authorization. - D3-T2-S3: Ensure pagination
cursor incorporates relevant filter/query identity. - D3-T2-S4: Add
indexes or query tuning for supported filter combinations. - D3-T2-S5:
Ensure filters cannot be changed while reusing an incompatible cursor.

**D3-T3 --- Build filter UX** - D3-T3-S1: Add channel, author, and date
filter controls. - D3-T3-S2: Display active filters and a clear-all
action. - D3-T3-S3: Preserve query and filter state during
pagination/navigation as intended. - D3-T3-S4: Provide accessible labels
and keyboard interaction.

**D3-T4 --- Verify D3** - D3-T4-S1: Test each filter independently and
in combinations. - D3-T4-S2: Test timezone/day-boundary behavior. -
D3-T4-S3: Test private channel/DM leakage through filters. - D3-T4-S4:
Test cursor invalidation when query or filters change.

------------------------------------------------------------------------

## Story D4 --- Open a search result at the original message

**User story:** As a user, I want to open a search result in its
original conversation and locate the matching message so that I can
understand the surrounding context.

### Acceptance criteria

-   AC1: Clicking a result opens the correct channel or DM only if the
    user remains authorized.
-   AC2: The target message is loaded even when it is outside the most
    recent history page.
-   AC3: The UI loads sufficient surrounding context and highlights the
    target message accessibly.
-   AC4: If the message was deleted, moved out of scope, or access was
    revoked, the UI shows a clear safe state.
-   AC5: Thread search results open the correct thread and root context.
-   AC6: The deep link does not grant access by itself; server-side
    authorization is rechecked.
-   AC7: Back navigation returns to the prior search query, filters, and
    result position where practical.
-   AC8: Live updates and history pagination do not lose the target
    position.

### Tasks and subtasks

**D4-T1 --- Define deep-link contract** - D4-T1-S1: Define
conversation/message/thread route parameters. - D4-T1-S2: Define
authorized message-context query. - D4-T1-S3: Define
deleted/inaccessible/missing-message behavior. - D4-T1-S4: Define
search-state restoration behavior.

**D4-T2 --- Implement target-message retrieval** - D4-T2-S1: Implement
authorized lookup by message ID and target. - D4-T2-S2: Load surrounding
context with bounded queries. - D4-T2-S3: Handle thread root and reply
resolution. - D4-T2-S4: Return safe not-found/forbidden behavior.

**D4-T3 --- Build navigation and highlight** - D4-T3-S1: Navigate from
result to target conversation. - D4-T3-S2: Load target and surrounding
context without assuming it is in the latest page. - D4-T3-S3: Highlight
target with accessible focus treatment. - D4-T3-S4: Restore search state
on return. - D4-T3-S5: Handle stale/deleted/revoked results.

**D4-T4 --- Verify D4** - D4-T4-S1: Test recent and old message deep
links. - D4-T4-S2: Test thread reply/root navigation. - D4-T4-S3: Test
deleted message and revoked membership. - D4-T4-S4: Test search-state
restoration and accessibility.

------------------------------------------------------------------------

## Story D5 --- Browse shared files from conversation history

**User story:** As an authorized conversation participant, I want to
find files shared in a conversation so that I can return to documents
without scrolling through every message.

### Acceptance criteria

-   AC1: A conversation's file view lists only attachments linked to
    messages the user may access.
-   AC2: Results can be paginated and sorted predictably.
-   AC3: File name, type, uploader, timestamp, and conversation context
    are shown only when authorized.
-   AC4: Deleted messages, deleted attachments, and expired storage
    objects follow the attachment retention policy.
-   AC5: Download access is revalidated and cannot be obtained through a
    guessed object key.
-   AC6: Search/filtering by file name/type is supported only if
    included in the release contract.
-   AC7: Empty, loading, error, and unavailable-file states are handled.

### Tasks and subtasks

**D5-T1 --- Define file-history query** - D5-T1-S1: Define attachment
fields and sorting. - D5-T1-S2: Define behavior for deleted messages and
expired objects. - D5-T1-S3: Define optional filename/type filters.

**D5-T2 --- Implement authorized file listing** - D5-T2-S1: Query
attachments by authorized conversation and message. - D5-T2-S2: Add
indexes for conversation/time and file metadata as needed. - D5-T2-S3:
Enforce pagination and exclude unavailable/deleted records. - D5-T2-S4:
Reuse authorized download flow from C6.

**D5-T3 --- Build file-history UI** - D5-T3-S1: Add shared-files
tab/panel. - D5-T3-S2: Render metadata and safe previews. - D5-T3-S3:
Add pagination and optional filters. - D5-T3-S4: Handle
empty/unavailable/error states.

**D5-T4 --- Verify D5** - D5-T4-S1: Test channel and DM permission
boundaries. - D5-T4-S2: Test deleted/expired attachment behavior. -
D5-T4-S3: Test pagination, sorting, and download authorization.

------------------------------------------------------------------------

# 7. Cross-Cutting Enabler Stories --- Required for a Live Product

These enablers are not optional polish. If the repository already
provides them, verify and reuse them. Otherwise track and implement them
before release.

## Enabler E1 --- Resolve authenticated principal and workspace context

**Done when:** Every HTTP and real-time request resolves an
authenticated principal from the established session mechanism, resolves
workspace context from a trusted source, and verifies active workspace
membership before domain use cases execute. A client-selected workspace
ID is only a selector; it never grants authorization.

### Tasks

-   E1-T1: Inspect existing authentication/session and workspace
    membership implementation.
    -   E1-T1-S1: Identify session validation and expiration behavior.
    -   E1-T1-S2: Identify trusted workspace-selection mechanism.
    -   E1-T1-S3: Document principal shape and public module boundary.
-   E1-T2: Implement/reuse principal resolver.
    -   E1-T2-S1: Resolve principal from verified session.
    -   E1-T2-S2: Validate active user and membership.
    -   E1-T2-S3: Reject missing, expired, revoked, or invalid sessions.
    -   E1-T2-S4: Prevent client-supplied user/workspace IDs from
        overriding trusted context.
-   E1-T3: Test auth boundary.
    -   E1-T3-S1: Test unauthenticated and expired session.
    -   E1-T3-S2: Test removed/deactivated user.
    -   E1-T3-S3: Test cross-workspace request and manipulated IDs.
    -   E1-T3-S4: Test HTTP and socket parity.

**Workspace onboarding decision (2026-10-14):** Any Google account with a
verified email may sign in; there is no global workspace email allowlist.
Users can create multiple workspaces, and the creator receives the admin
role. Workspace admins create reusable invite links that store only a
token hash and expire after seven days. A recipient signs in before
accepting the link; acceptance adds workspace membership. The web app
offers workspace creation, invite-link copy/skip, and switching between
memberships. Email delivery is not implemented. HTTP membership checks
and the selected-workspace request header are implemented and tested;
socket authorization remains deferred until a socket surface exists.
Before using a database, run
`pnpm --filter @workspace/api workspaces:initialize`. For an existing
single-workspace deployment, preserve the old workspace ID, name, and
allowlist as `LEGACY_WORKSPACE_ID`, `LEGACY_WORKSPACE_NAME`, and
`LEGACY_WORKSPACE_ALLOWED_EMAILS` for the one-time membership migration.

## Enabler E2 --- Establish module boundaries and data access rules

**Done when:** Domain rules live in the appropriate module;
presentation/transport code does not import private internals of
unrelated modules; persistence is accessed through approved
gateways/repositories; dependency-boundary checks pass.

### Tasks

-   E2-T1: Map bounded contexts and ownership.
    -   E2-T1-S1: Assign channel/conversation/message ownership to the
        collaboration domain.
    -   E2-T1-S2: Identify shared identity/workspace contracts.
    -   E2-T1-S3: Define allowed module dependency directions.
-   E2-T2: Implement public ports/contracts.
    -   E2-T2-S1: Define commands, queries, DTOs, and domain events.
    -   E2-T2-S2: Export supported APIs through public module entry
        points.
    -   E2-T2-S3: Remove cross-module imports of private implementation
        files.
-   E2-T3: Add architecture enforcement.
    -   E2-T3-S1: Configure or update dependency-boundary rules.
    -   E2-T3-S2: Add persistence collection/table allow-list where used
        by the repository.
    -   E2-T3-S3: Run architecture checks in CI and document fixes.

## Enabler E3 --- Provide reliable event/outbox processing

**Done when:** Events that must not be lost are committed with the
corresponding state change, consumers are idempotent, retries are
bounded/observable, and failed events can be reconciled without manual
database edits.

### Tasks

-   E3-T1: Identify reliable events (message created/edited/deleted,
    membership changes, mentions, indexing).
    -   E3-T1-S1: Define event schema/version and event IDs.
    -   E3-T1-S2: Define which changes require same-transaction outbox
        writes.
    -   E3-T1-S3: Define consumer idempotency key.
-   E3-T2: Implement delivery and recovery.
    -   E3-T2-S1: Persist outbox record with state change.
    -   E3-T2-S2: Implement bounded retry/backoff.
    -   E3-T2-S3: Record attempts and terminal failures.
    -   E3-T2-S4: Add replay/reconciliation procedure.
-   E3-T3: Test reliability.
    -   E3-T3-S1: Test crash after commit before publish.
    -   E3-T3-S2: Test duplicate delivery.
    -   E3-T3-S3: Test poison event and terminal failure alert.
    -   E3-T3-S4: Verify no duplicate notification or search document.

## Enabler E4 --- Add security and abuse protections

**Done when:** Authorization, input validation, rate limits, safe
rendering, file security, session checks, and security-focused tests
cover every relevant API and real-time path.

### Tasks

-   E4-T1: Build permission matrix for channels, DMs, messages,
    reactions, pins, attachments, search, and history.
    -   E4-T1-S1: List actor/target/action combinations.
    -   E4-T1-S2: Define privacy-safe error behavior.
    -   E4-T1-S3: Turn the matrix into automated tests.
-   E4-T2: Add abuse controls.
    -   E4-T2-S1: Rate-limit message send, search, upload, reactions,
        and invitations.
    -   E4-T2-S2: Enforce request/body/file limits.
    -   E4-T2-S3: Add spam/abuse logging without message-body capture.
-   E4-T3: Harden data handling.
    -   E4-T3-S1: Escape/render user content safely.
    -   E4-T3-S2: Sanitize filenames and control download headers.
    -   E4-T3-S3: Review secrets, CORS/CSRF as applicable, cookie flags,
        and session invalidation.
    -   E4-T3-S4: Review data retention and deletion semantics.
-   E4-T4: Security verification.
    -   E4-T4-S1: Test IDOR/guessed IDs across every resource type.
    -   E4-T4-S2: Test cross-workspace isolation.
    -   E4-T4-S3: Test private-channel and DM leakage through
        search/real-time.
    -   E4-T4-S4: Run dependency/security checks available in the
        repository.

## Enabler E5 --- Observability and operations

**Done when:** The live service emits structured, privacy-safe logs and
useful metrics at important boundaries; dashboards/alerts cover failures
and latency; operators have documented recovery procedures.

### Tasks

-   E5-T1: Add structured request and domain logs.
    -   E5-T1-S1: Include request/correlation ID, module, workspace ID
        where safe, operation, outcome, and duration.
    -   E5-T1-S2: Never log message bodies, tokens, cookies, or
        attachment contents.
    -   E5-T1-S3: Redact personal data where unnecessary.
-   E5-T2: Add metrics.
    -   E5-T2-S1: Track message send success/failure and latency.
    -   E5-T2-S2: Track socket connections, reconnects, delivery
        failures, and authorization denials.
    -   E5-T2-S3: Track search latency, errors, and index lag.
    -   E5-T2-S4: Track upload failures and outbox backlog/failures.
-   E5-T3: Build dashboards and alerts.
    -   E5-T3-S1: Add module dashboard panels for key outcomes and
        latency.
    -   E5-T3-S2: Define thresholds with an on-call owner; avoid
        arbitrary alerts without an owner/action.
    -   E5-T3-S3: Verify panels with both successful and failed test
        runs.
-   E5-T4: Document operations.
    -   E5-T4-S1: Document local setup and production configuration.
    -   E5-T4-S2: Document database/object-store backup and restore.
    -   E5-T4-S3: Document outbox/search-index recovery.
    -   E5-T4-S4: Document incident triage and rollback.

## Enabler E6 --- CI, test strategy, and release gates

**Done when:** CI runs quality checks and relevant automated tests,
migrations are validated, and the release cannot be marked ready with
failing critical checks.

### Tasks

-   E6-T1: Define test layers.
    -   E6-T1-S1: Unit tests for domain rules.
    -   E6-T1-S2: Integration tests for database constraints,
        transactions, and repositories.
    -   E6-T1-S3: API/real-time contract tests.
    -   E6-T1-S4: End-to-end tests for critical user journeys.
-   E6-T2: Add CI checks.
    -   E6-T2-S1: Typecheck and lint.
    -   E6-T2-S2: Unit/integration tests.
    -   E6-T2-S3: Architecture/dependency boundary checks.
    -   E6-T2-S4: Migration/schema validation and build.
    -   E6-T2-S5: Security/dependency audit available to the project.
-   E6-T3: Add end-to-end smoke journeys.
    -   E6-T3-S1: Create channel, join, send message, receive live
        update.
    -   E6-T3-S2: Start DM, send message, reload, verify history.
    -   E6-T3-S3: Edit/delete, thread, reaction, mention, and unread
        flows.
    -   E6-T3-S4: Search result opens original message.
    -   E6-T3-S5: Prove a non-member cannot read a private channel/DM or
        search result.
-   E6-T4: Release readiness.
    -   E6-T4-S1: Define required checks and evidence for each story.
    -   E6-T4-S2: Verify clean build from a fresh checkout.
    -   E6-T4-S3: Verify migrations against a disposable database.
    -   E6-T4-S4: Verify environment variables are documented and
        validated at startup.

## Enabler E7 --- Production deployment and recovery

**Done when:** The app can be deployed to a documented target
environment with secure configuration, health checks, migrations,
backups, monitoring, and a rollback/recovery path.

### Tasks

-   E7-T1: Document deployment topology.
    -   E7-T1-S1: Identify web/API process, database, real-time
        transport, worker, search backend, and object storage needs.
    -   E7-T1-S2: Document minimum viable single-deployment topology and
        scaling constraints.
    -   E7-T1-S3: Document environment-specific configuration.
-   E7-T2: Implement runtime readiness.
    -   E7-T2-S1: Add health and readiness checks that distinguish
        process health from dependency health.
    -   E7-T2-S2: Validate required environment variables at startup
        without printing secrets.
    -   E7-T2-S3: Configure graceful shutdown and connection cleanup.
    -   E7-T2-S4: Ensure WebSocket and worker processes are supported by
        the chosen host.
-   E7-T3: Database and storage operations.
    -   E7-T3-S1: Document migration ordering and rollback constraints.
    -   E7-T3-S2: Configure automated backups and retention.
    -   E7-T3-S3: Document and periodically test restore.
    -   E7-T3-S4: Document object-storage cleanup and retention.
-   E7-T4: Release verification.
    -   E7-T4-S1: Deploy a staging build.
    -   E7-T4-S2: Run smoke tests against staging.
    -   E7-T4-S3: Verify logs, metrics, alerts, and error reporting.
    -   E7-T4-S4: Rehearse rollback or recovery for a failed release.

------------------------------------------------------------------------

# 8. Shared UX and Accessibility Requirements

Apply these requirements to all stories: - Every interactive control has
an accessible name and keyboard behavior. - Focus is visible; dialogs
manage focus and return focus on close. - Color is not the only signal
for unread, failed, selected, or permission state. - Long messages and
filenames wrap safely without breaking the layout. - Responsive layouts
work at supported mobile/tablet/desktop widths. - Loading states do not
trap users; errors explain what happened and what can be done next. -
Optimistic updates must reconcile with server truth and roll back on
failure. - Composer supports predictable keyboard behavior and does not
send accidentally when inserting a newline. - Timestamps use locale
formatting while persisted timestamps remain UTC. - Empty states explain
the next useful action. - Avoid excessive network requests and avoid
refetching entire histories for a small update.

# 9. Shared Non-Functional Requirements

These are release requirements; exact numeric targets must be confirmed
against the actual hosting/database environment before release rather
than invented.

## Security and privacy

-   Server-side authorization for every read/write, including real-time
    rooms and attachments.
-   Workspace and conversation isolation tests.
-   Input validation, payload limits, rate limits, secure session
    handling, and safe rendering.
-   No secrets or message content in standard logs.
-   Document retention, deletion, and administrative access policy.

## Reliability

-   Persist before acknowledging successful sends.
-   Idempotent retry behavior for mutation commands and event consumers.
-   Stable ordering and cursor pagination.
-   Reconnect/resynchronization behavior for real-time clients.
-   Retry, dead-letter/failure visibility, and reconciliation for
    derived indexes/events.

## Performance

-   Define target response times and supported concurrent users after
    baseline measurement.
-   Index every common scoped query based on query plans, not guesswork.
-   Avoid unbounded history/search queries and N+1 data loading.
-   Load-test send, history, search, and real-time fan-out using
    representative data.
-   Record p50/p95/p99 where meaningful, error rate, and resource use.

## Maintainability

-   Type-safe contracts and input schemas.
-   Clear module ownership and public interfaces.
-   Tests near the relevant module and CI enforcement.
-   Versioned events where consumers may outlive a deployment.
-   Document architectural decisions that materially affect storage,
    search, realtime, or deletion semantics.

# 10. Release Acceptance Scenarios

Before calling Release 1 complete, automate these end-to-end journeys:

1.  User A signs in, opens a workspace, creates a public channel, and
    becomes a member.
2.  User B joins the public channel and sees messages sent after
    joining.
3.  User A creates a private channel and invites User B; User C, who is
    not a member, cannot see its details, messages, events, files, or
    search results.
4.  User A sends a message; it persists, appears once to sender and
    recipient, and remains after refresh/reconnect.
5.  User A retries the same send request with the same idempotency key;
    exactly one logical message exists.
6.  User A edits and deletes their own message; unauthorized User B
    cannot edit/delete it unless a documented moderator rule allows it.
7.  User A replies in a thread; reply count, thread history, and live
    delivery remain consistent.
8.  User A adds/removes a reaction; counts remain correct under repeated
    requests.
9.  User A mentions User B; B receives at most one eligible in-app
    notification for the event.
10. User A uploads a file; authorized participants can access it, while
    a non-member cannot access it through a guessed ID or URL.
11. User A starts a one-to-one DM with B; repeated create/open
    operations return the canonical DM.
12. User A creates a group DM; only current participants can access it
    and participant changes follow the documented history policy.
13. A user's unread/read state remains independent per conversation and
    does not move backward under concurrent events.
14. User A searches for a phrase and filters by channel, author, and
    date; results are stable and authorized.
15. A search result for an older message opens the correct
    conversation/thread and highlights the target.
16. An edited/deleted message no longer exposes stale content through
    search or ordinary history.
17. Membership is revoked while a socket is connected; subsequent
    history reads, mutations, subscriptions, and downloads are denied.
18. Database/search/socket/storage failures produce visible, recoverable
    errors and useful privacy-safe telemetry.
19. CI from a clean checkout passes typecheck, lint,
    unit/integration/e2e tests, architecture checks, and production
    build.
20. A staging deployment passes smoke tests, health/readiness checks,
    monitoring verification, and documented rollback/recovery checks.

------------------------------------------------------------------------

# 11. Product Decisions Codex Must Not Guess

Before implementing the affected story, inspect whether the repository
or product owner has already decided these. If not, record a concise
decision proposal and ask for approval rather than burying an
irreversible assumption in code.

1.  Public-channel history: can any workspace member read before
    joining, or only after joining?
2.  Channel names: uniqueness case-sensitive or case-insensitive? Which
    characters are allowed?
3.  Channel deletion: archive-only in Release 1, or hard delete under a
    retention policy?
4.  Channel roles: which actions require channel manager/admin?
5.  DM identity: one canonical DM per user pair, or can the same pair
    create separate DMs?
6.  Group DM identity: reuse identical participant sets or allow
    multiple groups with the same members?
7.  Group DM management: who can add/remove participants, and what
    history can new/removed participants access?
8.  Message deletion: hard delete or tombstone? What is retained for
    audit/legal reasons?
9.  Message editing: is there an edit window or revision history?
10. Thread model: root-only threads or nested replies?
11. Mentions: individual mentions only, or also @here/@channel?
12. Attachments: supported types, size limits, malware scanning, and
    retention.
13. Unread behavior: when does opening/scrolling mark a conversation
    read?
14. Search: expected freshness target, ranking, syntax, and index
    backend.
15. Admin access: can workspace admins access private-channel/DM
    content? Default should be no hidden content-access backdoor.
16. Release performance targets and expected initial workspace/message
    volume.
17. Deployment host and support for persistent WebSocket
    connections/background workers.
18. Data residency, backups, retention, and deletion obligations.

Use conservative secure defaults while waiting for decisions: deny
unauthorized access, do not expose private content, archive rather than
irreversibly delete, and avoid silently granting administrators access
to private messages.

# 12. How Codex Should Execute the Backlog

For each story: 1. Read the story, acceptance criteria, related shared
contracts, and relevant decision items. 2. Inspect existing code and
tests before implementation. 3. Report the intended files/modules and a
concise plan. 4. Implement domain/use-case/persistence/API/realtime/UI
layers in the repository's established order. 5. Add automated tests
mapped to every AC, including negative authorization tests. 6. Run
focused tests, then typecheck/lint/architecture checks, then broader
tests as feasible. 7. Inspect the diff for secrets, logging of sensitive
content, boundary violations, and accidental unrelated changes. 8.
Update API/schema/operations documentation. 9. Report: acceptance
criteria passed, commands actually run, observed outcomes, files
changed, known gaps, and next story dependencies. 10. Do not mark Done
if any acceptance criterion is untested, failing, or only simulated with
a mock where real integration is required.

## Suggested story status model

-   **Backlog:** Not started.
-   **Ready:** Dependencies and product decisions are clear.
-   **In Progress:** Implementation underway.
-   **Blocked:** A named dependency/decision prevents safe progress.
-   **In Review:** Implementation and checks are complete; review
    pending.
-   **Done:** Acceptance criteria have evidence, tests pass,
    documentation is updated, and no known release-blocking gap remains.

## Final principle

Build the smallest coherent version of each capability, but do not
compromise authorization, persistence correctness, idempotency, search
privacy, or recoverability to make a demo appear finished. A feature is
complete when its happy path, failure paths, security boundaries, and
operational behavior are understood and tested.
