# Agent Operating Guide

Agents working in this repository must treat the repository itself as the workspace and
the monorepo foundation as the product being implemented. There is no mandatory
`<project>` path segment: workspace units live under physical roots such as `apps/web`
and `servers/api`. These are defaults, not directories to create without a real need.

Before changing code:

1. Read this file and `architecture.yaml`.
2. Inspect the relevant workspace unit through the repository control plane.
3. Keep dependencies explicit and boundaries clear.
4. Prefer functional modules, pure functions, immutable data, and explicit dependency passing.
5. Run the smallest useful validation command after changes.

Read the narrowest authoritative guide for the work:

- `.agent/instructions/architecture.md` for planes, feature ownership, and dependency direction.
- `.agent/instructions/ui-composition.md` for shadcn, Tailwind, component hierarchy, and page composition.
- `.agent/instructions/integrations.md` for external systems and reusable infrastructure.
- `.agent/standards/types-validation.md` for local versus shared contracts and runtime schemas.
- `.agent/standards/testing.md` for unit, component, integration, and end-to-end test intent.
- `.agent/standards/development.md` for functional implementation and progressive growth.

Classify the scope before editing: application, reusable package, infrastructure/enabler,
project knowledge, foundation, or control plane. Application work does not authorize
foundation or control-plane changes.

Implementation follows `UNDERSTAND -> PLAN -> IMPLEMENT -> VALIDATE -> REVIEW -> RECORD -> COMPLETE`.
Create feature-owned code first, add layers only when a concrete boundary requires them,
and extract packages only after ownership and genuine cross-boundary reuse are established.
The governing principle is: everything available, nothing unnecessarily imposed.
Prefer keeping source files at or below 200 lines when a clear semantic split exists. Treat
this as a maintainability target, not a hard limit: extract cohesive responsibilities without
creating artificial fragments, and preserve the repository's ownership and dependency rules.

Architecture is feature-first. Server features are flat by default, using optional files
such as `<feature>.route.ts`, `<feature>.controller.ts`, `<feature>.service.ts`,
`<feature>.repository.ts`, `<feature>.validation.ts`, `<feature>.model.ts`, and
`<feature>.integration.ts`. Introduce `domain/` only for meaningful domain complexity.
Do not create role folders or any other architectural directory merely to represent a pattern.

The control plane lives in `codebase/`. It owns repository discovery, dependency graphing,
execution planning, task ordering, caching, repository policy, result normalization, and
the CLI. It must not use Turborepo, Nx, Lerna, or another third-party monorepo orchestrator
as its foundation.

The control plane orchestrates established technical tools instead of reimplementing them.
pnpm owns package resolution and dependency auditing; `tsc` owns TypeScript analysis;
ESLint owns lint analysis; project-declared runners own tests; and TruffleHog owns secret
detection. Custom checks are reserved for repository-specific architecture and governance.
Missing required tools and tool execution failures must fail clearly rather than becoming
successful scans. `pnpm run scan` bootstraps the architecture-pinned TruffleHog release into
the ignored repository cache after verifying its official SHA-256 checksum and version; it
also contacts the configured package registry through `pnpm audit`.
The dependency audit explicitly excludes `GHSA-vfj7-8cjw-p6xm` from actionable findings for
transitive `braces` used by development tooling, while all other configured-severity
findings continue to fail. The advisory remains visible in pnpm's audit report; the
repository scan filters only this configured ID after receiving the report.
TruffleHog excludes local files named `.env` and `.env.local`; `.env.example` remains scanned.

`architecture.yaml` uses the JSON-compatible subset of YAML so Node.js can load the
authoritative policy without adding a parser dependency to the control plane.

pnpm is the repository package manager. Internal package dependencies use `workspace:*`,
and `pnpm-workspace.yaml` is the authoritative package-workspace definition.

Workspace-unit code under `apps/`, `servers/`, `packages/`, and `prebuilt/` may use appropriate external libraries. The control plane should stay dependency-light and prefer Node.js built-ins plus repository-owned code. `packages/` owns reusable pieces; `prebuilt/` owns assembled reusable solutions; `enablers/` owns operational support.

Useful commands:

```text
pnpm run projects
pnpm run graph
pnpm run tasks
pnpm run dev
pnpm run build
pnpm run lint
pnpm run typecheck
pnpm run check
pnpm run scan
pnpm test
```

