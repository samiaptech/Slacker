import test from "node:test";
import assert from "node:assert/strict";
import type { Logger } from "@workspace/logging";
import type { CreateChannelResult } from "../domain/index.js";
import type { ChannelService } from "../services/index.js";
import type { ChannelMessageService } from "../services/index.js";
import type { ChannelMessageWithSender } from "../services/index.js";
import { prepareCreateChannelCommand } from "../domain/index.js";
import { createApp, createServer } from "../../../bootstrap/index.js";
import type { AuthenticationIntegration } from "../../../integrations/index.js";
import type { ChatAttachmentIntegration } from "../../../integrations/index.js";
import type { ApiConfig } from "../../../types/index.js";
import type { ChatAttachmentRecord } from "../../../types/chat/index.js";
import { createWorkspaceServiceFixture } from "../../../tests/workspace-service-fixture.js";

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
const workspaceHeaders = { "x-workspace-id": "workspace-configured" };
const memberIdentity = { id: "google-subject-1", name: "Member", email: "member@example.test", image: null };
const otherMemberIdentity = { ...memberIdentity, id: "google-subject-2" };
const outsideIdentity = { ...memberIdentity, id: "google-subject-outside", email: "outside@example.test" };
const authentication: AuthenticationIntegration = {
  handler: (_request, _response, next): void => { next(); },
  getIdentity: (headers) => Promise.resolve(headers["x-test-identity"] === "member"
    ? memberIdentity
    : headers["x-test-identity"] === "other-member"
      ? otherMemberIdentity
      : headers["x-test-identity"] === "outside" ? outsideIdentity : null),
  findUserByEmail: (email) => Promise.resolve(email === otherMemberIdentity.email ? otherMemberIdentity : null),
  findUsersByIds: (userIds) => Promise.resolve(
    [memberIdentity, otherMemberIdentity].filter((identity) => userIds.includes(identity.id))
  )
};
const createdResult: CreateChannelResult = {
  channel: {
    id: "channel-1", workspaceId: "workspace-configured", name: "general", description: null, visibility: "public",
    lifecycleState: "active", createdBy: memberIdentity.id,
    createdAt: new Date("2026-10-12T00:00:00.000Z"), updatedAt: new Date("2026-10-12T00:00:00.000Z"), archivedAt: null
  },
  creatorMembership: {
    channelId: "channel-1", userId: memberIdentity.id, role: "admin", joinedAt: new Date("2026-10-12T00:00:00.000Z")
  }
};
const channelMessage: ChannelMessageWithSender = Object.freeze({
  id: "message-1",
  channelId: "channel-1",
  senderId: memberIdentity.id,
  text: "Hello, channel!",
  createdAt: new Date("2026-10-15T12:00:00.000Z"),
  sender: Object.freeze({ id: memberIdentity.id, name: memberIdentity.name, image: null })
});

