import test from "node:test";
import assert from "node:assert/strict";
import type { Logger } from "@workspace/logging";
import { createApp, createServer } from "../../../bootstrap/index.js";
import type { AuthenticationIntegration } from "../../../integrations/index.js";
import type { ApiConfig } from "../../../types/index.js";
import { createWorkspaceServiceFixture } from "../../../tests/workspace-service-fixture.js";
import { allowApiRateLimit } from "../../../tests/rate-limit-fixture.js";
import {
  createDirectMessageRepository,
  createDirectMessageService,
  type DirectMessageStorage
} from "../index.js";

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
const admin = { id: "admin-1", name: "Admin", email: "admin@example.test", image: null };
const member = { id: "member-1", name: "Member", email: "member@example.test", image: null };

void test("uses authenticated workspace role for DM global deletion while requiring participants", async (context) => {
  const requestedRoles: boolean[] = [];
  const reactionCalls: unknown[][] = [];
  const now = new Date("2026-10-27T00:00:00.000Z");
  const storage: DirectMessageStorage = {
    initialize: () => Promise.resolve(),
    openForMember: () => Promise.reject(new Error("Not used by this test.")),
    listForMember: () => Promise.resolve([]),
    findForMember: () => Promise.resolve(null),
    listMessagesForMember: () => Promise.resolve(null),
    createMessageForMember: () => Promise.resolve(false),
    editMessageForMember: (
      workspaceId,
      conversationId,
      userId,
      messageId,
      text,
      _expectedEditedAt,
      editedAt
    ) => Promise.resolve({
      kind: "updated" as const,
      message: {
        _id: messageId,
        workspaceId,
        conversationId,
        senderId: userId,
        text,
        createdAt: now,
        editedAt
      },
      reactions: []
    }),
    deleteMessageForMember: (_workspaceId, _conversationId, _userId, _messageId, _scope, isWorkspaceAdmin) => {
      requestedRoles.push(isWorkspaceAdmin);
      return Promise.resolve(isWorkspaceAdmin
        ? { kind: "deleted" as const, attachments: [] }
        : { kind: "forbidden" as const });
    },
    toggleReactionForMember: (...args) => {
      reactionCalls.push(args);
      if (args[2] !== member.id) return Promise.resolve({ kind: "not-found" as const });
      return Promise.resolve({
        kind: "updated" as const,
        reactions: [{
          messageId: args[3],
          emoji: args[4],
          count: 1,
          userIds: [member.id],
          usersTruncated: false,
          reactedByMe: true
        }]
      });
    }
  };
  const directMessageService = createDirectMessageService({
    repository: createDirectMessageRepository(storage),
    isWorkspaceMember: () => Promise.resolve("member"),
    createId: () => "unused",
    now: () => now,
    findUsersByIds: (userIds) => Promise.resolve(
      [admin, member].filter((identity) => userIds.includes(identity.id))
    )
  });
  const workspaceFixture = createWorkspaceServiceFixture();
  workspaceFixture.seed("workspace-1", [admin.id, member.id]);
  const identities = new Map([[admin.id, admin], [member.id, member]]);
  const authentication: AuthenticationIntegration = {
    handler: (_request, _response, next): void => { next(); },
    getIdentity: (headers) => Promise.resolve(
      typeof headers["x-test-identity"] === "string"
        ? identities.get(headers["x-test-identity"]) ?? null
        : null
    ),
    updateUserImage: () => Promise.resolve(),
    findUserByEmail: () => Promise.resolve(null),
    findUsersByIds: () => Promise.resolve([])
  };
  const channelMessageService: Parameters<typeof createApp>[0]["channelMessageService"] = {
    list: () => Promise.resolve({ kind: "channel-unavailable" }),
    send: () => Promise.resolve({ kind: "channel-unavailable" }),
    getAttachment: () => Promise.resolve({ kind: "not-found" }),
    delete: () => Promise.resolve({ kind: "not-found" }),
    toggleReaction: () => Promise.resolve({ kind: "not-found" }),
    edit: () => Promise.resolve({ kind: "not-found" })
  };
  const channelService: Parameters<typeof createApp>[0]["channelService"] = {
    create: () => Promise.resolve({ kind: "unavailable" }),
    getForMember: () => Promise.resolve(null),
    listForMember: () => Promise.resolve([]),
    listChannels: () => Promise.resolve({ channels: [], nextCursor: null }),
    joinPublicChannel: () => Promise.resolve({ kind: "channel-unavailable" }),
    leaveChannel: () => Promise.resolve({ kind: "already-left" }),
    ensureGeneralChannel: () => Promise.resolve({ kind: "unavailable" }),
    listMembers: () => Promise.resolve({ kind: "channel-unavailable" }),
    listMentionMembers: () => Promise.resolve({ kind: "channel-unavailable" }),
    getNotificationPreference: () => Promise.resolve({ kind: "channel-unavailable" }),
    setNotificationPreference: () => Promise.resolve({ kind: "channel-unavailable" }),
    inviteMember: () => Promise.resolve({ kind: "channel-unavailable" }),
    removeMember: () => Promise.resolve({ kind: "channel-unavailable" })
  };
  const updatedMessages: unknown[] = [];
  const directMessageRealtime: NonNullable<Parameters<typeof createApp>[0]["directMessageRealtime"]> = {
    publishDirectMessage: () => undefined,
    publishMessageUpdated: (_workspaceId, _conversationId, message) => { updatedMessages.push(message); },
    publishMessageDeleted: () => undefined,
    publishMessageReactions: () => undefined,
    publishConversationChanged: () => undefined
  };
  const app = createApp({
    config,
    logger,
    rateLimiter: allowApiRateLimit,
    trustVercelForwardedFor: false,
    authentication,
    workspaceService: workspaceFixture.service,
    channelService,
    channelMessageService,
    directMessageService,
    directMessageRealtime
  });
  const server = createServer({ app, config, logger });
  await server.start();
  context.after(async () => server.stop());
  const address = server.raw.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${String(address.port)}/direct-messages/conversation-1/messages/message-1`;
  const deleteMessage = (identity: string) => fetch(endpoint, {
    method: "DELETE",
    headers: {
      "x-workspace-id": "workspace-1",
      "x-test-identity": identity,
      "content-type": "application/json"
    },
    body: JSON.stringify({ scope: "everyone" })
  });

  assert.equal((await deleteMessage(admin.id)).status, 204);
  assert.equal((await deleteMessage(member.id)).status, 403);
  assert.deepEqual(requestedRoles, [true, false]);

  const reactionEndpoint = `${endpoint}/reactions`;
  const toggleReaction = (identity: string, emoji: string) => fetch(reactionEndpoint, {
    method: "POST",
    headers: {
      "x-workspace-id": "workspace-1",
      "x-test-identity": identity,
      "content-type": "application/json"
    },
    body: JSON.stringify({ emoji })
  });
  const reacted = await toggleReaction(member.id, "👍");
  assert.equal(reacted.status, 200);
  assert.equal(reacted.headers.get("cache-control"), "no-store");
  assert.deepEqual(await reacted.json(), {
    messageId: "message-1",
    reactions: [{
      emoji: "👍",
      count: 1,
      users: [{ id: member.id, name: member.name, image: null }],
      usersTruncated: false,
      reactedByMe: true
    }]
  });
  assert.deepEqual(reactionCalls, [[
    "workspace-1", "conversation-1", member.id, "message-1", "👍", now
  ]]);

  assert.equal((await toggleReaction(admin.id, "👍")).status, 404);
  assert.equal((await toggleReaction(member.id, "🧨")).status, 400);
  assert.equal(reactionCalls.length, 2);

  const edited = await fetch(endpoint, {
    method: "PATCH",
    headers: {
      "x-workspace-id": "workspace-1",
      "x-test-identity": member.id,
      "content-type": "application/json"
    },
    body: JSON.stringify({ text: "Edited DM", expectedEditedAt: null })
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.headers.get("cache-control"), "no-store");
  const editedMessage = await edited.json() as { text: string; editedAt: string; senderId: string };
  assert.equal(editedMessage.text, "Edited DM");
  assert.equal(editedMessage.editedAt, now.toISOString());
  assert.equal(editedMessage.senderId, member.id);
  assert.equal(updatedMessages.length, 1);
  assert.deepEqual(updatedMessages[0], editedMessage);
});
