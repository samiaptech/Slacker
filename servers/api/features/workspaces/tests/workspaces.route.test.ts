import test from "node:test";
import assert from "node:assert/strict";
import type { Logger } from "@workspace/logging";
import { createApp, createServer } from "../../../bootstrap/index.js";
import { createWorkspaceServiceFixture } from "../../../tests/workspace-service-fixture.js";
import type { AuthenticationIntegration } from "../../../integrations/index.js";
import type { ApiConfig } from "../../../types/index.js";
import type { WorkspaceChannelRealtimePublisher as ChannelRealtimePublisher } from "../../channels/public/index.js";
import { allowApiRateLimit } from "../../../tests/rate-limit-fixture.js";

const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const config: ApiConfig = {
  environment: "test",
  host: "127.0.0.1",
  port: 0,
  webOrigin: "http://localhost:3000",
  mongodbUri: "mongodb://localhost/workspace",
  betterAuthUrl: "http://localhost:4000",
  betterAuthSecret: "test-secret-that-is-at-least-thirty-two-characters",
  googleClientId: "client-id",
  googleClientSecret: "client-secret",
  logLevel: "silent"
};

const identities = new Map([
  ["owner", { id: "owner-1", name: "Workspace Owner", title: null, email: "owner@example.test", image: null }],
  ["member", { id: "member-1", name: "Workspace Member", title: null, email: "member@example.test", image: null }],
  ["other", { id: "other-1", name: "Another User", title: null, email: "other@example.test", image: null }]
]);

const createAuthentication = (): AuthenticationIntegration => ({
  handler: (_request, _response, next): void => { next(); },
  getIdentity: (headers) => Promise.resolve(
    typeof headers["x-test-identity"] === "string"
      ? identities.get(headers["x-test-identity"]) ?? null
      : null
  ),
  findUserByEmail: () => Promise.resolve(null),
  findUsersByIds: () => Promise.resolve([])
});
const channelMessageService: Parameters<typeof createApp>[0]["channelMessageService"] = {
  list: () => Promise.resolve({ kind: "channel-unavailable" }),
  send: () => Promise.resolve({ kind: "channel-unavailable" }),
  getAttachment: () => Promise.resolve({ kind: "not-found" }),
  delete: () => Promise.resolve({ kind: "not-found" }),
  toggleReaction: () => Promise.resolve({ kind: "not-found" })
};

const startApi = async (
  fixture = createWorkspaceServiceFixture(),
  channelServiceOverrides: Partial<Pick<Parameters<typeof createApp>[0]["channelService"], "inviteMember">> = {},
  channelRealtime?: ChannelRealtimePublisher
) => {
  const app = createApp({
    config,
    logger,
    rateLimiter: allowApiRateLimit,
    trustVercelForwardedFor: false,
    authentication: createAuthentication(),
    channelService: {
      create: () => Promise.resolve({ kind: "unavailable" as const }),
      getForMember: () => Promise.resolve(null),
      listForMember: () => Promise.resolve([]),
      listChannels: () => Promise.resolve({ channels: [], nextCursor: null }),
      joinPublicChannel: () => Promise.resolve({ kind: "channel-unavailable" as const }),
      leaveChannel: () => Promise.resolve({ kind: "already-left" as const }),
      ensureGeneralChannel: () => Promise.resolve({ kind: "unavailable" as const }),
      listMembers: () => Promise.resolve({ kind: "channel-unavailable" as const }),
      inviteMember: () => Promise.resolve({ kind: "channel-unavailable" as const }),
      removeMember: () => Promise.resolve({ kind: "channel-unavailable" as const }),
      ...channelServiceOverrides
    },
    channelMessageService,
    ...(channelRealtime ? { channelRealtime } : {}),
    workspaceService: fixture.service
  });
  const server = createServer({ app, config, logger });
  await server.start();
  const address = server.raw.address();
  assert.ok(address && typeof address === "object");
  return { server, url: `http://127.0.0.1:${String(address.port)}`, fixture };
};

