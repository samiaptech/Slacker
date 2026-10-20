import test from "node:test";
import assert from "node:assert/strict";
import { WORKSPACE_INVITE_LIFETIME_MS, type WorkspaceCreateResult } from "../index.js";
import { createWorkspaceServiceFixture } from "../../../tests/workspace-service-fixture.js";

const owner = {
  id: "owner-1",
  name: "Workspace Owner",
  email: "owner@example.test",
  image: null
};
const invitedUser = {
  id: "invitee-1",
  name: "Invited User",
  email: "invitee@example.test",
  image: null
};

const createdWorkspace = (result: WorkspaceCreateResult) => {
  if (result.kind !== "created") throw new Error(`Workspace creation failed: ${result.kind}`);
  return result.workspace;
};

void test("creates separate workspaces and grants creator administrator membership", async () => {
  const generalChannelEnsures: string[] = [];
  const { service } = createWorkspaceServiceFixture(false, (workspaceId, userId) => {
    generalChannelEnsures.push(`${workspaceId}:${userId}`);
    return Promise.resolve("ready");
  });
  const first = createdWorkspace(await service.create(owner, "  Product   Team "));
  const second = createdWorkspace(await service.create({ ...owner, id: "another-user" }, "Product Team"));

  assert.deepEqual(first, { id: "workspace-1", name: "Product Team", role: "admin" });
  assert.notEqual(first.id, second.id);
  assert.deepEqual(generalChannelEnsures, ["workspace-1:owner-1", "workspace-2:another-user"]);
  assert.deepEqual(await service.listForUser(owner.id), { kind: "listed", workspaces: [first] });
  assert.deepEqual(await service.getAccess(owner, first.id), {
    kind: "allowed",
    access: { workspace: { id: first.id, name: first.name }, user: owner }
  });
  assert.deepEqual(await service.getAccess(invitedUser, first.id), { kind: "denied" });
});

void test("validates workspace names and requires an authenticated creator", async () => {
  const { service } = createWorkspaceServiceFixture();
  assert.deepEqual(await service.create(null, "Team"), { kind: "unauthenticated" });
  assert.deepEqual(await service.create(owner, "  "), { kind: "invalid" });
  assert.deepEqual(await service.create(owner, "x".repeat(81)), { kind: "invalid" });
});

void test("does not accept an invitation when the default channel cannot be provisioned", async () => {
  const fixture = createWorkspaceServiceFixture(false, (_workspaceId, userId) =>
    Promise.resolve(userId === invitedUser.id ? "unavailable" : "ready"));
  const workspace = createdWorkspace(await fixture.service.create(owner, "Team"));
  const invite = await fixture.service.createInviteLink(owner, workspace.id);
  assert.equal(invite.kind, "created");
  const token = new URL(invite.url).pathname.split("/").at(-1);
  assert.ok(token);

  assert.deepEqual(await fixture.service.acceptInvite(invitedUser, token), { kind: "channel-unavailable" });
  assert.equal(fixture.memberships.has(`${workspace.id}:${invitedUser.id}`), false);
});

void test("creates reusable invite links that expire after seven days and stores only token hashes", async () => {
  const ensureCalls: string[] = [];
  const fixture = createWorkspaceServiceFixture(false, (workspaceId, userId) => {
    ensureCalls.push(`${workspaceId}:${userId}`);
    return Promise.resolve("ready");
  });
  const workspace = createdWorkspace(await fixture.service.create(owner, "Team"));

  const invite = await fixture.service.createInviteLink(owner, workspace.id);
  assert.equal(invite.kind, "created");
  assert.equal(invite.expiresAt.getTime() - new Date("2026-10-14T00:00:00.000Z").getTime(), WORKSPACE_INVITE_LIFETIME_MS);
  const token = new URL(invite.url).pathname.split("/").at(-1);
  assert.ok(token);
  assert.equal([...fixture.inviteLinks.values()].some((stored) => stored.tokenHash === token), false);

  assert.deepEqual(await fixture.service.acceptInvite(invitedUser, token), {
    kind: "joined",
    workspace: { id: workspace.id, name: workspace.name }
  });
  assert.deepEqual(ensureCalls, [`${workspace.id}:${owner.id}`, `${workspace.id}:${invitedUser.id}`]);
  const ensuresAfterJoin = ensureCalls.length;
  assert.deepEqual(await fixture.service.acceptInvite(invitedUser, token), {
    kind: "already-member",
    workspace: { id: workspace.id, name: workspace.name }
  });
  assert.equal(ensureCalls.length, ensuresAfterJoin);
  assert.deepEqual(await fixture.service.acceptInvite({ ...invitedUser, id: "second-invitee" }, token), {
    kind: "joined",
    workspace: { id: workspace.id, name: workspace.name }
  });
  assert.equal(ensureCalls.length, ensuresAfterJoin + 1);
});

