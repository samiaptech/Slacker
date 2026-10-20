# Squid Integration & Engineering Constitution

## Agent Instructions for a Lightweight, Production-Ready Slack-Like Platform

**Document purpose:** This is the implementation constitution for the
chat/collaboration platform that will eventually be merged into Squid.
Follow it before creating modules, changing architecture, adding
dependencies, or implementing backlog stories.

**Primary objective:** Build a professional, lightweight, secure,
maintainable collaboration product with channels, conversations, direct
messages, messaging tools, search, and message history. The application
runs as a **monolith at deployment time**, but its code must be a
**modular monolith**: independently understandable modules with explicit
boundaries and low coupling.

**This document is an engineering standard, not permission to rewrite
the repository.** Inspect the current Squid codebase first, preserve
working behavior, and adapt this standard to existing architecture where
possible. If a requirement conflicts with a documented Squid
architecture decision, stop and report the conflict before changing the
boundary.

------------------------------------------------------------------------

# 1. Non-Negotiable Instructions for the Agent

## 1.1 Before writing code

1.  Inspect the repository structure, package manager, workspace
    configuration, architecture rules, module exports,
    authentication/session flow, database access patterns, test setup,
    CI checks, and deployment setup.
2.  Read relevant ADRs, architecture documents, contribution rules, and
    existing backlog stories.
3.  Identify the existing module responsible for each capability. Extend
    it instead of creating a duplicate.
4.  Produce a short implementation plan: files likely to change,
    boundaries involved, tests to add, migration implications, and
    risks.
5.  Implement one dependency-ready story or vertical slice at a time. Do
    not attempt the entire backlog in one uncontrolled change.
6.  Run the repository's established checks before and after changes.
    Record actual commands and results.
7.  If the repository uses pnpm workspaces, keep using pnpm. Do not
    switch to npm or another package manager without an explicit
    decision.

## 1.2 Never do these things

-   Do not turn the monolith into microservices just to create
    independence.
-   Do not create a giant `utils`, `common`, `shared`, `helpers`, or
    `services` dumping ground.
-   Do not allow one feature to import another feature's private
    controllers, repositories, models, validators, or database
    collections.
-   Do not put business rules in controllers, route files, React
    components, database schemas, or event handlers.
-   Do not let frontend code access MongoDB or server-only modules.
-   Do not make raw database calls outside the approved
    persistence/repository boundary.
-   Do not use unrestricted MongoDB queries supplied by the client.
-   Do not trust workspace, organization, user, role, or membership IDs
    from the request body without resolving and authorizing them against
    the authenticated principal.
-   Do not use client-provided `userId` as proof of identity.
-   Do not store passwords, OAuth secrets, access tokens, refresh
    tokens, session secrets, or message attachment contents in logs.
-   Do not expose private channel content, DM content, deleted content,
    or search results across workspace boundaries.
-   Do not implement realtime delivery as the source of truth. Persist
    authorized changes first; then publish events.
-   Do not create a new abstraction, dependency, collection, event bus,
    state library, or framework without a concrete requirement.
-   Do not add a dependency just because it is popular. Explain the
    purpose and maintenance cost.
-   Do not use `any`, disable type checking, skip lint rules globally,
    or weaken tests to make a check pass.
-   Do not swallow errors, return success for failed writes, or silently
    ignore authorization failures.
-   Do not mark acceptance criteria complete without evidence from
    automated tests or a clearly documented manual verification.
-   Do not change unrelated files, reformat the entire repository, or
    rename established modules as collateral damage.
-   Do not create migrations or destructive data changes without a safe
    migration/rollback plan.
-   Do not claim a feature is production-ready solely because it works
    locally.

## 1.3 Definition of done

A story is not Done until all applicable items are true:

-   Acceptance criteria are implemented and traceable to tests.
-   Authorization is enforced on the server for every relevant
    operation.
-   Validation and predictable error responses are present.
-   Database reads/writes follow the module's approved
    repository/gateway.
-   Workspace and conversation privacy boundaries are tested.
-   Unit, integration, and relevant UI tests pass.
-   Relevant typecheck, lint, architecture-boundary checks, and build
    pass.
-   Loading, empty, error, retry, and permission-denied UI states are
    handled.
-   Logs and metrics avoid secrets and message content.
-   Documentation, environment examples, and migrations are updated
    where needed.
-   No new critical vulnerability or known data-loss risk is introduced.
-   The agent reports changed files, checks run, results, known
    limitations, and the next dependency-ready story.

------------------------------------------------------------------------

# 2. Architecture: One Deployed Monolith, Many Independent Modules

Use a **modular monolith**. Next.js and the Express API may be deployed
together or as coordinated processes in the same product, but domain
modules must not depend on each other's private internals. "Independent"
means a module has a clear purpose, contract, owner, data-access
boundary, tests, and controlled dependencies---not that every module
must be a separate service or package.

## 2.1 Target logical structure

Adapt names to the current repository rather than blindly moving files.
A possible structure is:

``` text
repo/
├── apps/
│   ├── web/                         # Next.js UI; server/client rendering
│   └── api/                         # Node.js + Express HTTP API
├── packages/
│   ├── contracts/                   # Stable API/event schemas only, if needed
│   ├── config/                      # Shared lint/TypeScript/test configuration
│   └── ui/                          # Reusable presentational UI, if genuinely shared
├── src/ or modules/                 # Follow the existing Squid convention
│   ├── identity/
│   │   ├── public/                  # Public exports/contracts
│   │   ├── domain/
│   │   ├── application/
│   │   ├── http/
│   │   ├── persistence/
│   │   ├── events/
│   │   └── tests/
│   ├── workspaces/
│   ├── channels/
│   ├── conversations/
│   ├── messaging/
│   ├── search/
│   ├── files/
│   └── notifications/
├── docs/
│   ├── architecture/
│   ├── adr/
│   └── backlog/
└── ...
```

