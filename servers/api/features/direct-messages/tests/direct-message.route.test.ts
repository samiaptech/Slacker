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
  const storage: DirectMessageStorage = {
    initialize: () => Promise.resolve(),
    openForMember: () => Promise.reject(new Error("Not used by this test.")),
    listForMember: () => Promise.resolve([]),
    findForMember: () => Promise.resolve(null),
    listMessagesForMember: () => Promise.resolve(null),
    createMessageForMember: () => Promise.resolve(false),
    deleteMessageForMember: (_workspaceId, _conversationId, _userId, _messageId, _scope, isWorkspaceAdmin) => {
      requestedRoles.push(isWorkspaceAdmin);
      return Promise.resolve(isWorkspaceAdmin
        ? { kind: "deleted" as const, attachments: [] }
        : { kind: "forbidden" as const });
    }
  };
  const directMessageService = createDirectMessageService({
    repository: createDirectMessageRepository(storage),
    isWorkspaceMember: () => Promise.resolve("member"),
    createId: () => "unused",
    now: () => new Date(),
    findUsersByIds: () => Promise.resolve([])
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
    findUserByEmail: () => Promise.resolve(null),
    findUsersByIds: () => Promise.resolve([])
  };
  const channelMessageService: Parameters<typeof createApp>[0]["channelMessageService"] = {
    list: () => Promise.resolve({ kind: "channel-unavailable" }),
    send: () => Promise.resolve({ kind: "channel-unavailable" }),
    getAttachment: () => Promise.resolve({ kind: "not-found" }),
    delete: () => Promise.resolve({ kind: "not-found" })
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
    inviteMember: () => Promise.resolve({ kind: "channel-unavailable" }),
    removeMember: () => Promise.resolve({ kind: "channel-unavailable" })
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
    directMessageService
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
});