void test("only a workspace admin can create an invite link", async () => {
  const fixture = createWorkspaceServiceFixture();
  const workspace = createdWorkspace(await fixture.service.create(owner, "Team"));
  assert.deepEqual(await fixture.service.createInviteLink(invitedUser, workspace.id), { kind: "denied" });
  assert.deepEqual(await fixture.service.acceptInvite(null, "a-valid-looking-invite-token-123456789"), {
    kind: "unauthenticated"
  });
});

void test("reports workspace membership storage outages without treating them as denied access", async () => {
  const { service } = createWorkspaceServiceFixture(true);

  assert.equal(await service.isMember("workspace-1", "user-1"), "unavailable");
  assert.deepEqual(await service.listMembers(owner, "workspace-1"), { kind: "unavailable" });
});

void test("lists workspace members with their profile, role, and join time to any workspace member", async () => {
  const fixture = createWorkspaceServiceFixture();
  fixture.seed("team-1", ["owner-1", "invitee-1"]);

  assert.deepEqual(await fixture.service.listMembers(invitedUser, "team-1"), {
    kind: "listed",
    members: [
      {
        id: "owner-1",
        name: "User owner-1",
        title: null,
        email: "owner-1@example.test",
        image: null,
        role: "admin",
        joinedAt: new Date("2026-10-13T00:00:00.000Z")
      },
      {
        id: "invitee-1",
        name: "User invitee-1",
        title: null,
        email: "invitee-1@example.test",
        image: null,
        role: "member",
        joinedAt: new Date("2026-10-13T00:00:00.000Z")
      }
    ],
    memberEmailsVisible: true
  });
  assert.deepEqual(await fixture.service.listMembers({ ...invitedUser, id: "outsider" }, "team-1"), { kind: "denied" });
  assert.deepEqual(await fixture.service.listMembers(null, "team-1"), { kind: "unauthenticated" });
});

void test("workspace admins control member email visibility without changing admin access", async () => {
  const fixture = createWorkspaceServiceFixture();
  fixture.seed("team-1", ["owner-1", "invitee-1"]);

  assert.deepEqual(await fixture.service.setMemberEmailsVisible(owner, "team-1", false), {
    kind: "updated",
    memberEmailsVisible: false
  });
  const memberList = await fixture.service.listMembers(invitedUser, "team-1");
  assert.equal(memberList.kind, "listed");
  assert.equal(memberList.memberEmailsVisible, false);
  assert.equal(memberList.members.every((member) => member.email === null), true);
  const adminList = await fixture.service.listMembers(owner, "team-1");
  assert.equal(adminList.kind, "listed");
  assert.equal(adminList.members.every((member) => member.email !== null), true);
  const memberProfile = await fixture.service.getMemberProfile(invitedUser, "team-1", "owner-1");
  assert.equal(memberProfile.kind, "found");
  assert.equal(memberProfile.member.email, null);
  const adminProfile = await fixture.service.getMemberProfile(owner, "team-1", "invitee-1");
  assert.equal(adminProfile.kind, "found");
  assert.equal(adminProfile.member.email, "invitee-1@example.test");
  assert.deepEqual(await fixture.service.setMemberEmailsVisible(invitedUser, "team-1", true), { kind: "denied" });
});