Workspace-unit tasks run through `node codebase/cli/repo.mjs run <task>`. Use `--dry-run` to
inspect ordering and `--json` when another tool needs stable output.

## Cross-agent collaboration and handoff

- Codex owns frontend visual design, layout, styling, and UI interactions. The backend
  agent owns API behavior, authorization, persistence, and backend tests. Coordinate
  shared API contracts before changing them, and avoid editing the other agent's files.
- When a task crosses the boundary, the backend agent should provide Codex the relevant
  request/response shapes and errors. Codex should request specific backend changes
  instead of modifying backend files.
- At the end of each implementation task, update the `Current handoff` below. Keep it
  concise and replace stale status rather than appending a chronological log. State what
  changed, validation performed and any failures, the current save/branch state when it
  matters, and concrete next actions with an owner. Never include credentials or secrets.
- Read the handoff before starting work. If it conflicts with source code or Git state,
  verify the live state and correct the handoff as part of the task.

## Current handoff

Updated: 2026-10-26.

- **Ownership:** Codex handles frontend design and interactions; the backend agent handles
  APIs, contracts, persistence, authorization, and backend validation. Coordinate changes
  to shared contracts explicitly.
- **Saved work:** Local branch `slacker` remains at `32fb907`; frontend workspace-shell
  and chat styling changes are currently unstaged in the shared checkout. The project
  snapshot is also pushed to `samiaptech/Slacker:feature/nutshyll-sync` at `50d0386`.
  These refs have different parent histories; do not assume the local branch tracks the
  Slacker branch.
- **Security status:** The last secret scan was clean after removing the local MongoDB URI.
  The high `braces` advisory `GHSA-vfj7-8cjw-p6xm` is explicitly excluded from dependency
  audit policy because it is transitive through development tooling. Keep auditing all
  other dependencies and do not claim a full scan passes when secret findings or tool errors
  remain.
- **Latest backend work:** Added private Cloudinary attachments to channel and one-to-one
  messages. Existing JSON text requests remain supported; multipart requests accept
  optional `text` and repeated `files` fields. Limits are five files per message and
  10 MiB per file. Accepted formats are JPEG, PNG, GIF, WebP, PDF, TXT, CSV, and Markdown.
  Upload authorization is checked before parsing; every download rechecks channel
  membership or DM participation. Cloudinary assets use authenticated delivery, and
  clients receive authorized API download paths rather than provider URLs. Attachment
  response metadata is `id`, `name`, `mimeType`, `size`, and `downloadUrl`.
- **Configuration and persistence:** Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
  and `CLOUDINARY_API_SECRET` locally; all three are required to enable uploads but are
  not required for API startup. `pnpm run initialize` completed successfully against the
  configured MongoDB on 2026-10-20, applying workspace, channel, and DM schemas/indexes.
  A subsequent upload failed because Cloudinary returned no string `format` for the raw
  document, causing MongoDB validator error `attachments.format:bsonType`. The integration
  now falls back to the validated filename extension when the provider omits format, and
  retains provider formats when present. Retry an upload after API reload to verify the
  fix in the live database/provider path.