This is an example, not a mandate to create every folder or package.
Follow the repository's existing layout and architecture checks. Do not
create empty modules in advance.

## 2.2 Module boundaries

Each domain module owns its business rules and persistence operations. A
module may expose a small public API such as application
commands/queries, DTOs, and domain events. Other modules use only that
public API.

Example: - `channels` owns channel creation, channel settings, channel
visibility, and channel membership rules. - `conversations` owns
conversation identity, DM/group-DM participants, and conversation
lifecycle. - `messaging` owns message creation, edits, deletion,
reactions, threads, and message-level rules. - `search` owns query
orchestration and search indexing, but must apply the same authorization
rules as the source data. - `files` owns upload metadata, access
permissions, and file lifecycle. - `identity` owns
authentication/session identity. It does not secretly create
workspace/channel records unless a documented application-level use case
coordinates this. - `workspaces` owns workspace membership and
workspace-level permissions.

If a use case needs multiple modules, orchestrate it in an
application/use-case layer that depends on public contracts. Do not
import another module's repository to "save time."

## 2.3 Dependency direction

Preferred direction:

``` text
HTTP routes/controllers
        ↓
Application services / use cases
        ↓
Domain rules and module-owned ports
        ↑
Repository implementations / external adapters
```

-   Domain logic must not depend on Express, Next.js, MongoDB, or React.
-   Controllers translate HTTP input/output; they do not implement
    business policy.
-   Application services coordinate a use case and its transaction
    boundary.
-   Repositories implement persistence ports and hide MongoDB details.
-   Route files register endpoints and middleware only.
-   UI components call typed API functions or Server Actions where the
    architecture explicitly permits them; they do not import backend
    repositories.
-   Infrastructure details must not leak into public module contracts.

Do not force artificial layers into tiny modules if they add no value.
Keep the boundary real and the implementation simple.

## 2.4 Public and private module API

Each module must have an explicit public entry point, for example
`modules/channels/index.ts` or the repository's established equivalent.

Allowed cross-module imports: - Public use-case interfaces or
functions. - Stable public DTOs and contracts. - Public domain events
where needed.

Forbidden cross-module imports: - `modules/channels/persistence/*` from
another module. - `modules/messaging/controllers/*` from another
module. - Private model/schema files, internal helper functions, or
direct collection names. - Deep relative imports that bypass the public
entry point.

Enforce this with the repository's architecture checker, lint rules,
dependency-cruiser, or equivalent existing tooling. A rule that exists
only in documentation is not enough when automated enforcement is
feasible.

## 2.5 API endpoint boundary

Every API resource/feature must have a clear route, controller,
validation, application service, persistence/repository, and test
boundary. This does **not** mean duplicating files for every tiny
endpoint if multiple endpoints are part of the same cohesive resource.
Group related operations in a resource module and keep each
responsibility separate.

For an Express feature, a typical layout is:

``` text
channels/
├── routes.ts              # Route registration and middleware composition
├── controller.ts          # HTTP input/output only
├── validation.ts          # Joi request validation
├── service.ts             # Use-case orchestration
├── repository.ts          # Interface/port or module-owned persistence contract
├── mongo.repository.ts    # MongoDB implementation, if the project uses this split
├── model.ts               # Domain types; keep separate from DB schema
├── mongo.schema.ts        # MongoDB/Mongoose schema only if Mongoose is selected
├── errors.ts              # Module-specific application errors
└── tests/
    ├── service.test.ts
    ├── controller.test.ts
    └── routes.integration.test.ts
```

Use the actual repository's conventions. Do not create a Mongoose schema
if using the native MongoDB driver, and do not duplicate one model in
several folders.

## 2.6 Transactions and cross-module workflows

-   A transaction belongs to the application use case that owns the
    overall operation.
-   Keep transaction boundaries explicit.
-   Do not make unrelated modules reach into each other's collections to
    simulate a transaction.
-   Use MongoDB transactions only where their guarantees are needed and
    the deployment topology supports them.
-   For important persisted state changes that must emit an event, use a
    transactional outbox or another documented reliable pattern.
-   Consumers must be idempotent. Expect retries and duplicate delivery.
-   Realtime notifications must follow successful persistence; do not
    broadcast uncommitted or unauthorized data.
-   If a workflow spans module boundaries, document its owner,
    contracts, failure modes, and recovery behavior.

------------------------------------------------------------------------

# 3. API Standards: Express + Node.js

## 3.1 HTTP layering

For each resource: 1. Route: HTTP method/path, middleware, controller
mapping. 2. Middleware: authentication, request ID, rate limiting, and
shared concerns. 3. Validation: validate body, params, and query
separately. 4. Controller: parse validated input, call a use case, map
output/errors to HTTP. 5. Service/use case: enforce business rules and
coordinate repositories. 6. Repository: apply explicit query conditions
and persist data. 7. Tests: unit tests and integration tests covering
real boundaries.

Controllers should be small. A controller must not directly build
MongoDB filters, perform multi-step business workflows, or contain
authorization policy.

## 3.2 Request validation: Joi and Zod

The project asked to use both Joi and Zod. Avoid maintaining two
competing validators for the same request.

Recommended allocation: - **Joi:** Express API request validation at the
HTTP boundary (`params`, `query`, `body`). - **Zod:** environment/config
validation, typed shared contracts where appropriate, and frontend form
validation when useful. - Never validate a request with Joi and then
repeat the same schema in Zod without a clear reason. - If Squid already
has a single validation standard, follow it rather than introducing a
second library solely to satisfy this document. - Do not treat
TypeScript types as runtime validation; types disappear at runtime. -
Reject unknown or dangerous fields where appropriate. Do not blindly
pass validated request objects into database updates.

## 3.3 Consistent API behavior

-   Version public APIs when compatibility requires it; avoid
    speculative versioning for every internal route.
-   Use a consistent JSON response and error format across modules.
-   Use correct HTTP status codes; do not return `200` for errors.
-   Include a stable machine-readable error code, safe user-facing
    message, request/correlation ID, and field-level validation details
    where useful.
