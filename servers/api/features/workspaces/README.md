# Workspace membership API

Verified Google accounts may sign in without a global email allowlist. An
authenticated user can create multiple workspaces; the creator becomes an
administrator. Workspace membership is the authorization boundary for
channels and other workspace-scoped features.

## Endpoints

- `GET /workspaces` lists the signed-in user's workspaces and roles.
- `POST /workspaces` accepts `{ "name": "..." }` and creates an
  administrator membership for the caller. Every workspace has a public
  `#general` channel, and its creator joins automatically.
- `GET /workspace` returns the caller and selected workspace. Supply the
  selected ID in `X-Workspace-Id`; the API verifies membership and returns
  `workspace_access_denied` when it is absent or unauthorized.
- `GET /workspace/members` returns member names, email addresses, roles, and
  join dates for the selected workspace. Any authenticated workspace member
  may view the roster; supply its ID in `X-Workspace-Id`. The web sidebar
  shows this roster and provides a refresh action. Channel rosters and member
  profiles follow the same email-visibility setting. Member profiles also
  include an optional user-set role or title and avatar.
- `GET /workspace/members/:userId` returns that member's read-only profile to
  other members of the selected workspace. The response includes display
  name, avatar, workspace role, optional title, and email when visible.
- `PATCH /workspaces/:workspaceId/settings` accepts
  `{ "memberEmailsVisible": false }` or `true`. Only workspace admins can
  change this setting. When disabled, email addresses are hidden from regular
  members while administrators can still see them.
- `PATCH /workspaces/:workspaceId/members/:userId` accepts
  `{ "role": "admin" }` or `{ "role": "member" }` and changes a member's
  workspace role. `DELETE` on the same path removes that member from the
  workspace. Only admins can manage other members, including other admins;
  admins cannot manage their own membership, and the final admin cannot be
  removed or demoted.
- `POST /workspaces/:workspaceId/invite-links` creates a reusable link.
  Only workspace administrators may create links. The raw bearer token is
  returned once in the URL; MongoDB stores only its SHA-256 hash. Links
  expire after seven days.
- `POST /workspace-invitations/:token/accept` requires an authenticated
  Google identity and creates a regular workspace membership. A newly
  joining member is automatically added to `#general`. Accepting a link again
  is idempotent for existing members; links can be reused by other people
  until expiry.

The web app preserves an invitation URL through Google sign-in and asks the
recipient to accept it afterward. Links are shared manually; email delivery
is not configured. Workspace admins can create and copy invitation links from
their profile page; the browser keeps the active link locally until it expires.
Users can update their own display name from that page through Better Auth.
They can also set an optional role or title; admins can manage workspace email
visibility there. Admins can manage another member's role or remove them from
their read-only profile page.

## MongoDB setup and migration

Run `pnpm --filter @workspace/api workspaces:initialize` and
`pnpm --filter @workspace/api channels:initialize` before using workspace
APIs. The workspace initializer installs strict validators, membership and
token indexes, and the invite expiry TTL index. The channel initializer
installs channel validators and indexes and creates `#general` for existing
workspaces that do not already have an active channel with that name, joining
their current members. It skips existing `#general` channels on later runs so
members who leave are not automatically re-added. The API returns
`workspace_storage_unavailable` until the initialized schema is present.
If channel storage is unavailable while a workspace is being created, the API
returns `channel_storage_unavailable`; the workspace may already exist, and
rerunning the channel initializer provisions its missing `#general`.
After deploying a version that changes the workspace validator, run the
initializer again so existing databases receive the updated validator. This
release adds the optional membership revision field used to serialize role and
removal changes; run the initializer after deploying it.
Workspace creation and invitation acceptance use transactions, so the
database must be a replica set or sharded cluster; a standalone MongoDB
server is unsupported.

For a database that already has the former configured workspace, set
`LEGACY_WORKSPACE_ID`, `LEGACY_WORKSPACE_NAME`, and optionally
`LEGACY_WORKSPACE_ALLOWED_EMAILS` while running the initializer. The
initializer also recognizes the former `WORKSPACE_ID`, `WORKSPACE_NAME`,
and `WORKSPACE_ALLOWED_EMAILS` names. It imports existing matching accounts
and channel members into workspace memberships in one transaction. The
first existing account in the legacy allowlist becomes the workspace
administrator; if there is no matching allowlisted account, the
lexicographically first channel member becomes administrator. Former
channel-admin roles do not grant workspace-admin privileges. Migration
fails clearly if it cannot identify any existing member account. Keep the
old values available until this one-time migration has completed. No live
database migration is run by the application startup.