- **Frontend status:** Codex updated the workspace shell and channel conversation to
  follow the supplied Figma frame, then aligned direct-message date dividers, message rows,
  and the composer with the channel conversation styling. Channel and DM messages now parse
  optional attachment metadata; their composers accept up to five supported files at 10 MiB
  each, show selected-file details above the message input, send multipart `text`/`files`
  when files are selected, and retain JSON text-only
  requests. Message attachment cards download through the API-provided `downloadUrl` using
  workspace credentials and same-origin checks. The live channel and DM attachment controls
  were visually checked; no file was uploaded and no backend files were changed.
  Profile now has a workspace-themed identity header, clearer profile editing, and separated
  privacy and invite settings. During workspace access loading, skeleton shapes are confined
  to the main content pane; the rail/sidebar area stays a steady branded surface. Earlier
  the workspace access provider and channel shell remounted per route. They now live in the
  `(app)` shared layout, and channel, DM, profile, and member pages share that mounted shell;
  route-transition skeletons render in the main pane. Sidebar search now opens a fixed
  workspace search dialog for channels, direct messages, people, and messages; it no longer
  filters the three sidebar lists while typing, so their layout stays stable. Search input
  state is isolated in the dialog to avoid rerendering the workspace on each keystroke. The
  local preview remained at initial
  workspace-access loading, so populated-sidebar retention was not visually verified against
  a live workspace. Earlier
  Figma comparison found the
  live `#general` feed has two real messages while the prototype shows three samples with
  reactions and an attachment. No sample content was fabricated. Channel and DM message rows
  are now extracted into memoized feature components, and date grouping is memoized; composer
  keystrokes no longer rebuild the full message list. This is production code and will apply
  after deployment. No deployment was requested or performed.
  Other members’ profile pages now use the same forest-green identity treatment as the
  account profile, with role, member-since, optional email, and title information in clear
  cards. The loading skeleton stays within the content area, retry refetches without a full
  page reload, and the admin role/removal controls remain available in a separated access
  panel. Presentation and management UI are split into small feature components.
  Direct-message pages now render a conversation-shaped skeleton during their internal data
  fetch, rather than a lone “Opening direct message…” line. It stays inside the DM content
  pane, leaving the shared workspace navigation and sidebar mounted.
  Channel pages show a Figma-inspired “About this channel” sidebar with the matching warm,
  flush panel surface, compact description/visibility block, and lighter linked member rows.
  Public members come from the existing workspace-member contract; private members come from
  channel memberships, and private membership management stays collapsed. General uses the
  Figma copy when no description is set; its displayed member count remains the live API count.
  The existing workspace header’s channel name toggles the About sidebar through shared
  channel UI state, with an accessible expanded state and rotating chevron; no duplicate
  channel-name header was added. The sidebar can also be toggled on mobile.
  User returned the app to localhost development after Google rejected the LAN IP as an
  OAuth redirect host. Use `http://localhost:3000` for web and `http://localhost:4000` for
  API, and register `http://localhost:4000/api/auth/callback/google` with the Google web
  OAuth client. Local `.env` files were not inspected or modified during this work.
  Workspace options include a confirmed “Leave workspace” action. Self-leave cleanup now
  deletes the member's `channel_memberships` rows only for channels in the departed
  workspace, increments each affected channel's `membershipRevision`, retains the workspace
  revision update, and preserves channels, messages, and attachment metadata. Cleanup uses
  the same Mongo transaction as workspace membership removal; admin-only removal and the
  last-admin guard remain intact. Focused adapter/service tests cover public/private channel
  cleanup, foreign-workspace isolation, cleanup failure, and realtime access revocation.
  The replica-set integration test also covers rollback after channel cleanup, workspace and
  channel revisions, and retained messages/files; it is skipped unless
  `MONGODB_TEST_URI` targets an isolated `nutshyll_test_<name>` replica-set database.
  **Message search (Epic D2, in progress):** Added authenticated `POST /messages/search`
  scoped to the selected workspace, the requester's channel memberships, and their DM
  conversations. Queries are validated and sent in the request body; responses are
  `no-store`, bounded, rate-limited per API process (30 requests/minute), and contain safe
  snippets rather than complete message bodies. Search uses MongoDB text indexes and the
  existing root initializer migration; a missing index or query timeout fails explicitly.
  The workspace search dialog has debounced message search, context snippets,
  loading/error/timeout/retry and pagination states. Each message match is a separate
  selectable result with its channel, sender, date, and snippet; the dialog displays the
  loaded result count and “Show more matching messages” action. It requests 20 results per
  page and follows the API's 400-result bound only when the user asks for more. Selecting a
  result closes the dialog, stores a validated one-time target, routes to the matching
  channel or DM, loads older history page by page when needed, then focuses, scrolls to, and
  briefly highlights the matching message. Timeline pagination callbacks are stable across
  renders, avoiding unnecessary search-jump effect churn; the DM timeline also uses one
  bottom scroll target. In a populated browser, `hello` showed five separate results across
  two channels; both a recent result and an older cross-channel result navigated to and
  highlighted the exact message. Web tests (20), typecheck, focused ESLint, and
  `git diff --check` pass. MongoDB query-plan and search-performance checks remain pending;
  search limits now share the MongoDB-backed rolling-window limiter across API instances.
  Frontend follow-up: the leave confirmation dialog was mounted inside the dropdown and
  disappeared when the dropdown closed; it now stays mounted in the workspace shell.
  After a successful leave, the frontend selects another known workspace before reloading;
  when none remain it clears the selection and returns to the root create-workspace flow.
  Frontend TypeScript check passes. Focused ESLint passes with one existing navigation
  warning for the full reload after leaving; no lint errors.
  Fixed dropdown/popover contrast at the shared theme layer: `bg-popover` and
  `text-popover-foreground` now resolve to explicit opaque colors, with Nutshyll palette
  overrides. This covers channel action menus, the workspace switcher, and shared select,
  popover, context-menu, and menubar surfaces. App scrollbars now use a thin, transparent-
  track style with muted forest-green thumbs on light surfaces and soft white thumbs in the
  dark workspace sidebar; scrolling behavior is unchanged. CSS diff check passed; visual
  browser review remains to be done.
  The design reference was compared directly;
  the local browser preview had no active workspace session, so the updated page could not be
  visually rechecked with populated data.