-   Never expose stack traces, database errors, internal file paths,
    tokens, or sensitive implementation details in production responses.
-   Define pagination consistently. Prefer cursor pagination for large,
    frequently changing message histories.
-   Bound page sizes and search result counts.
-   Use explicit sorting with a stable tie-breaker such as `_id`.
-   Set request/body size limits and timeouts appropriate to the
    operation.
-   Apply rate limits to login, message sending, search, upload
    initiation, invitations, and other abuse-prone endpoints.
-   Add health/readiness endpoints without revealing secrets or
    infrastructure details.
-   Keep OpenAPI documentation if the repository already uses it;
    otherwise consider `swagger-jsdoc` + `swagger-ui-express` or a
    contract-first alternative only if useful.

## 3.4 Authentication and authorization

-   Authentication answers "who is this principal?" Authorization
    answers "may this principal perform this action on this resource?"
-   Resolve the principal from a trusted session/token mechanism; never
    from client-submitted identity fields.
-   Check workspace membership, channel membership/visibility,
    conversation participation, and resource permissions on the server
    for every request.
-   Default to deny when resource membership or workspace scope cannot
    be proven.
-   Check authorization before returning message content, metadata,
    attachment URLs, search snippets, counts, or history.
-   Prevent IDOR/BOLA: changing an ID in a URL must not grant access to
    another user's or workspace's resource.
-   Avoid leaking whether a private channel or DM exists when the
    requester is unauthorized.
-   Use secure cookies and suitable CSRF protection when cookie-based
    authentication requires it.
-   Validate OAuth/OIDC state, nonce, issuer, audience, expiry, and
    redirect URLs when applicable.
-   Keep secrets in environment/secret management, not source control or
    frontend bundles.
-   Add abuse protection and safe session revocation behavior.
-   Write authorization tests for allowed and denied cases, including
    cross-workspace attempts.

------------------------------------------------------------------------

# 4. MongoDB and Persistence Standards

## 4.1 Choose one persistence approach

First inspect Squid's current database access layer. Use its established
approach if sound.

-   If using the **native MongoDB driver**, keep repository methods
    typed and centralize collection access. Do not invent ODM schemas.
-   If using **Mongoose**, use schemas and models in the persistence
    layer, keep business rules out of schema hooks where possible, and
    avoid mixing native-driver and Mongoose access patterns without a
    documented reason.
-   Do not add both drivers/approaches just for convenience.
-   Do not let controllers or UI import database models directly.

## 4.2 Data ownership and queries

-   Each module owns its collections/tables and repository access.
-   Other modules must call its public application API rather than
    querying its collections directly.
-   Every query must include its required workspace/resource scope.
-   Apply authorization scope in the database query wherever practical,
    not only after fetching records.
-   Use explicit field projections to avoid returning unnecessary
    private data.
-   Exclude soft-deleted records by default if the product uses soft
    deletion.
-   Treat deletion semantics as a product decision: distinguish
    user-visible deletion, retention, audit requirements, and permanent
    removal.
-   Validate ObjectId/string conversion at the boundary.
-   Use unique indexes for actual uniqueness guarantees;
    application-only checks are race-prone.
-   Create compound indexes based on real query patterns and verify with
    explain plans.
-   Never add an index without understanding its write/storage cost.
-   Avoid unbounded arrays for message history, participants, reactions,
    or large channel membership lists.
-   Avoid one huge document per conversation or workspace.
-   Set retention and cleanup policies for temporary uploads, sessions,
    outbox records, and obsolete indexes where appropriate.
-   Use migrations or controlled scripts for data shape changes; make
    them repeatable, observable, and safe to resume.

## 4.3 Suggested logical data ownership

This is an initial guide, not a final schema. Confirm with the existing
Squid data model and ADRs before implementing.

-   Identity: users, external identity links, sessions, authentication
    events as required.
-   Workspace: workspaces, workspace memberships, roles/invitations.
-   Channels: channels, channel membership/visibility settings.
-   Conversations: direct/group conversation records and participant
    relationships.
-   Messaging: messages, edits/deletion metadata, reactions, thread
    relationships, read/unread state if owned here.
-   Files: upload metadata, ownership, access policy, scan status.
-   Search: indexes/documents or provider-specific search metadata;
    source records remain owned by their modules.
-   Notifications: delivery state/preferences where needed.
-   Outbox: reliable event records, with a clearly documented
    ownership/retention strategy.

Do not store all messages inside a channel document. Message volume
grows without bound; messages should be separate records with indexes
suited to history and thread queries.

## 4.4 Message integrity and concurrency

-   Persist messages before publishing realtime events.
-   Use server-generated timestamps and stable message IDs.
-   Define edit/delete rules and preserve the correct audit/retention
    semantics.
-   Make retry behavior idempotent where clients or infrastructure can
    retry writes.
-   Consider client-generated idempotency keys for send operations where
    duplicate messages would be harmful.
-   Use optimistic concurrency/version checks where simultaneous edits
    can conflict.
-   Never trust client timestamps to determine message order or
    authorization.
-   Define stable cursor pagination using a compound sort key (for
    example, creation time plus unique ID).
-   Test concurrent sends, retries, deletion, and thread/reaction edge
    cases.

------------------------------------------------------------------------

# 5. Realtime and Messaging Reliability

Realtime is a delivery mechanism, not the canonical database.

-   Use WebSocket or Socket.IO only if it fits the existing stack and
    product needs. If adopting Socket.IO, keep its handlers/adapters
    separate from domain logic.
-   Authenticate socket connections and authorize every
    room/channel/conversation subscription.
-   Never let a client join a room merely by supplying a room name or
    ID.
-   Re-check permissions when access changes, and remove
    disconnected/revoked participants from protected rooms.
-   Scope events to the correct workspace, channel, conversation, and
    participant set.
