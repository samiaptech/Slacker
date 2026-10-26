import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer as createHttpServer } from "node:http";
import type { Logger } from "@workspace/logging";
import { createErrorHandler } from "../../../middleware/index.js";
import { createNotificationRoutes } from "../routes.js";
import { createNotificationService } from "../service.js";
import type { NotificationDocument } from "../model.js";
import type { NotificationStorage } from "../storage.js";

const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

const createStorage = (): NotificationStorage => {
  const records: NotificationDocument[] = [{
    _id: "event-1:user-1",
    eventId: "event-1",
    recipientId: "user-1",
    workspaceId: "workspace-1",
    type: "channel_message",
    resourceType: "channel",
    resourceId: "channel-1",
    actorId: "actor-1",
    actorName: "Actor",
    createdAt: new Date("2026-10-26T09:00:00.000Z"),
    readAt: null
  }];
  return {
    initialize: () => Promise.resolve(),
    createForChannel: () => Promise.resolve([]),
    createForDirectMessage: () => Promise.resolve([]),
    listForUser: (userId) => Promise.resolve(records.filter(({ recipientId }) => recipientId === userId)),
    unreadCount: (userId) => Promise.resolve(records.filter(({ recipientId, readAt }) =>
      recipientId === userId && readAt === null).length),
    markRead: (userId, id, readAt) => {
      const item = records.find(({ recipientId, _id }) => recipientId === userId && _id === id);
      if (!item) return Promise.resolve(false);
      records[records.indexOf(item)] = Object.freeze({ ...item, readAt });
      return Promise.resolve(true);
    },
    markResourceRead: () => Promise.resolve(0),
    findCursor: (userId, id) => Promise.resolve(records.find(({ recipientId, _id }) =>
      recipientId === userId && _id === id) ?? null)
  };
};

void test("serves authenticated private notification list/count/read contracts", async (context) => {
  const service = createNotificationService({
    storage: createStorage(),
    createId: () => "generated",
    now: () => new Date("2026-10-26T10:00:00.000Z")
  });
  const app = express();
  app.use(createNotificationRoutes({
    getIdentity: (headers) => {
      const userId = headers["x-test-user"];
      return Promise.resolve(userId === "user-1" || userId === "user-2"
        ? { id: userId, name: "User", email: "user@example.test", image: null }
        : null);
    },
    service
  }));
  app.use(createErrorHandler({ logger }));
  const server = createHttpServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  }));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Notification test server did not start.");
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;

  const unauthorized = await fetch(`${baseUrl}/notifications`);
  assert.equal(unauthorized.status, 401);
  const listed = await fetch(`${baseUrl}/notifications`, { headers: { "x-test-user": "user-1" } });
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await listed.json(), {
    notifications: [{
      id: "event-1:user-1",
      eventId: "event-1",
      type: "channel_message",
      workspaceId: "workspace-1",
      resource: { type: "channel", id: "channel-1" },
      actor: { id: "actor-1", name: "Actor" },
      createdAt: "2026-10-26T09:00:00.000Z",
      readAt: null
    }],
    nextCursor: null
  });
  const count = await fetch(`${baseUrl}/notifications/unread-count`, {
    headers: { "x-test-user": "user-1" }
  });
  assert.deepEqual(await count.json(), { unreadCount: 1 });
  const foreignRead = await fetch(`${baseUrl}/notifications/event-1:user-1/read`, {
    method: "PATCH",
    headers: { "x-test-user": "user-2" }
  });
  assert.equal(foreignRead.status, 404);
});