void test("allows any authenticated Google identity to sign in before workspace membership", async (context) => {
  const { server, url } = await startApi();
  context.after(async () => server.stop());

  const unauthenticated = await fetch(`${url}/workspaces`);
  assert.equal(unauthenticated.status, 401);

  const signedInWithoutWorkspace = await fetch(`${url}/workspaces`, {
    headers: { "x-test-identity": "other" }
  });
  assert.equal(signedInWithoutWorkspace.status, 200);
  assert.deepEqual(await signedInWithoutWorkspace.json(), { workspaces: [] });
});

void test("creates a workspace and grants its creator administrator membership", async (context) => {
  const { server, url } = await startApi();
  context.after(async () => server.stop());

  const response = await fetch(`${url}/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-identity": "owner" },
    body: JSON.stringify({ name: "  Product   Team " })
  });
  assert.equal(response.status, 201);
  const body = await response.json() as { workspace: { id: string; name: string; role: string } };
  assert.deepEqual(body.workspace, { id: "workspace-1", name: "Product Team", role: "admin" });
  assert.deepEqual(await (await fetch(`${url}/workspaces`, {
    headers: { "x-test-identity": "owner" }
  })).json(), { workspaces: [body.workspace] });
});

void test("reports channel persistence failures while provisioning a new workspace", async (context) => {
  const fixture = createWorkspaceServiceFixture(false, () => Promise.resolve("unavailable"));
  const { server, url } = await startApi(fixture);
  context.after(async () => server.stop());

  const response = await fetch(`${url}/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-identity": "owner" },
    body: JSON.stringify({ name: "Product Team" })
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: {
      code: "channel_storage_unavailable",
      message: "Channel storage is temporarily unavailable."
    }
  });
});

void test("issues reusable seven-day invitation links and joins users after sign-in", async (context) => {
  const fixture = createWorkspaceServiceFixture();
  fixture.seed("team-1", ["owner-1"]);
  const { server, url } = await startApi(fixture);
  context.after(async () => server.stop());

  const linkResponse = await fetch(`${url}/workspaces/team-1/invite-links`, {
    method: "POST",
    headers: { "x-test-identity": "owner" }
  });
  assert.equal(linkResponse.status, 201);
  const link = await linkResponse.json() as { inviteUrl: string; expiresAt: string };
  assert.equal(link.expiresAt, "2026-10-21T00:00:00.000Z");
  const token = new URL(link.inviteUrl).pathname.split("/").at(-1);
  assert.ok(token);

  const joined = await fetch(`${url}/workspace-invitations/${token}/accept`, {
    method: "POST",
    headers: { "x-test-identity": "member" }
  });
  assert.equal(joined.status, 200);
  assert.deepEqual(await joined.json(), {
    workspace: { id: "team-1", name: "Workspace team-1" },
    alreadyMember: false
  });

  const repeated = await fetch(`${url}/workspace-invitations/${token}/accept`, {
    method: "POST",
    headers: { "x-test-identity": "other" }
  });
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), {
    workspace: { id: "team-1", name: "Workspace team-1" },
    alreadyMember: false
  });
});

void test("returns selected workspace context only to members", async (context) => {
  const fixture = createWorkspaceServiceFixture();
  fixture.seed("team-1", ["owner-1"]);
  const { server, url } = await startApi(fixture);
  context.after(async () => server.stop());

  const access = await fetch(`${url}/workspace`, {
    headers: { "x-test-identity": "owner", "x-workspace-id": "team-1" }
  });
  assert.equal(access.status, 200);
  assert.deepEqual(await access.json(), {
    workspace: { id: "team-1", name: "Workspace team-1" },
    user: identities.get("owner")
  });

  const denied = await fetch(`${url}/workspace`, {
    headers: { "x-test-identity": "other", "x-workspace-id": "team-1" }
  });
  assert.equal(denied.status, 403);

  const missingWorkspace = await fetch(`${url}/workspace`, {
    headers: { "x-test-identity": "owner" }
  });
  assert.equal(missingWorkspace.status, 403);
});