-   Do not broadcast message content to users who lack access.
-   Use event names and payload schemas as stable contracts.
-   Keep payloads small; avoid sending full message histories through
    events.
-   Clients must handle reconnects, duplicate events, out-of-order
    delivery, and missed events.
-   On reconnect, fetch authoritative missed data using cursors/sync
    tokens rather than assuming every event was received.
-   Use an outbox or equivalent reliability strategy for events that
    must not be lost after a successful database commit.
-   Make event consumers idempotent.
-   Add backpressure, connection limits, heartbeat handling, and
    graceful shutdown behavior.
-   Test unauthorized subscriptions, membership revocation, reconnects,
    duplicate events, and cross-workspace isolation.

Do not add Kafka, Redis, NATS, or another broker by default. Introduce a
broker only when measured scale, delivery requirements, or deployment
topology justify its operational cost. If horizontal scaling requires a
Socket.IO adapter or shared pub/sub, document and test that requirement.

------------------------------------------------------------------------

# 6. Next.js Frontend Standards

## 6.1 Rendering and server/client boundaries

-   Follow the existing Next.js version and App Router/Pages Router
    choice. Do not migrate routers as unrelated cleanup.
-   Prefer Server Components for read-only rendering and initial data
    loading when compatible with the existing architecture.
-   Use Client Components only for interactivity, browser APIs, local UI
    state, or realtime client behavior.
-   Keep client component boundaries small; do not mark an entire page
    `"use client"` just to support one interactive control.
-   Do not import Express controllers, MongoDB drivers/models, secrets,
    or server-only services into client bundles.
-   Keep server-only code explicitly separated and prevent accidental
    client imports.
-   Use a typed API client for HTTP calls and consistent error handling.
-   Avoid fetching the same data repeatedly in both server and client
    layers.
-   Use pagination/virtualization for large message lists; never render
    an unbounded history.
-   Handle loading, empty, error, offline, reconnecting,
    permission-denied, and retry states.
-   Use accessible semantic HTML and keyboard interactions.

## 6.2 Frontend architecture

-   Group UI by product feature, not by arbitrary file type alone.
-   Keep presentation components separate from feature-level data
    fetching and state coordination.
-   Reuse components only when their semantics and behavior are
    genuinely shared.
-   Keep server state, local UI state, and realtime synchronization
    concerns distinct.
-   Prefer built-in React/Next.js capabilities before adding a state
    library.
-   Avoid prop drilling across many levels, but do not introduce global
    state for state used by one component.
-   Avoid duplicating server data in a global client store without a
    clear cache/synchronization strategy.
-   Do not store access tokens or secrets in localStorage.
-   Keep forms accessible, validated, and resilient to network errors.

## 6.3 Realtime UI behavior

-   Optimistic UI is acceptable only where rollback and reconciliation
    are well-defined.
-   Show pending/failed states for messages if the user can otherwise
    assume a message was delivered.
-   Deduplicate messages by stable server/client correlation IDs.
-   Reconcile optimistic messages with authoritative server responses.
-   Do not claim "sent," "delivered," or "read" unless the system has a
    defined and measured meaning for that state.
-   Avoid excessive rerenders: memoize only when measurement or clear
    component behavior warrants it.
-   Virtualize long histories when performance requires it, but preserve
    keyboard navigation and accessibility.

------------------------------------------------------------------------

# 7. Professional Product Theme and Design System

Use a **calm, modern, professional collaboration theme**: warm off-white
surfaces, deep ink text, restrained indigo/blue accents, subtle borders,
and clear status colors. The product should feel fast and focused---not
like a neon gaming dashboard.

## 7.1 Suggested design tokens

Treat these as initial tokens to review against Squid's current brand.
If Squid already has a design system, extend it rather than introducing
a conflicting palette.

  -----------------------------------------------------------------------
  Token                   Suggested value         Use
  ----------------------- ----------------------- -----------------------
  `color-bg`              `#F7F8FA`               Main app canvas

  `color-surface`         `#FFFFFF`               Cards, dialogs, message
                                                  composer

  `color-surface-muted`   `#F1F3F6`               Hovered rows, secondary
                                                  panels

  `color-text`            `#172033`               Primary text and
                                                  headings

  `color-text-muted`      `#667085`               Subtitles, timestamps,
                                                  helper text

  `color-border`          `#E3E7EE`               Dividers and subtle
                                                  outlines

  `color-primary`         `#4657D9`               Primary action,
                                                  selected nav, focused
                                                  controls

  `color-primary-hover`   `#3646C5`               Hover/pressed primary
                                                  action

  `color-primary-soft`    `#EEF0FF`               Selected background,
                                                  non-text emphasis

  `color-success`         `#16845B`               Success states

  `color-warning`         `#A15C07`               Warnings

  `color-danger`          `#C43232`               Errors and destructive
                                                  actions

  `color-info`            `#1677A8`               Informational states
  -----------------------------------------------------------------------

Requirements: - Verify text/background contrast meets WCAG 2.2 AA
targets where applicable. - Never use color as the only indicator of
status; include labels/icons. - Define dark mode only if it can be
maintained consistently with tokens and tested. Do not implement a
second theme halfway. - Use design tokens/CSS variables; do not scatter
raw hex codes across components. - Avoid excessive shadows, gradients,
glass effects, animations, and decorative borders. - Use motion for
feedback and orientation, not decoration. Respect
`prefers-reduced-motion`.

## 7.2 Typography

Recommended: - **Inter** for the primary UI font: neutral, readable,
professional. - Use `next/font` to self-host/optimize the font when
practical; avoid a blocking external font request. - Use a system-font
fallback stack. - Use tabular numerals for timestamps, counters, and
aligned numeric metadata where helpful.