- **Performance/history:** Channel and direct-message navigation request conversation
  metadata and the first 50-message history page concurrently. Returning workspace
  sessions load saved access alongside the workspace list. Older-history pagination in
  both timelines now preserves the first visible message's viewport position when older
  messages are prepended. Equal-timestamp cursor regression tests cover channel and DM
  boundaries. Existing Mongo queries have bounded page sizes, member/participant checks,
  timestamp-plus-ID sorting, and matching compound indexes. No live query plan, large-data
  timing profile, or browser scroll test was captured. Message-send API latency has not
  been benchmarked against the live database. The API now validates workspace, channel
  message, and DM schemas/indexes once per storage instance, shares concurrent checks,
  retries failed checks, and validates workspace collections in parallel. Text sends use
  the authenticated sender profile and avoid a post-save profile query; channel sends
  avoid a redundant channel read while retaining the membership check and channel revision
  write in the transaction. API fake-storage tests assert readiness checks are not repeated.
  Local development uses localhost;
  Google OAuth accepts localhost callbacks, not raw private LAN IP redirect hosts. Do not
  inspect `.env`.
- **Validation:** `pnpm --dir apps/web test` passed (16 tests); `pnpm --dir apps/web
  typecheck`, `pnpm --dir apps/web lint`, and `pnpm --dir apps/web build` passed. The build
  used a non-secret `NEXT_PUBLIC_API_BASE_URL` override for the command. Fixed the nested
  channel-message test and aligned its assertion with the schema's `attachments: []`
  normalization; updated the home-page test to assert the current accessible loading shell.
  Earlier scoped channel-profile lint and web typecheck passed after adding the panel.
  Latest scoped ESLint passed with zero findings, the web TypeScript check passed, and
  `git diff --check` passed. Channel page and profile panel remain under 200 lines; the
  profile content file is 98 lines and the shared toggle context is 22 lines. Workspace menu
  lint passed. The UI package build could not run because pnpm failed to resolve its pinned
  version from the npm registry due to unavailable DNS/network access. The temporary LAN
  hostname and dev-origin settings were reverted; Next config typecheck and `git diff --check`
  passed. For workspace leave, focused tests passed (25 passed, 1 optional Mongo replica-set
  test skipped); the full API suite passed (135 passed, 1 skipped, 0 failed), and API
  typecheck, API lint, and build passed. `git diff --check` passed. The control-plane suite
  passed (81 tests), and repository architecture validation now passes. `pnpm run scan`
  filters only the configured `braces` advisory. The TruffleHog exclusion policy skips
  `.env` and `.env.local`, while `.env.example` and other files remain scanned. A synthetic
  integration test verifies dotenv exclusion and confirms that a test private key outside
  those files is still detected. Local `.env` contents were not displayed or modified. No
  MongoDB replica-set cleanup/rollback integration or production-browser test ran because
  no safe target was configured.
  For D2, the API suite passed (127 passed, 1 skipped, 0 failed), and API lint, typecheck,
  and build passed. Web message-search tests passed (20); web typecheck and focused ESLint
  passed. Full web lint had zero errors and one existing warning in
  `apps/web/features/identity/components/workspace-access.tsx`. Shared types lint and
  typecheck passed, and `git diff --check` passed. Search and result-jump behavior were
  verified against a populated browser session; MongoDB query-plan/performance checks remain
  unverified.
  No live navigation timing, LAN Socket.IO connection, Cloudinary live test, or public
  deployment was run. The worktree is shared and
  contains other unstaged user/agent changes; no commit or push was made.