void test("lists member profiles for workspace members and denies non-members", async (context) => {
  const fixture = createWorkspaceServiceFixture();
  fixture.seed("team-1", ["owner-1", "member-1"]);
  const { server, url } = await startApi(fixture);
  context.after(async () => server.stop());

  const response = await fetch(`${url}/workspace/members`, {
    headers: { "x-test-identity": "member", "x-workspace-id": "team-1" }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    members: [
      {
        id: "owner-1",
        name: "User owner-1",
        title: null,
        email: "owner-1@example.test",
        image: null,
        role: "admin",
        joinedAt: "2026-10-13T00:00:00.000Z"
      },
      {
        id: "member-1",
        name: "User member-1",
        title: null,
        email: "member-1@example.test",
        image: null,
        role: "member",
        joinedAt: "2026-10-13T00:00:00.000Z"
      }
    ],
    memberEmailsVisible: true
  });

  const denied = await fetch(`${url}/workspace/members`, {
    headers: { "x-test-identity": "other", "x-workspace-id": "team-1" }
  });
  assert.equal(denied.status, 403);
});

void test("lets admins hide member emails and prevents regular members changing the setting", async (context) => {
  const fixture = createWorkspaceServiceFixture();
  fixture.seed("team-1", ["owner-1", "member-1"]);
  const { server, url } = await startApi(fixture);
  context.after(async () => server.stop());

  const hidden = await fetch(`${url}/workspaces/team-1/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-test-identity": "owner" },
    body: JSON.stringify({ memberEmailsVisible: false })
  });
  assert.equal(hidden.status, 200);
  assert.deepEqual(await hidden.json(), { memberEmailsVisible: false });

  const visibleRoster = await fetch(`${url}/workspace/members`, {
    headers: { "x-test-identity": "member", "x-workspace-id": "team-1" }
  });
  const rosterBody = await visibleRoster.json() as { members: readonly { email: string | null }[] };
  assert.equal(rosterBody.members.every((member) => member.email === null), true);

  const denied = await fetch(`${url}/workspaces/team-1/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-test-identity": "member" },
    body: JSON.stringify({ memberEmailsVisible: true })
  });
  assert.equal(denied.status, 403);
});

void test("lets admins change other member roles and remove members", async (context) => {
  const fixture = createWorkspaceServiceFixture();
  fixture.seed("team-1", ["owner-1", "member-1", "other-1"]);
  const { server, url } = await startApi(fixture);
  context.after(async () => server.stop());

  const promote = await fetch(`${url}/workspaces/team-1/members/member-1`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-test-identity": "owner" },
    body: JSON.stringify({ role: "admin" })
  });
  assert.equal(promote.status, 200);
  assert.deepEqual(await promote.json(), { userId: "member-1", role: "admin" });

  const promoteAnother = await fetch(`${url}/workspaces/team-1/members/other-1`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-test-identity": "owner" },
    body: JSON.stringify({ role: "admin" })
  });
  assert.equal(promoteAnother.status, 200);

  const demoteAnotherAdmin = await fetch(`${url}/workspaces/team-1/members/owner-1`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-test-identity": "member" },
    body: JSON.stringify({ role: "member" })
  });
  assert.equal(demoteAnotherAdmin.status, 200);
  assert.deepEqual(await demoteAnotherAdmin.json(), { userId: "owner-1", role: "member" });

  const nonAdminDenied = await fetch(`${url}/workspaces/team-1/members/other-1`, {
    method: "DELETE",
    headers: { "x-test-identity": "owner" }
  });
  assert.equal(nonAdminDenied.status, 403);

  const selfRoleChangeDenied = await fetch(`${url}/workspaces/team-1/members/member-1`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-test-identity": "member" },
    body: JSON.stringify({ role: "member" })
  });
  assert.equal(selfRoleChangeDenied.status, 403);

  const removeAdmin = await fetch(`${url}/workspaces/team-1/members/other-1`, {
    method: "DELETE",
    headers: { "x-test-identity": "member" }
  });
  assert.equal(removeAdmin.status, 204);
  assert.equal(fixture.memberships.has("team-1:other-1"), false);
  const removeMember = await fetch(`${url}/workspaces/team-1/members/owner-1`, {
    method: "DELETE",
    headers: { "x-test-identity": "member" }
  });
  assert.equal(removeMember.status, 204);
  assert.equal(fixture.memberships.has("team-1:owner-1"), false);
});