Suggested type scale:

  -----------------------------------------------------------------------
  Style                   Size / line height      Use
  ----------------------- ----------------------- -----------------------
  Page title / H1         24--28px / 1.25         Main page title, one
                                                  clear H1 per page

  Section title / H2      18--20px / 1.35         Main content sections

  Subsection / H3         15--16px / 1.4          Panels, dialogs,
                                                  grouped settings

  Body                    14--15px / 1.5          Main application
                                                  content and messages

  Secondary               12--13px / 1.45         Timestamps, helper
                                                  text, metadata

  Compact label           11--12px / 1.4          Rare dense
                                                  table/metadata labels;
                                                  do not use for
                                                  important content
  -----------------------------------------------------------------------

Use semantic heading order (`h1`, then `h2`, then `h3`) based on
document structure, not visual size alone. Avoid using headings for
every message or list row. Message content should remain comfortably
readable.

## 7.3 Spacing, shape, and layout

-   Use a consistent 4px-based spacing scale (4, 8, 12, 16, 20, 24, 32).
-   Use 8--12px corner radii for controls and cards; avoid making every
    surface a pill.
-   Keep borders subtle and consistent.
-   Provide visible focus rings for keyboard users.
-   Prefer compact, information-dense layouts without making controls
    cramped.
-   Use a stable workspace shell: left navigation/sidebar, central
    content, and optional right-side details/thread panel.
-   Make the sidebar collapsible where appropriate; preserve clear
    labels and accessible names.
-   Ensure responsive behavior for laptop, tablet, and narrow mobile
    screens.
-   Keep the message composer easy to find and keyboard accessible.
-   Use skeletons only where they improve perceived loading; avoid
    layout shifts.
-   Use consistent empty states with a short explanation and one useful
    next action.

## 7.4 Interaction rules

-   Hover states should be subtle; focus states must be visible.
-   Buttons need clear primary, secondary, ghost, and destructive
    variants.
-   Destructive actions require clear wording and confirmation when the
    action is consequential or hard to reverse.
-   Menus and dialogs must support keyboard navigation, Escape behavior,
    and focus management.
-   Show actionable validation errors near the relevant field.
-   Use toast notifications sparingly; important failures must remain
    visible until understood.
-   Keep animation short and restrained; respect reduced-motion
    preferences.
-   Avoid fake activity, decorative counters, or UI that suggests events
    occurred when they did not.
-   Establish consistent icon usage and do not mix multiple icon styles.

------------------------------------------------------------------------

# 8. Accessibility and Responsive Quality

Target **WCAG 2.2 AA** for key flows.

-   Keyboard-only operation for navigation, channels, conversations,
    search, composer, menus, dialogs, and reactions.
-   Visible focus state and logical focus order.
-   Proper labels, accessible names, semantic landmarks, and heading
    hierarchy.
-   Screen-reader announcements for meaningful asynchronous events
    without announcing every incoming message excessively.
-   Sufficient contrast and non-color status indicators.
-   Reduced-motion support.
-   Touch targets sized appropriately for mobile use.
-   Respect zoom/text scaling and avoid fixed-height content that clips
    text.
-   Test empty, loading, error, permission-denied, and offline states at
    narrow widths.
-   Use automated accessibility checks as a supplement; do not treat
    them as a substitute for keyboard/manual checks.

------------------------------------------------------------------------

# 9. Package Recommendations

**Do not install this entire list blindly.** First inspect current
dependencies and versions. Use the minimum set that solves a real need,
pin/lock versions through the existing package manager, and document why
any new runtime dependency is required.

## 9.1 Core stack (requested)

  -----------------------------------------------------------------------
  Package / technology    Purpose                 Guidance
  ----------------------- ----------------------- -----------------------
  Node.js                 Server runtime          Use a supported LTS
                                                  release; pin the
                                                  project runtime policy

  TypeScript              Static type checking    Strongly recommended
                                                  across API and UI

  Express                 HTTP API                Keep routes/controllers
                                                  thin; centralize
                                                  middleware and errors

  Next.js                 Web application         Use the version already
                                                  adopted by Squid unless
                                                  a migration is approved

  MongoDB                 Persistence             Use existing native
                                                  driver or Mongoose
                                                  approach consistently

  Jest                    Automated tests         Use for
                                                  unit/integration tests
                                                  if compatible with
                                                  current repo

  Joi                     Express request         Validate
                          validation              params/query/body at
                                                  API boundary

  Zod                     Config and selected     Avoid duplicate schemas
                          typed contracts/forms   for the same boundary

  ESLint                  Code quality            Use current repo
                                                  config; no global rule
                                                  disabling

  Prettier                Formatting              Add only if not already
                                                  configured

  `tsx` or `ts-node`      TypeScript development  Prefer one appropriate
                          execution               tool, not both by
                                                  default
  -----------------------------------------------------------------------