const startApi = async (
  create: ChannelService["create"],
  getForMember: ChannelService["getForMember"] = () => Promise.resolve(null),
  listChannels: ChannelService["listChannels"] = () => Promise.resolve({ channels: [], nextCursor: null }),
  joinPublicChannel: ChannelService["joinPublicChannel"] = () => Promise.resolve({ kind: "channel-unavailable" }),
  leaveChannel: ChannelService["leaveChannel"] = () => Promise.resolve({ kind: "already-left" }),
  listMembers: ChannelService["listMembers"] = () => Promise.resolve({ kind: "channel-unavailable" }),
  inviteMember: ChannelService["inviteMember"] = () => Promise.resolve({ kind: "channel-unavailable" }),
  removeMember: ChannelService["removeMember"] = () => Promise.resolve({ kind: "channel-unavailable" }),
  ensureGeneralChannel: ChannelService["ensureGeneralChannel"] = () => Promise.resolve({ kind: "unavailable" }),
  messageService: ChannelMessageService = {
    list: () => Promise.resolve({ kind: "channel-unavailable" }),
    send: () => Promise.resolve({ kind: "channel-unavailable" }),
    getAttachment: () => Promise.resolve({ kind: "not-found" })
  },
  attachmentStorage?: ChatAttachmentIntegration
) => {
  const workspaceFixture = createWorkspaceServiceFixture();
  workspaceFixture.seed("workspace-configured", [memberIdentity.id, otherMemberIdentity.id]);
  const app = createApp({
    config,
    logger,
    authentication,
    workspaceService: workspaceFixture.service,
    channelMessageService: messageService,
    ...(attachmentStorage ? { attachmentStorage } : {}),
    channelService: {
      create,
      getForMember,
      listForMember: () => Promise.resolve([]),
      listChannels,
      joinPublicChannel,
      leaveChannel,
      ensureGeneralChannel,
      listMembers,
      inviteMember,
      removeMember
    }
  });

  const server = createServer({ app, config, logger });
  await server.start();
  const address = server.raw.address();
  assert.ok(address && typeof address === "object");
  return {
    server,
    url: `http://127.0.0.1:${String(address.port)}/channels`,
    workspaceFixture
  };
};

const createTestChannel: ChannelService["create"] = (input) => {
  const prepared = prepareCreateChannelCommand(input);
  if (!prepared.ok) return Promise.resolve({ kind: "invalid" as const, error: prepared.error });
  const result: CreateChannelResult = {
    channel: {
      ...createdResult.channel,
      workspaceId: prepared.command.workspaceId,
      name: prepared.command.name,
      description: prepared.command.description,
      visibility: prepared.command.visibility,
      createdBy: prepared.command.creatorId
    },
    creatorMembership: { ...createdResult.creatorMembership, userId: prepared.command.creatorId }
  };
  return Promise.resolve({ kind: "created" as const, replayed: false, result });
};

void test("creates a channel for an approved identity using server-derived workspace and user IDs", async (context) => {
  let received: unknown;
  const { server, url } = await startApi(async (input) => {
    received = input;
    return createTestChannel(input);
  });

  context.after(async () => server.stop());
  const response = await fetch(url, {
    method: "POST",
    headers: { ...workspaceHeaders, "content-type": "application/json", "x-test-identity": "member", "idempotency-key": "request-1" },
    body: JSON.stringify({ name: "General", description: "Team updates", visibility: "private" })
  });
  assert.equal(response.status, 201);
  assert.deepEqual(received, {
    workspaceId: "workspace-configured", creatorId: memberIdentity.id, name: "General", visibility: "private",
    description: "Team updates", idempotencyKey: "request-1"
  });
  const body = await response.json() as Readonly<{
    channel: Readonly<{ id: string; visibility: string }>;
    creatorMembership: Readonly<{ role: string; userId: string }>;
  }>;
  assert.equal(body.channel.id, "channel-1");
  assert.equal(body.channel.visibility, "private");
  assert.equal(body.creatorMembership.role, "admin");
  assert.equal(body.creatorMembership.userId, memberIdentity.id);
});