- **History validation:** `pnpm --dir apps/web test` passed (18 tests); web typecheck,
  focused history lint, and production build passed. API typecheck and focused channel/DM
  history tests passed (8 tests); focused API test lint passed. An earlier full API run
  exposed a stale workspace invitation-expiry assertion, now corrected; the full suite
  passes with 116 passed and 1 skipped. Full web lint completed with one warning in the
  existing workspace-access component. `git diff --check` passed.
- **Next actions:** User/operator: rotate the local MongoDB and Cloudinary credentials
  reported by TruffleHog, keep `.env` ignored, and provide an isolated MongoDB replica-set
  test database to run workspace-leave rollback coverage. Codex: verify the leave
  confirmation and next-workspace/create-workspace redirect in a populated browser; also
  verify older-page scroll anchoring and run MongoDB search query-plan/performance checks
  when an authorized database is available. Codex added optimistic pending-message rows
  for channel and DM sends, reconciled them with API/Socket.IO messages, and preserved
  retry/error behavior. Web typecheck passed; focused ESLint and diff checks passed. A
  populated-browser timing check remains pending, and the change is local and uncommitted.
  Browse Channels join actions use a forest-green filled button with readable white text,
  a lighter green hover state, and a darker active state to fit the dark sidebar. Focused
  ESLint and `git diff --check` pass. Channel and DM image attachments now load previews
  through authorized API requests when near the viewport and open in a full-screen dialog;
  document attachments retain their download action. Web typecheck and focused ESLint pass.
  Browser image rendering was not visually verified; the frontend changes remain local.
  On narrow screens, channel-name clicks now open a dedicated `/channels/:id/about` view
  with a back-to-conversation link, removing the expanding mobile About accordion from the
  conversation. Wider screens retain the About side panel. Web typecheck, focused ESLint,
  and `git diff --check` pass; browser responsive verification remains pending.
  Continue production UI decomposition where cohesive
  boundaries improve readability. User: confirm local web/API configuration uses localhost
  and restart both apps if it is stale. The user is preparing a Vercel production
  deployment. Root `vercel.json` routes `web` and `api` on one domain, using
  `X-Workspace-Id` to distinguish channel API requests from Next.js channel pages. It was
  pushed to `samiaptech/Slacker:main` as `05ebe11`. Repeated Vercel runtime logs showed
  `ERR_MODULE_NOT_FOUND` for `express` from `/var/task/server.mjs`, even after ESM entrypoint
  and filtered/hoisted pnpm install changes. A self-contained esbuild bundle was configured
  at `dist/vercel/server.mjs`, but Vercel validates the service entrypoint before running
  the build command and rejected the missing file (`dist/` is ignored). The bundle now lives
  at committed path `servers/api/vercel/server.mjs` (~4 MB minified); `build:vercel`
  regenerates it from `server.mts`, and Vercel points to this existing entrypoint. Bundle
  contains only Node built-in imports; `dotenv/config` loads only outside Vercel. The
  committed-entrypoint fix was pushed to `samiaptech/Slacker:main` as `77743bb`. API
  typecheck/lint, 19 focused tests, bundle syntax/import inspection, dependency audit,
  secret scan, and repository check pass. Active web origin: `https://slacker-tifi.vercel.app`.
  Socket.IO now exports the HTTP server with its upgrade handler attached, and the browser
  client uses WebSocket-only transport as required by Vercel Functions. The focused
  Socket.IO integration tests pass with WebSocket transport; API/web typechecks and bundle
  generation pass. Redeploy and verify that `/socket.io/?EIO=4&transport=websocket` upgrades
  successfully and that two clients receive live updates. Cross-instance Socket.IO pub/sub
  now uses a MongoDB change-stream adapter; validate multi-instance behavior after deployment.
  The search limiter remains process-local. Do not use `pnpm run initialize` as a build/start
  command. Next.js is patched at 16.4.1 (`7214f5d`); revisit the `braces` advisory when
  patched.

