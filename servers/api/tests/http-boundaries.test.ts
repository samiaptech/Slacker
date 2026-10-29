import test from "node:test";
import assert from "node:assert/strict";
import type { Logger } from "@workspace/logging";
import { createApp, createServer } from "../bootstrap/index.js";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../constants/index.js";
import { summarizeMongoValidationError } from "../middleware/errors.js";
import type { AuthenticationIntegration } from "../integrations/index.js";
import type { ApiConfig } from "../types/index.js";
import type { ChannelMessageService } from "../features/channels/index.js";
import { createWorkspaceServiceFixture } from "./workspace-service-fixture.js";
import { allowApiRateLimit } from "./rate-limit-fixture.js";

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};
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
const workspaceService = createWorkspaceServiceFixture().service;
const authentication: AuthenticationIntegration = {
  handler: (_request, _response, next): void => { next(); },
  getIdentity: () => Promise.resolve(null),
  findUserByEmail: () => Promise.resolve(null),
  findUsersByIds: () => Promise.resolve([])
};
const channelService = {
  create: () => Promise.resolve({ kind: "unavailable" as const }),
  getForMember: () => Promise.resolve(null),
  listForMember: () => Promise.resolve([]),
  listChannels: () => Promise.resolve({ channels: [], nextCursor: null }),
  joinPublicChannel: () => Promise.resolve({ kind: "channel-unavailable" as const }),
  leaveChannel: () => Promise.resolve({ kind: "already-left" as const }),
  ensureGeneralChannel: () => Promise.resolve({ kind: "unavailable" as const }),
  listMembers: () => Promise.resolve({ kind: "channel-unavailable" as const }),
  listMentionMembers: () => Promise.resolve({ kind: "channel-unavailable" as const }),
  getNotificationPreference: () => Promise.resolve({ kind: "channel-unavailable" as const }),
  setNotificationPreference: () => Promise.resolve({ kind: "channel-unavailable" as const }),
  inviteMember: () => Promise.resolve({ kind: "channel-unavailable" as const }),
  removeMember: () => Promise.resolve({ kind: "channel-unavailable" as const })
};
const channelMessageService: ChannelMessageService = {
  list: () => Promise.resolve({ kind: "channel-unavailable" }),
  send: () => Promise.resolve({ kind: "channel-unavailable" }),
  getAttachment: () => Promise.resolve({ kind: "not-found" }),
  delete: () => Promise.resolve({ kind: "not-found" }),
  toggleReaction: () => Promise.resolve({ kind: "not-found" }),
  edit: () => Promise.resolve({ kind: "not-found" })
};

void test("unknown routes use the API error boundary", async (context) => {
  const server = createServer({ app: createApp({ config, logger, rateLimiter: allowApiRateLimit, trustVercelForwardedFor: false, authentication, channelService, channelMessageService, workspaceService }), config, logger });
  await server.start();
  context.after(async () => { await server.stop(); });
  const address = server.raw.address();
  assert.ok(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${String(address.port)}/missing`);
  assert.equal(response.status, HTTP_STATUS.notFound);
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.deepEqual(await response.json(), {
    error: {
      code: ERROR_CODES.routeNotFound,
      message: ERROR_MESSAGES.routeNotFound,
      details: { method: "GET", path: "/missing" }
    }
  });

});

void test("applies the API-wide limit to health and unknown routes but not CORS preflights", async (context) => {
  const keys: string[] = [];
  const server = createServer({
    app: createApp({
      config,
      logger,
      rateLimiter: {
        consume: (key) => {
          keys.push(key);
          return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
        }
      },
      trustVercelForwardedFor: false,
      authentication,
      channelService,
      channelMessageService,
      workspaceService
    }),
    config,
    logger
  });
  await server.start();
  context.after(async () => { await server.stop(); });
  const address = server.raw.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${String(address.port)}`;

  assert.equal((await fetch(`${origin}/health`)).status, 200);
  assert.equal((await fetch(`${origin}/missing`)).status, 404);
  assert.equal((await fetch(`${origin}/health`, { method: "OPTIONS" })).status, 204);
  assert.deepEqual(keys, ["api:127.0.0.1", "api:127.0.0.1"]);
});

void test("CORS preflight allows credentialed channel requests with workspace and idempotency headers", async (context) => {
  const server = createServer({ app: createApp({ config, logger, rateLimiter: allowApiRateLimit, trustVercelForwardedFor: false, authentication, channelService, channelMessageService, workspaceService }), config, logger });
  await server.start();
  context.after(async () => { await server.stop(); });
  const address = server.raw.address();
  assert.ok(address && typeof address === "object");

  const response = await fetch(`http://127.0.0.1:${String(address.port)}/channels`, {
    method: "OPTIONS",
    headers: {
      Origin: config.webOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,idempotency-key,x-workspace-id"
    }
  });

  assert.equal(response.status, HTTP_STATUS.noContent);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("access-control-allow-origin"), config.webOrigin);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.match(response.headers.get("access-control-allow-headers") ?? "", /Idempotency-Key/i);
  assert.match(response.headers.get("access-control-allow-headers") ?? "", /X-Workspace-Id/i);
  assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/);
});

void test("does not log workspace invitation tokens or OAuth callback codes", async (context) => {
  const logEntries: string[] = [];
  const captureLogger: Logger = {
    info: (_message, context) => { logEntries.push(JSON.stringify(context)); },
    warn: (_message, context) => { logEntries.push(JSON.stringify(context)); },
    error: (_message, context) => { logEntries.push(JSON.stringify(context)); }
  };
  const server = createServer({
    app: createApp({ config, logger: captureLogger, rateLimiter: allowApiRateLimit, trustVercelForwardedFor: false, authentication, channelService, channelMessageService, workspaceService }),
    config,
    logger: captureLogger
  });
  await server.start();
  context.after(async () => { await server.stop(); });
  const address = server.raw.address();
  assert.ok(address && typeof address === "object");
  const inviteToken = "a".repeat(48);
  const callbackCode = "oauth-code-secret";

  const invitationResponse = await fetch(
    `http://127.0.0.1:${String(address.port)}/workspace-invitations/${inviteToken}/accept`,
    { method: "POST" }
  );
  await invitationResponse.text();
  const callbackResponse = await fetch(
    `http://127.0.0.1:${String(address.port)}/api/auth/callback/google?code=${callbackCode}`
  );
  await callbackResponse.text();

  const logOutput = logEntries.join("\n");
  assert.equal(logOutput.includes(inviteToken), false);
  assert.equal(logOutput.includes(callbackCode), false);
});

void test("summarizes MongoDB validation failures without logging document values", () => {
  const diagnostics = summarizeMongoValidationError({
    code: 121,
    codeName: "DocumentValidationFailure",
    errInfo: {
      details: {
        schemaRulesNotSatisfied: [{
          operatorName: "properties",
          propertiesNotSatisfied: [{
            propertyName: "attachments",
            details: [{
              operatorName: "items",
              itemsNotSatisfied: [{
                itemIndex: 0,
                details: [{
                  operatorName: "properties",
                  propertiesNotSatisfied: [{
                    propertyName: "size",
                    details: [{
                      operatorName: "bsonType",
                      consideredValue: "private-document-name"
                    }]
                  }]
                }]
              }]
            }]
          }]
        }]
      }
    }
  });

  assert.deepEqual(diagnostics, {
    code: 121,
    codeName: "DocumentValidationFailure",
    validationRules: [
      "attachments:items",
      "attachments:properties",
      "attachments.size:bsonType"
    ]
  });
  assert.equal(JSON.stringify(diagnostics).includes("private-document-name"), false);
});