## 9.2 Strongly considered packages

  ---------------------------------------------------------------------------------
  Package                        Why it may help            Caution
  ------------------------------ -------------------------- -----------------------
  `mongodb` **or** `mongoose`    Database driver/ODM        Choose one primary
                                                            approach

  `supertest`                    HTTP API integration tests Pair with Jest for
                                                            Express routes

  `mongodb-memory-server`        Isolated MongoDB tests     Useful, but transaction
                                                            tests may require
                                                            replica-set
                                                            configuration; don't
                                                            treat in-memory tests
                                                            as production proof

  `pino`                         Structured, low-overhead   Redact secrets; never
                                 logging                    log message bodies by
                                                            default

  `helmet`                       Security-related HTTP      Configure with the
                                 headers                    actual app and
                                                            deployment

  `cors`                         Explicit CORS policy if    Do not use permissive
                                 web/API origins require it wildcard credentialed
                                                            CORS

  `express-rate-limit`           Request throttling         For multiple API
                                                            instances, choose a
                                                            shared store when
                                                            required

  `cookie-parser`                Parse cookies if needed    Parsing is not session
                                                            security or CSRF
                                                            protection

  `express-session`              Server-side sessions if    Use a production
                                 selected                   session store; never
                                                            use the default
                                                            in-memory store in
                                                            production

  `jose`                         JWT/JWS/JWK/OIDC-related   Use only for the
                                 primitives                 applicable token
                                                            protocol; configure
                                                            validation carefully

  `socket.io`                    Realtime transport         Add only if realtime is
                                                            in scope; keep domain
                                                            logic
                                                            transport-independent

  `@socket.io/redis-adapter` +   Cross-instance Socket.IO   Only when
  Redis client                   fan-out                    multi-instance scaling
                                                            requires it; Redis adds
                                                            operational cost

  `redis`                        Shared cache, rate-limit   Don't add Redis merely
                                 store, realtime adapter    as a default database
                                 support                    replacement

  `pino-http`                    HTTP request logging       Redact
                                                            authorization/cookie
                                                            headers

  `@opentelemetry/api` and       Traces/metrics when        Choose exporters based
  SDK/exporter                   observability is needed    on actual
                                                            hosting/monitoring

  `prom-client`                  Prometheus metrics         Avoid high-cardinality
                                                            labels such as user IDs
                                                            or conversation IDs

  `swagger-jsdoc` +              OpenAPI docs for Express   Use only if API docs
  `swagger-ui-express`                                      are needed and not
                                                            already generated

  `file-type`                    Detect file types from     Do not trust filename
                                 bytes                      or MIME header alone

  `sharp`                        Image resizing/thumbnails  Add only if image
                                                            processing is required

  `@aws-sdk/client-s3` or        File/object storage        Use private buckets,
  compatible object-storage SDK                             signed URLs, and
                                                            authorization checks

  `DOMPurify` (browser) or a     Sanitize allowed rich      Prefer plain
  maintained server-side HTML    text/HTML if HTML is       text/structured rich
  sanitizer                      supported                  text over arbitrary
                                                            HTML

  `@tanstack/react-query`        Client-side server-state   Do not duplicate
                                 cache and mutation         Next.js server caching
                                 management                 without a clear plan

  `react-hook-form`              Efficient form state       Use when forms justify
                                                            it

  `@hookform/resolvers`          Bridge form libraries and  Confirm the chosen
                                 schema validators          Zod/Joi integration and
                                                            avoid duplicate
                                                            validation

  `lucide-react`                 Consistent icon system     Use a consistent subset
                                                            and accessible labels

  `date-fns`                     Date                       Use consistently; avoid
                                 formatting/manipulation    multiple date libraries

  `cmdk`                         Command/search palette UI  Optional; don't make
                                                            core search dependent
                                                            on a decorative command
                                                            palette

  `@tanstack/react-virtual`      Virtualized long lists     Use when
                                                            message/channel list
                                                            size justifies it

  `@playwright/test`             Browser-level end-to-end   Strongly recommended
                                 tests                      for critical user
                                                            journeys

  `axe-core` /                   Automated accessibility    Supplement manual
  `@axe-core/playwright`         checks                     checks

  `dependency-cruiser`           Detect forbidden           Configure to enforce
                                 dependency directions      real module boundaries

  `lint-staged` + `husky`        Optional pre-commit checks Keep hooks fast; CI
                                                            remains authoritative
  ---------------------------------------------------------------------------------

## 9.3 Frontend styling options

Choose one styling system that fits the current Squid project: -
**Tailwind CSS** if the repository already uses it or wants
utility-first styling. - **CSS Modules** if the existing app favors
locally scoped styles. - **shadcn/ui** as a source-owned component
foundation if its Radix/Tailwind assumptions fit the repo. - **Radix
UI** primitives when accessible behavior is needed and the project wants
to own the styling.

Do not add Tailwind, CSS Modules conventions, a component library, and a
second CSS-in-JS framework all at once. Reuse Squid's current design
system where possible.

## 9.4 Important dependency decisions

-   Do not add a large state-management library until a concrete shared
    client-state problem exists.
-   Do not add a message broker until reliability/scale needs justify
    it.
-   Do not add Elasticsearch/OpenSearch until MongoDB search
    capabilities and real product needs have been evaluated. If advanced
    search is needed, design authorization-aware indexing and deletion
    propagation first.
-   Do not add a separate cache before profiling.
-   Do not use an unmaintained or experimental package for
    authentication, crypto, file scanning, or authorization.
-   Review package license, maintenance activity, known vulnerabilities,
    bundle impact, and transitive dependency count before adoption.
-   Keep lockfiles committed and use reproducible CI installs.
-   Run dependency and security audits as part of CI on a schedule
    appropriate to the project.

------------------------------------------------------------------------

# 10. Testing Strategy

Use Jest for unit/integration tests if it matches the current
repository. Use Playwright for browser E2E tests if available and
appropriate.

## 10.1 Test layers

1.  **Domain/unit tests:** business rules without Express or MongoDB
    where possible.
2.  **Service/use-case tests:** orchestration, authorization decisions,
    errors, idempotency, and transaction behavior.
3.  **Repository integration tests:** actual query scoping,
    indexes/query behavior where feasible, persistence and deletion
    rules.
4.  **HTTP integration tests:** route registration, middleware,
    validation, authentication, status codes, and response contracts.
5.  **Realtime integration tests:** socket authentication, room
    authorization, reconnect behavior, duplicate/missed events.
6.  **Frontend component tests:** meaningful interactions, form
    validation, accessibility states, loading/error/empty states.
7.  **End-to-end tests:** sign-in/session, create/join channel, send
    message, open DM, search, paginate history, and denied access.
8.  **Performance/load tests:** realistic message send, history, search,
    and connection patterns before release.

## 10.2 Required negative tests

For every protected resource, test at least: - Unauthenticated
request. - Authenticated but not a workspace member. - Member of a
different workspace. - Non-member attempting private-channel access. -
Non-participant attempting DM/group-DM access. - Invalid IDs and
malformed inputs. - Extra/unexpected fields. - Deleted/archived/disabled
resource behavior. - Duplicate retry/idempotency behavior where
applicable. - Rate limit behavior. - Database or event-delivery
failure. - Search result/snippet leakage. - Attachment URL/access
leakage.