- **Channel storage readiness fix:** The runtime readiness check compared MongoDB's
  normalized text-index key (`_fts`/`_ftsx`) against the original `{ text: "text" }`
  declaration, incorrectly returning `channel_storage_unavailable` after a successful
  initializer. The check now validates MongoDB's text-index representation and its field
  weights; a regression test covers the live index shape. API typecheck and focused ESLint
  passed; API test suite passed (128 passed, 1 skipped, 0 failed); `git diff --check`
  passed. Restart/redeploy the API process to load this fix, then reload the channel page.

- **Direct-message storage readiness fix:** Its readiness check had the same MongoDB text
  index metadata mismatch (`_fts`/`_ftsx` versus the declared `{ text: "text" }` key),
  causing initialized DM storage to be reported unavailable. The check now recognizes the
  normalized index and verifies its field weights; a regression test covers DM readiness.
  API typecheck, focused ESLint, and `git diff --check` passed; the full API suite passed
  (129 passed, 1 skipped, 0 failed). Restart/redeploy the API process before retrying.

- **Message-send latency improvement:** Successful workspace, channel-message, and DM
  storage readiness checks are cached per storage instance, concurrent first checks share
  work, and failed checks are retried. Workspace readiness checks for its three collections
  now run in parallel. Channel message persistence avoids a redundant channel lookup while
  preserving transactional member authorization and the channel revision lock. API send
  responses reuse the authenticated sender name/image instead of querying the user again
  after persistence. Regression tests verify readiness checks run once, failed workspace
  readiness can recover, and sends do not perform the extra profile lookup. API typecheck,
  full lint, build, and tests passed (133 passed, 1 skipped, 0 failed); `git diff --check`
  passed. No live MongoDB latency benchmark or populated-browser perceived-send measurement
  was run. Restart/redeploy the API to use these changes; Codex owns the pending frontend
  optimistic-send behavior listed above.

- **Cross-instance chat delivery fix (in progress):** The deployed Socket.IO connection
  showed connected, but new chat messages appeared only after refresh because Vercel can
  process the WebSocket and HTTP send request on different function instances. Socket.IO now
  uses the Atlas MongoDB change-stream adapter for cross-instance room broadcasts. Runtime
  creates a TTL index for transient adapter events (one-hour expiry); the adapter and
  Mongoose use the same pinned MongoDB 7.6 driver. API tests passed (135 passed, 2 optional
  replica-set integration tests skipped); API typecheck/lint, Vercel bundle build, bundle
  syntax check, repository check, and `git diff --check` passed. Cross-instance delivery was
  not tested against a live isolated replica set because `MONGODB_TEST_URI` was not provided.
  The adapter fix was committed as `3f36bbf` and pushed to `origin/main`; production
  deployment and multi-client verification remain pending. Presence still uses
  process-local tracking.

- **Message deletion:** Channel and DM messages now support persistent “Delete for me”
  for current members/participants and “Delete for everyone” for the author or a workspace
  admin. Global deletion removes private attachment assets and broadcasts a typed realtime
  event; personal hides are filtered from history, search, and downloads. API tests passed
  (141 passed, 2 optional MongoDB replica-set tests skipped); API build/typecheck/lint,
  shared types typecheck, web tests (21), web typecheck/lint/build, repository check, and
  `git diff --check` passed. No live DB migration or production-browser check was run.
  Work remains uncommitted on `slacker`. After deployment, run `channels:initialize` and
  `direct-messages:initialize`; then verify both deletion scopes from two clients.

- **Shared API rate limits:** Every non-preflight request is limited to 120 requests per
  client IP per rolling minute using atomic MongoDB updates; health, authentication, and
  unknown routes have no exclusions. Message search retains its separate 30-per-user
  rolling-minute quota and search-specific 429 response. Vercel uses its platform client-IP
  header only in Vercel runtime; other deployments use the direct socket address, never
  generic `x-forwarded-for`. MongoDB limiter failures fail closed with HTTP 503. API tests
  passed (150 passed, 2 optional integration tests skipped); API typecheck, lint, build,
  shared-types typecheck, and `git diff --check` passed. Deterministic adapter tests cover
  cross-instance atomic decisions; no live MongoDB verification ran. Changes remain
  uncommitted alongside unrelated web edits in the shared checkout. Operator: restart or
  redeploy the API, then verify shared limits against the configured MongoDB.