void test("allows a member to leave but denies removing another member and invalidates realtime access", async (context) => {
  const fixture = createWorkspaceServiceFixture();
  fixture.seed("team-1", ["owner-1", "member-1", "other-1"]);
  const notifications: string[] = [];
  const realtime: ChannelRealtimePublisher = {
    publishMessage: () => undefined,
    publishMessageDeleted: () => undefined,
    publishMessageReactions: () => undefined,
    publishChannelListChanged: () => undefined,
    publishWorkspaceMembersChanged: (workspaceId) => notifications.push(`members:${workspaceId}`),
    publishMembersChanged: () => undefined,
    revokeChannelAccess: () => undefined,
    revokeWorkspaceAccess: (workspaceId, userId) => notifications.push(`revoke:${workspaceId}:${userId}`)
  };
  const { server, url } = await startApi(fixture, {}, realtime);
  context.after(async () => server.stop());

  const denied = await fetch(`${url}/workspaces/team-1/members/other-1`, {
    method: "DELETE",
    headers: { "x-test-identity": "member" }
  });
  assert.equal(denied.status, 403);

  const left = await fetch(`${url}/workspaces/team-1/members/member-1`, {
    method: "DELETE",
    headers: { "x-test-identity": "member" }
  });
  assert.equal(left.status, 204);
  assert.equal(fixture.memberships.has("team-1:member-1"), false);
  assert.deepEqual(notifications, ["members:team-1", "revoke:team-1:member-1"]);
});

void test("allows an admin to leave when another admin remains", async (context) => {
  const fixture = createWorkspaceServiceFixture();
  fixture.seed("team-1", ["owner-1", "member-1"], "admin");
  const { server, url } = await startApi(fixture);
  context.after(async () => server.stop());

  const response = await fetch(`${url}/workspaces/team-1/members/owner-1`, {
    method: "DELETE",
    headers: { "x-test-identity": "owner" }
  });
  assert.equal(response.status, 204);
  assert.equal(fixture.memberships.has("team-1:owner-1"), false);
  assert.equal(fixture.memberships.get("team-1:member-1")?.role, "admin");
});

void test("prevents the last admin from leaving a workspace", async (context) => {
  const fixture = createWorkspaceServiceFixture();
  fixture.seed("team-1", ["owner-1"], "admin");
  const { server, url } = await startApi(fixture);
  context.after(async () => server.stop());

  const response = await fetch(`${url}/workspaces/team-1/members/owner-1`, {
    method: "DELETE",
    headers: { "x-test-identity": "owner" }
  });
  assert.equal(response.status, 409);
  assert.equal(fixture.memberships.has("team-1:owner-1"), true);
});

void test("returns a read-only workspace profile only to members of that workspace", async (context) => {
  const fixture = createWorkspaceServiceFixture();
  fixture.seed("team-1", ["owner-1", "member-1"]);
  const { server, url } = await startApi(fixture);
  context.after(async () => server.stop());

  const response = await fetch(`${url}/workspace/members/member-1`, {
    headers: { "x-test-identity": "owner", "x-workspace-id": "team-1" }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    member: {
      id: "member-1",
      name: "User member-1",
      title: null,
      email: "member-1@example.test",
      image: null,
      role: "member",
      joinedAt: "2026-10-13T00:00:00.000Z"
    }
  });
});

void test("maps workspace membership outages during channel invitations to a workspace storage error", async (context) => {
  const fixture = createWorkspaceServiceFixture();
  fixture.seed("team-1", ["owner-1"]);
  const { server, url } = await startApi(fixture, {
    inviteMember: () => Promise.resolve({ kind: "workspace-unavailable" })
  });
  context.after(async () => server.stop());

  const response = await fetch(`${url}/channels/channel-1/invitations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-identity": "owner",
      "x-workspace-id": "team-1"
    },
    body: JSON.stringify({ email: "member@example.test" })
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: {
      code: "workspace_storage_unavailable",
      message: "Workspace storage is temporarily unavailable."
    }
  });
});