## 10.3 Testing rules

-   Tests must assert outcomes, not only that a function was called.
-   Do not mock away the behavior the test claims to verify.
-   Use isolated fixtures and deterministic clocks/IDs where practical.
-   Do not depend on test execution order.
-   Clean up created data, connections, sockets, and temporary files.
-   Do not silently skip failing tests.
-   Avoid arbitrary coverage targets as a substitute for testing
    important behavior; prioritize critical business rules and
    boundaries.
-   Keep fast unit tests separate from slower integration/E2E suites.
-   Add regression tests for bugs before or alongside the fix.

------------------------------------------------------------------------

# 11. Security, Privacy, and Abuse Prevention

A collaboration platform stores private conversations. Security is a
core feature, not a later enhancement.

-   Apply least privilege and default-deny authorization.
-   Enforce workspace, channel, conversation, and file scope on every
    request and subscription.
-   Prevent IDOR/BOLA and mass assignment.
-   Validate all untrusted input; encode/render user content safely.
-   Prefer plain text or a well-defined structured rich-text format.
    Never render arbitrary HTML without a deliberate sanitizer and
    policy.
-   Use secure headers, TLS in deployment, strict CORS, and appropriate
    CSRF protection.
-   Apply login, invitation, message, search, and upload rate limits.
-   Limit request sizes, file sizes, attachment counts, pagination, and
    query complexity.
-   Protect against MongoDB operator injection: never accept raw client
    query objects or update operators.
-   Keep secrets out of git, client bundles, error responses, and logs.
-   Use least-privilege database credentials and separate environments.
-   Plan backups, restore tests, retention, deletion, and incident
    response.
-   Consider malware scanning and content-type verification for uploaded
    files; files should not be public by default.
-   Use private object storage and short-lived signed URLs after
    authorization.
-   Do not expose message content in analytics, metrics labels, or
    general application logs.
-   Define how account deletion, workspace removal, retention, exports,
    and legal holds interact before launch.
-   Add dependency scanning and security review to release readiness.

------------------------------------------------------------------------

# 12. Observability and Operations

Production readiness includes knowing whether the system is healthy and
why it failed.

-   Use structured logs with timestamp, severity, service/module,
    request/correlation ID, and safe outcome fields.
-   Redact credentials, cookies, authorization headers, secrets, and
    message/file content.
-   Add request latency, error rate, database latency, queue/outbox
    backlog, realtime connection counts, and relevant failure counters.
-   Use bounded metric labels such as module, route template, and
    outcome. Never use user IDs, workspace IDs, channel IDs, message
    IDs, or raw query strings as metric labels.
-   Track sign-in success/failure safely without recording credentials
    or sensitive provider payloads.
-   Add health and readiness checks that distinguish process health from
    dependency readiness.
-   Handle graceful shutdown: stop accepting work, close sockets, drain
    in-flight requests, and close database connections.
-   Configure production logging, error reporting, backups, restore
    procedures, and alert thresholds before launch.
-   Document environment variables and provide `.env.example` with
    placeholders only.
-   Never commit real `.env` files or production credentials.
-   Add a deployment/runbook document for migrations, rollback, failed
    jobs/outbox recovery, and incident diagnosis.

------------------------------------------------------------------------

# 13. Performance and Lightweight Design

"Lightweight" means small dependency surface, efficient queries, bounded
work, and responsive UI---not skipping reliability or security.

-   Measure baseline API latency, frontend bundle size, and important
    database query latency.
-   Load only data needed for the current view.
-   Use cursor pagination for message history and bounded search
    results.
-   Index real access patterns; inspect explain plans for slow queries.
-   Avoid N+1 database calls and per-message queries for entire history
    pages.
-   Use projections and small realtime payloads.
-   Virtualize long histories when necessary.
-   Lazy-load infrequently used UI and heavy features.
-   Keep client components and browser bundles small.
-   Avoid global state and repeated data-fetching layers without a
    demonstrated need.
-   Use caching only where correctness, privacy, invalidation, and
    authorization are clear.
-   Do not cache private data across users or workspaces accidentally.
-   Add performance budgets and representative load checks before
    release.
-   Do not optimize by removing authorization checks, data validation,
    or error handling.

------------------------------------------------------------------------

# 14. Search and Message History Requirements

Search must obey exactly the same privacy rules as direct
message/channel reads.

-   Search only messages the principal is currently authorized to
    access.
-   Apply workspace, channel, conversation, membership, deletion, and
    retention constraints consistently.
-   Do not reveal private-channel names, DM existence, snippets,
    attachments, or result counts to unauthorized users.
-   Define supported search syntax and filters before implementation.
-   Bound query length, result count, and time range; protect against
    expensive queries.
-   Use stable cursor pagination and deterministic ordering.
-   Ensure deleted/edited messages and revoked memberships propagate
    correctly to any search index/cache.
-   If an external search index is introduced, define eventual
    consistency, reindexing, deletion propagation, access-control
    filtering, and recovery.
-   Do not claim real-time search indexing unless measured and
    implemented.
-   Test search privacy across workspaces, private channels, DMs,
    deleted messages, and permission changes.

------------------------------------------------------------------------

# 15. File and Attachment Requirements

If attachments are part of the release:

-   Store file bytes in object storage or a suitable file service, not
    as large MongoDB document fields by default.
-   Store metadata and authorization relationships in the application
    database.
-   Validate size, extension, detected content type, and allowed file
    categories.
-   Use private storage by default; issue short-lived signed URLs only
    after checking permission.
-   Do not trust a file name or browser-supplied MIME type.
-   Use safe download headers and avoid serving executable content
    inline.
-   Define upload cancellation, failed upload cleanup, deletion,
    retention, and orphan cleanup.
-   Consider malware scanning and image processing according to the
    threat model.
-   Test cross-workspace access, expired URLs, deleted attachments, and
    permission changes.

------------------------------------------------------------------------

# 16. CI, Architecture Enforcement, and Release Workflow