void test("returns channel details only to an active member and suppresses private existence", async (context) => {
  const { server, url } = await startApi(createTestChannel, (workspaceId, channelId, userId) =>
    workspaceId === "workspace-configured" && channelId === "channel-1" && userId === memberIdentity.id
      ? Promise.resolve(createdResult.channel)
      : Promise.resolve(null));
  context.after(async () => server.stop());

  const response = await fetch(`${url}/channel-1`, { headers: { ...workspaceHeaders, "x-test-identity": "member" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ...createdResult.channel,
    createdAt: createdResult.channel.createdAt.toISOString(),
    updatedAt: createdResult.channel.updatedAt.toISOString(),
    archivedAt: null
  });

  const hidden = await fetch(`${url}/unknown-channel`, { headers: { ...workspaceHeaders, "x-test-identity": "member" } });
  assert.equal(hidden.status, 404);
  assert.equal((await hidden.json() as { error: { code: string } }).error.code, "route_not_found");

  const nonMember = await fetch(`${url}/channel-1`, { headers: { ...workspaceHeaders, "x-test-identity": "other-member" } });
  assert.equal(nonMember.status, 404);
  assert.equal((await nonMember.json() as { error: { code: string } }).error.code, "route_not_found");
});

void test("lists active channels for an approved member and requires workspace access", async (context) => {
  let receivedQuery: Parameters<ChannelService["listChannels"]>[2] | null = null;
  const { server, url } = await startApi(createTestChannel, undefined, (workspaceId, userId, query) => {
    receivedQuery = query;
    return workspaceId === "workspace-configured" && userId === memberIdentity.id
      ? Promise.resolve({ channels: [createdResult.channel], nextCursor: "next-page" })
      : Promise.resolve({ channels: [], nextCursor: null });
  });
  context.after(async () => server.stop());

  const response = await fetch(url, { headers: { ...workspaceHeaders, "x-test-identity": "member" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(receivedQuery, { scope: "joined", pageSize: 25, cursor: null });
  assert.deepEqual(await response.json(), {
    channels: [{
      ...createdResult.channel,
      createdAt: createdResult.channel.createdAt.toISOString(),
      updatedAt: createdResult.channel.updatedAt.toISOString(),
      archivedAt: null
    }],
    nextCursor: "next-page"
  });

  const unauthenticated = await fetch(url);
  assert.equal(unauthenticated.status, 401);
  const denied = await fetch(url, { headers: { ...workspaceHeaders, "x-test-identity": "outside" } });
  assert.equal(denied.status, 403);
});

void test("validates discovery filters and cursor tokens before querying", async (context) => {
  let calls = 0;
  let receivedQuery: Parameters<ChannelService["listChannels"]>[2] | null = null;
  const { server, url } = await startApi(createTestChannel, undefined, (_workspaceId, _userId, query) => {
    calls += 1;
    receivedQuery = query;
    return Promise.resolve({ channels: [], nextCursor: null });
  });
  context.after(async () => server.stop());

  const invalidCursor = await fetch(`${url}?scope=discoverable&cursor=not-a-cursor`, {
    headers: { ...workspaceHeaders, "x-test-identity": "member" }
  });
  assert.equal(invalidCursor.status, 400);
  assert.equal(calls, 0);

  const invalidLimit = await fetch(`${url}?limit=51`, { headers: { ...workspaceHeaders, "x-test-identity": "member" } });
  assert.equal(invalidLimit.status, 400);
  assert.equal(calls, 0);

  const discovered = await fetch(`${url}?scope=discoverable&limit=7`, {
    headers: { ...workspaceHeaders, "x-test-identity": "member" }
  });
  assert.equal(discovered.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(receivedQuery, { scope: "discoverable", pageSize: 7, cursor: null });
});

void test("rejects unauthenticated and non-member channel creation", async (context) => {
  const { server, url } = await startApi(createTestChannel);
  context.after(async () => server.stop());
  const unauthenticated = await fetch(url, { method: "POST", headers: { ...workspaceHeaders, "content-type": "application/json" }, body: "{}" });
  assert.equal(unauthenticated.status, 401);
  const denied = await fetch(url, {
    method: "POST", headers: { ...workspaceHeaders, "content-type": "application/json", "x-test-identity": "outside" },
    body: JSON.stringify({ name: "general", visibility: "public" })
  });
  assert.equal(denied.status, 403);
});

void test("rejects malformed channel input with the stable validation error", async (context) => {
  const { server, url } = await startApi(createTestChannel);
  context.after(async () => server.stop());
  const response = await fetch(url, {
    method: "POST", headers: { ...workspaceHeaders, "content-type": "application/json", "x-test-identity": "member" },
    body: JSON.stringify({ name: "bad name", visibility: "public" })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "validation_error");

  const oversizedDescription = await fetch(url, {
    method: "POST",
    headers: { ...workspaceHeaders, "content-type": "application/json", "x-test-identity": "member" },
    body: JSON.stringify({ name: "valid", description: "x".repeat(501), visibility: "public" })
  });
  assert.equal(oversizedDescription.status, 400);
  assert.equal((await oversizedDescription.json() as { error: { code: string } }).error.code, "validation_error");
});

void test("joins public channels and leaves with authenticated workspace membership", async (context) => {
  let joinArguments: readonly string[] | null = null;
  let leaveArguments: readonly string[] | null = null;
  const { server, url } = await startApi(
    createTestChannel,
    undefined,
    undefined,
    (workspaceId, channelId, userId) => {
      joinArguments = [workspaceId, channelId, userId];
      return Promise.resolve({
        kind: "joined",
        membership: { ...createdResult.creatorMembership, userId, joinedAt: new Date("2026-10-13T00:00:00.000Z") }
      });
    },
    (workspaceId, channelId, userId) => {
      leaveArguments = [workspaceId, channelId, userId];
      return Promise.resolve({ kind: "left" });
    }
  );
  context.after(async () => server.stop());

  const joined = await fetch(`${url}/channel-1/memberships`, {
    method: "POST",
    headers: { ...workspaceHeaders, "x-test-identity": "member" }
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.headers.get("cache-control"), "no-store");
  assert.deepEqual(joinArguments, ["workspace-configured", "channel-1", memberIdentity.id]);
  assert.deepEqual(await joined.json(), {
    membership: {
      channelId: "channel-1",
      userId: memberIdentity.id,
      role: "admin",
      joinedAt: "2026-10-13T00:00:00.000Z"
    }
  });

  const left = await fetch(`${url}/channel-1/memberships`, {
    method: "DELETE",
    headers: { ...workspaceHeaders, "x-test-identity": "member" }
  });
  assert.equal(left.status, 204);
  assert.equal(left.headers.get("cache-control"), "no-store");
  assert.deepEqual(leaveArguments, ["workspace-configured", "channel-1", memberIdentity.id]);

  const unauthenticated = await fetch(`${url}/channel-1/memberships`, { method: "POST" });
  assert.equal(unauthenticated.status, 401);
});

void test("rejects private channel joins and allows the last administrator to leave", async (context) => {
  const { server, url } = await startApi(
    createTestChannel,
    undefined,
    undefined,
    () => Promise.resolve({ kind: "not-public" }),
    () => Promise.resolve({ kind: "left" })
  );
  context.after(async () => server.stop());

  const joinResponse = await fetch(`${url}/channel-1/memberships`, {
    method: "POST",
    headers: { ...workspaceHeaders, "x-test-identity": "member" }
  });
  assert.equal(joinResponse.status, 403);
  assert.equal((await joinResponse.json() as { error: { code: string } }).error.code, "channel_join_not_allowed");

  const leaveResponse = await fetch(`${url}/channel-1/memberships`, {
    method: "DELETE",
    headers: { ...workspaceHeaders, "x-test-identity": "member" }
  });
  assert.equal(leaveResponse.status, 204);
});

void test("lists private-channel members and lets an admin invite and remove a member", async (context) => {
  let inviteArguments: readonly string[] | null = null;
  let removeArguments: readonly string[] | null = null;
  const member = {
    channelId: "channel-1",
    userId: otherMemberIdentity.id,
    role: "member" as const,
    joinedAt: new Date("2026-10-13T00:00:00.000Z")
  };
  const { server, url, workspaceFixture } = await startApi(
    createTestChannel,
    undefined,
    undefined,
    undefined,
    undefined,
    () => Promise.resolve({
      kind: "listed",
      canManage: true,
      members: [
        { ...createdResult.creatorMembership, name: memberIdentity.name, email: memberIdentity.email, image: memberIdentity.image },
        { ...member, name: otherMemberIdentity.name, email: otherMemberIdentity.email, image: otherMemberIdentity.image }
      ]
    }),
    (workspaceId, channelId, actorId, email) => {
      inviteArguments = [workspaceId, channelId, actorId, email];
      return Promise.resolve({
        kind: "added",
        membership: { ...member, joinedAt: new Date("2026-10-13T00:00:00.000Z") }
      });
    },
    (workspaceId, channelId, actorId, userId) => {
      removeArguments = [workspaceId, channelId, actorId, userId];
      return Promise.resolve({ kind: "removed" });
    }
  );
  context.after(async () => server.stop());

  const listed = await fetch(`${url}/channel-1/memberships`, { headers: { ...workspaceHeaders, "x-test-identity": "member" } });
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await listed.json(), {
    canManage: true,
    members: [
      {
        channelId: "channel-1",
        userId: memberIdentity.id,
        role: "admin",
        joinedAt: createdResult.creatorMembership.joinedAt.toISOString(),
        name: memberIdentity.name,
        email: memberIdentity.email,
        image: null
      },
      {
        channelId: "channel-1",
        userId: otherMemberIdentity.id,
        role: "member",
        joinedAt: "2026-10-13T00:00:00.000Z",
        name: otherMemberIdentity.name,
        email: otherMemberIdentity.email,
        image: null
      }
    ]
  });

  await workspaceFixture.service.setMemberEmailsVisible(memberIdentity, "workspace-configured", false);
  const privateEmails = await fetch(`${url}/channel-1/memberships`, {
    headers: { ...workspaceHeaders, "x-test-identity": "other-member" }
  });
  assert.equal(privateEmails.status, 200);
  const hiddenBody = await privateEmails.json() as { members: readonly { email: string | null }[] };
  assert.equal(hiddenBody.members.every((member) => member.email === null), true);

  const adminEmails = await fetch(`${url}/channel-1/memberships`, {
    headers: { ...workspaceHeaders, "x-test-identity": "member" }
  });
  const adminBody = await adminEmails.json() as { members: readonly { email: string | null }[] };
  assert.equal(adminBody.members.every((member) => member.email !== null), true);

  const invited = await fetch(`${url}/channel-1/invitations`, {
    method: "POST",
    headers: { ...workspaceHeaders, "content-type": "application/json", "x-test-identity": "member" },
    body: JSON.stringify({ email: "not-an-email" })
  });
  assert.equal(invited.status, 400);
  assert.deepEqual(inviteArguments, null);

  const validInvite = await fetch(`${url}/channel-1/invitations`, {
    method: "POST",
    headers: { ...workspaceHeaders, "content-type": "application/json", "x-test-identity": "member" },
    body: JSON.stringify({ email: " OTHER@EXAMPLE.TEST " })
  });
  assert.equal(validInvite.status, 200);
  assert.deepEqual(inviteArguments, [
    "workspace-configured",
    "channel-1",
    memberIdentity.id,
    "other@example.test"
  ]);
  assert.deepEqual(await validInvite.json(), {
    membership: {
      channelId: "channel-1",
      userId: otherMemberIdentity.id,
      role: "member",
      joinedAt: "2026-10-13T00:00:00.000Z"
    },
    alreadyMember: false
  });

  const removed = await fetch(`${url}/channel-1/memberships/${otherMemberIdentity.id}`, {
    method: "DELETE",
    headers: { ...workspaceHeaders, "x-test-identity": "member" }
  });
  assert.equal(removed.status, 204);
  assert.deepEqual(removeArguments, [
    "workspace-configured",
    "channel-1",
    memberIdentity.id,
    otherMemberIdentity.id
  ]);
});

void test("conceals unauthorized channel member management and protects administrator membership", async (context) => {
  const { server, url } = await startApi(
    createTestChannel,
    undefined,
    undefined,
    undefined,
    undefined,
    () => Promise.resolve({ kind: "channel-unavailable" }),
    () => Promise.resolve({ kind: "not-manager" }),
    () => Promise.resolve({ kind: "protected-admin" })
  );
  context.after(async () => server.stop());

  const members = await fetch(`${url}/channel-1/memberships`, { headers: { ...workspaceHeaders, "x-test-identity": "other-member" } });
  assert.equal(members.status, 404);
  assert.equal((await members.json() as { error: { code: string } }).error.code, "route_not_found");

  const invite = await fetch(`${url}/channel-1/invitations`, {
    method: "POST",
    headers: { ...workspaceHeaders, "content-type": "application/json", "x-test-identity": "member" },
    body: JSON.stringify({ email: "missing@example.test" })
  });
  assert.equal(invite.status, 404);
  assert.equal((await invite.json() as { error: { code: string } }).error.code, "route_not_found");

  const removeAdmin = await fetch(`${url}/channel-1/memberships/${memberIdentity.id}`, {
    method: "DELETE",
    headers: { ...workspaceHeaders, "x-test-identity": "member" }
  });
  assert.equal(removeAdmin.status, 409);
  assert.equal((await removeAdmin.json() as { error: { code: string } }).error.code, "channel_membership_conflict");
});

void test("returns a clear storage-unavailable response when leaving cannot reach channel persistence", async (context) => {
  const { server, url } = await startApi(
    createTestChannel,
    undefined,
    undefined,
    undefined,
    () => Promise.resolve({ kind: "unavailable" })
  );
  context.after(async () => server.stop());

  const response = await fetch(`${url}/channel-1/memberships`, {
    method: "DELETE",
    headers: { ...workspaceHeaders, "x-test-identity": "member" }
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "channel_storage_unavailable");
});

void test("lists and sends channel messages with current workspace authorization and server-derived authorship", async (context) => {
  let sendCount = 0;
  const messageService: ChannelMessageService = {
    list: (workspaceId, channelId, userId) => Promise.resolve(
      workspaceId === "workspace-configured" && channelId === "channel-1" && userId === memberIdentity.id
        ? { kind: "listed" as const, messages: [channelMessage], nextCursor: null }
        : { kind: "channel-unavailable" as const }
    ),
    send: (workspaceId, channelId, userId, text) => {
      sendCount += 1;
      return Promise.resolve(
        workspaceId === "workspace-configured" && channelId === "channel-1" && userId === memberIdentity.id
          ? { kind: "sent" as const, message: { ...channelMessage, text, senderId: userId, sender: { ...channelMessage.sender, id: userId } } }
          : { kind: "channel-unavailable" as const }
      );
    },
    getAttachment: () => Promise.resolve({ kind: "not-found" })
  };
  const { server, url } = await startApi(
    createTestChannel,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    messageService
  );
  context.after(async () => server.stop());

  const history = await fetch(`${url}/channel-1/messages?limit=20`, {
    headers: { ...workspaceHeaders, "x-test-identity": "member" }
  });

  void test("uploads channel files only for members and serves them through authorized private downloads", async (context) => {
    const attachment: ChatAttachmentRecord = {
      id: "attachment-1",
      name: "notes.txt",
      mimeType: "text/plain",
      size: 5,
      publicId: "private/cloudinary/asset",
      resourceType: "raw",
      format: "txt"
    };
    let uploadCount = 0;
    const messageService: ChannelMessageService = {
      list: (_workspaceId, _channelId, userId) => Promise.resolve(
        userId === memberIdentity.id
          ? { kind: "listed" as const, messages: [], nextCursor: null }
          : { kind: "channel-unavailable" as const }
      ),
      send: (_workspaceId, channelId, userId, text, files) => {
        if ((files?.length ?? 0) > 0) uploadCount += 1;
        return Promise.resolve({
          kind: "sent" as const,
          message: {
            ...channelMessage,
            id: "message-with-file",
            channelId,
            senderId: userId,
            text,
            attachments: (files?.length ?? 0) > 0 ? [attachment] : [],
            sender: { ...channelMessage.sender, id: userId }
          }
        });
      },
      getAttachment: (_workspaceId, _channelId, userId) => Promise.resolve(
        userId === memberIdentity.id
          ? { kind: "found" as const, attachment }
          : { kind: "not-found" as const }
      )
    };
    const attachmentStorage: ChatAttachmentIntegration = {
      upload: () => Promise.resolve(attachment),
      delete: () => Promise.resolve(),
      download: () => Promise.resolve(Buffer.from("notes"))
    };
    const { server, url } = await startApi(
      createTestChannel,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      messageService,
      attachmentStorage
    );
    context.after(async () => server.stop());

    const createForm = (): FormData => {
      const form = new FormData();
      form.append("text", "");
      form.append("files", new Blob(["notes"], { type: "text/plain" }), "notes.txt");
      return form;
    };
    const headers = { ...workspaceHeaders, "x-test-identity": "member" };
    const sent = await fetch(`${url}/channel-1/messages`, {
      method: "POST",
      headers,
      body: createForm()
    });
    assert.equal(sent.status, 201);
    const sentBody = await sent.json() as {
      attachments: readonly Readonly<{ id: string; name: string; mimeType: string; size: number; downloadUrl: string }>[];
    };
    assert.deepEqual(sentBody.attachments, [{
      id: "attachment-1",
      name: "notes.txt",
      mimeType: "text/plain",
      size: 5,
      downloadUrl: "/channels/channel-1/messages/message-with-file/attachments/attachment-1"
    }]);
    assert.equal("publicId" in (sentBody.attachments[0] ?? {}), false);

    const denied = await fetch(`${url}/channel-1/messages`, {
      method: "POST",
      headers: { ...workspaceHeaders, "x-test-identity": "other-member" },
      body: createForm()
    });
    assert.equal(denied.status, 404);
    assert.equal(uploadCount, 1);

    const downloaded = await fetch(`${url}/channel-1/messages/message-with-file/attachments/attachment-1`, { headers });
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers.get("content-disposition"), "attachment; filename*=UTF-8''notes.txt");
    assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await downloaded.text(), "notes");
  });
  assert.equal(history.status, 200);
  assert.equal(history.headers.get("cache-control"), "no-store");
  assert.deepEqual(await history.json(), {
    messages: [{
      id: "message-1",
      channelId: "channel-1",
      senderId: memberIdentity.id,
      text: "Hello, channel!",
      createdAt: channelMessage.createdAt.toISOString(),
      sender: { id: memberIdentity.id, name: memberIdentity.name, image: null }
    }],
    nextCursor: null
  });

  const spoofed = await fetch(`${url}/channel-1/messages`, {
    method: "POST",
    headers: { ...workspaceHeaders, "content-type": "application/json", "x-test-identity": "member" },
    body: JSON.stringify({ text: "Hello", senderId: otherMemberIdentity.id, role: "admin" })
  });
  assert.equal(spoofed.status, 400);
  assert.equal(sendCount, 0);

  const sent = await fetch(`${url}/channel-1/messages`, {
    method: "POST",
    headers: { ...workspaceHeaders, "content-type": "application/json", "x-test-identity": "member" },
    body: JSON.stringify({ text: "Hello" })
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.headers.get("cache-control"), "no-store");
  const sentBody = await sent.json() as { senderId: string; sender: { id: string }; text: string };
  assert.equal(sentBody.senderId, memberIdentity.id);
  assert.equal(sentBody.sender.id, memberIdentity.id);
  assert.equal(sentBody.text, "Hello");
  assert.equal(sendCount, 1);

  const unavailable = await fetch(`${url}/channel-1/messages`, {
    headers: { ...workspaceHeaders, "x-test-identity": "outside" }
  });
  assert.equal(unavailable.status, 403);
});