- **Web/API security headers:** The web `proxy.ts` creates a per-request nonce CSP with
  same-origin scripts, API/realtime connection origins, and Google profile image support;
  `unsafe-eval` is development-only, and `unsafe-inline` is limited to style attributes
  needed by existing UI components. API responses set restrictive CSP, `nosniff`, frame,
  referrer, and same-origin resource policies, including errors and CORS preflights.
  Better Auth already enables secure cookies in production and uses HttpOnly cookies by
  default. The web app has no third-party scripts, so SRI does not currently apply. Web
  tests (23), typecheck, focused lint, production Next build, API tests, typecheck, focused
  lint, and `git diff --check` passed. No populated-browser CSP/OAuth test or production
  response-header check ran. Changes remain uncommitted alongside unrelated work. Operator:
  verify CSP console reports, OAuth redirects, cookies, and API/download responses in a
  populated browser and deployed environment. CSP follow-up: the root layout had remained
  eligible for static HTML while the proxy emitted a different nonce for every response,
  leaving build-time scripts blocked by the live policy. The root layout now reads request
  headers to force dynamic rendering, and the proxy forwards `x-nonce` with the CSP. Web
  typecheck and focused lint passed; the production Webpack build reports all routes as
  dynamic. A local production `/sign-in` response was non-cacheable and all 18 rendered
  scripts carried the exact nonce from its CSP. The currently deployed `/sign-in` still
  returns a cached prerendered page with no script nonces, confirming it needs redeployment.
  Turbopack build could not spawn its CSS worker in this environment. The browser console's
  `content.js` eval violation is from a browser extension, separate from the app CSP.
  Redeployment and browser verification remain pending.

- **Socket session lifecycle:** Socket.IO authenticates Better Auth sessions at handshake
  and now revalidates every 30 seconds; invalid sessions, user changes, or authentication
  storage errors disconnect established sockets. Existing workspace-removal revocation
  remains active. The handshake also requires an exact configured web origin and rejects
  missing origins. Socket auth/session/origin tests, API tests, typecheck, build, focused
  lint, and `git diff --check` passed; live lifecycle behavior has not been tested against
  production MongoDB or multiple deployed instances.

- **Socket abuse limits:** Socket.IO now caps each API instance at five sockets per user
  and 20 per client IP, 30 inbound events/user/second with a token bucket, and 16 KiB per
  packet. Vercel's platform IP header is trusted only in Vercel runtime. Counters are
  process-local and multiply across instances; chat sends remain HTTP and use the API-wide
  per-IP limit. Full API tests passed (154 passed, 2 skipped), API build/typecheck and
  focused lint passed, including connection/event/payload tests. MongoDB multi-instance
  test was skipped; work remains uncommitted and undeployed.

- **In-app notifications:** The API stores per-user notifications for channel messages and
  mentions, incoming DMs, channel joins/leaves, and channel updates; authenticated inbox,
  unread-count, read endpoints, and recipient-only realtime events are wired into the web
  bell inbox and channel/DM unread dots. Opening a notification navigates to its workspace
  resource, and opening channel/DM history marks its notifications read. Self-leave persists
  and broadcasts a typed `member_left` system entry rendered in channel history. Public
  contracts are in `packages/types`; HTTP/realtime details and migration instructions are in
  `servers/api/README.md`. Root `pnpm run initialize` and the API task catalog now include
  `notifications:initialize`. Dependency remediation pins API multer at 2.5.0 and workspace
  Zod at 4.6.7, overrides vulnerable transitive Zod 3 resolutions to patched Zod 4, and
  updates the lockfile to patched body-parser and undici releases. `pnpm audit
  --audit-level high` passes; the full audit still reports two low and four moderate
  advisories. Repository tests passed (82 control-plane tests; API 160 passed with two
  optional MongoDB tests skipped; UI 1, web 26, and logging 2). Repository typecheck, lint,
  build, architecture check, and security scan passed; the Vercel API bundle build and
  syntax check passed. No database initializer or live MongoDB test was run; before
  deployment, an authorized operator must run the aggregate initializer against the
  intended database. The feature and dependency-remediation changes were committed as
  `dca6d28` and pushed to `origin/main`; no deployment was performed.