Every pull request should run the checks applicable to the repository:

1.  Reproducible dependency install using the repository's package
    manager.
2.  Formatting check.
3.  ESLint.
4.  TypeScript typecheck.
5.  Unit tests.
6.  Integration tests for affected boundaries.
7.  Architecture/dependency-boundary checks.
8.  Build.
9.  Dependency/security audit appropriate to the project.
10. E2E tests for critical flows at the appropriate stage.

Additional rules: - CI is the source of truth; local success alone is
not sufficient. - Protect the main branch and require review for risky
architecture/security changes. - Keep secrets in CI secret storage. -
Separate fast PR checks from scheduled heavy load/security tests if
needed. - Use backward-compatible migrations when possible and document
rollback constraints. - Never deploy a migration that can destroy
production data without a backup and recovery plan. - Use feature flags
only where rollout/rollback needs justify the added complexity. -
Maintain a staging environment representative enough to test
authentication, MongoDB topology, object storage, realtime, and
deployment configuration.

------------------------------------------------------------------------

# 17. Suggested Implementation Order

Use the actual backlog dependency graph and Squid architecture as the
final authority. A sensible default order is:

1.  **Repository/architecture audit:** confirm module boundaries,
    current auth/session principal, data gateway, package manager,
    tests, and deployment.
2.  **Foundation:** typed configuration, error handling, logging,
    request IDs, API validation conventions, and architecture
    enforcement---only where missing.
3.  **Identity/workspace prerequisites:** authenticated principal,
    workspace membership, and authorization contracts required by all
    private data.
4.  **Channels and membership:** creation, listing, joining/leaving,
    privacy, and permission enforcement.
5.  **Conversations and DMs:** stable conversation identity and
    participant access rules.
6.  **Message persistence:** send, history pagination, edit/delete
    rules, idempotency, and authorization.
7.  **Realtime delivery:** authenticated subscriptions,
    persistence-first events, reconnect recovery, and deduplication.
8.  **Messaging tools:** reactions, threads, mentions, pins, unread
    state, and attachments according to dependency order.
9.  **Search:** authorized search, filters, indexing strategy if needed,
    and deletion/permission propagation.
10. **Polish and production readiness:** accessibility, responsive
    behavior, observability, load testing, backup/restore, deployment
    runbooks, and release checks.

Do not blindly follow this order if an existing ADR or story dependency
requires another sequence. Explain deviations.

------------------------------------------------------------------------

# 18. Agent Work Protocol for Every Story

For each story, report and follow this sequence:

## Step 1 --- Understand

-   Read the story and acceptance criteria completely.
-   Identify its dependencies and module owner.
-   Inspect relevant existing code and tests.
-   Identify any conflict with Squid's architecture or security
    boundaries.

## Step 2 --- Plan

-   List the intended changes by module.
-   Identify API contracts, data changes, indexes, events, and UI
    states.
-   Identify positive, negative, integration, and regression tests.
-   State any assumptions that materially affect behavior.

## Step 3 --- Implement

-   Make the smallest complete vertical slice.
-   Keep each responsibility in its boundary.
-   Reuse established project patterns and packages.
-   Avoid unrelated refactors and premature abstractions.

## Step 4 --- Verify

-   Run targeted tests first, then relevant full checks.
-   Test denied-access and cross-workspace cases.
-   Verify typecheck, lint, architecture checks, and build as
    applicable.
-   Inspect the final diff for secrets, accidental files, unsafe
    queries, and unrelated edits.

## Step 5 --- Report honestly

Include: - Story and acceptance criteria addressed. - Files/modules
changed and why. - Tests/checks run with actual results. - Any criteria
not yet satisfied. - Migration/deployment notes. - Known risks and
remaining blockers. - Whether the story is Done or still in progress.

Never invent a passing test, claim a deployment succeeded without
evidence, or mark an incomplete story Done.

------------------------------------------------------------------------

# 19. Questions the Agent Must Resolve Before Production

Do not block all development on every question, but record decisions and
resolve them before the relevant feature ships.

-   What is the authoritative Squid identity/session/principal model?
-   Which module owns workspace membership and role/permission policy?
-   What is the existing persistence approach: MongoDB native driver or
    Mongoose?
-   What is the supported MongoDB deployment topology, and are
    transactions available?
-   Will web and API share an origin in production? What are the cookie,
    CORS, and CSRF rules?
-   What is the realtime transport and how will it scale across
    instances if required?
-   Where will files be stored, how will they be scanned, and how will
    private access be enforced?
-   What is the message edit/delete and retention policy?
-   What is the expected workspace size, message volume, concurrent
    connection count, and latency target?
-   Is search initially MongoDB-based, or is an external index
    justified?
-   What are the backup, restore, recovery-time, and recovery-point
    expectations?
-   Which logs, metrics, alerts, and dashboards are available in the
    hosting environment?
-   How will user/workspace deletion, exports, and data retention work?
-   Which deployment target, environment strategy, and rollback process
    will be used?
-   Which existing Squid architecture rules and ADRs are mandatory for
    this work?

Document decisions in concise ADRs when they affect boundaries,
persistence, security, or operations. Avoid recording trivial
implementation details as ADRs.

------------------------------------------------------------------------

# 20. Final Principle

**Build the simplest system that safely satisfies the real
requirement.**

A professional platform is not one with the most folders or packages. It
is one where: - each module owns a clear capability; - every API
boundary validates and authorizes requests; - private data cannot cross
workspace or conversation boundaries; - dependencies point in the
intended direction; - persistence and events are reliable; - the UI is
fast, accessible, consistent, and responsive; - tests verify behavior
and failure modes; - production operation, recovery, and observability
are planned; - new complexity is introduced only when a measurable
requirement justifies it.

The platform must remain a single deployable monolith unless a
deliberate, evidence-backed architecture decision changes that. Keep its
modules independently understandable, testable, and replaceable behind
stable public contracts so integration with Squid does not become a
rewrite.
